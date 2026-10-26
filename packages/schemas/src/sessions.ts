import { z } from 'zod';
import { recordVersionSchema } from './drafts';
import { episodeStatusLabels, type EpisodeStatus } from './episodes';
import { interventionKinds, type InterventionKind } from './plan';
import { addendumTextSchema } from './signed-record';

/**
 * Treatment session check in (SES-01, PRD J5.1, M9; user decisions 25 October 2026). A
 * checked in Session or Zero Gravity Treadmill appointment (`packages.session_appointment_types`)
 * is session n of the episode, in check in order, of N planned in the signed plan (sessions per
 * week x weeks). The gate: the desk still checks the patient in, but the physio starts the
 * session only once it is met. Payment is met once the chosen plan is paid, so the episode is in
 * treatment (Active or Under review). Part B consent joins the gate with BIL-03 (DECISION SES-01).
 */

/** "Session 3 of 12", or "Session 3" when the plan sets no frequency. */
export function sessionLabel(number: number, planned: number | null): string {
  return planned ? `Session ${String(number)} of ${String(planned)}` : `Session ${String(number)}`;
}

/** Statuses of an episode in treatment: its chosen plan is paid (BIL-06). */
const inTreatment: readonly EpisodeStatus[] = ['active', 'under_review'];
/** Statuses before the chosen plan is paid. */
const beforePayment: readonly EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
];

export interface SessionGate {
  met: boolean;
  /** What the desk and the physio read. */
  message: string;
}

/** Shown until Part B consent (BIL-03) joins the gate. DECISION SES-01. */
export const consentNotCheckedYet = 'Part B consent is not checked yet.';

/** A session appointment as the screens show it: its label once checked in, and the gate. */
export interface SessionView {
  /** "Session 3 of 12" once checked in; null before. */
  label: string | null;
  gate: SessionGate;
}

/** The view of a session appointment from its progress, or null for other appointments. */
export function sessionView(
  progress:
    | { number: number | null; planned: number | null; episodeStatus: EpisodeStatus | null }
    | undefined,
): SessionView | null {
  if (!progress) return null;
  return {
    label: progress.number === null ? null : sessionLabel(progress.number, progress.planned),
    gate: sessionGate(progress.episodeStatus),
  };
}

/** Whether a session of an episode in this status may start, and why not. */
export function sessionGate(episodeStatus: EpisodeStatus | null): SessionGate {
  if (episodeStatus === null) return { met: false, message: 'Not part of an episode yet.' };
  if (inTreatment.includes(episodeStatus)) return { met: true, message: 'Payment complete' };
  if (beforePayment.includes(episodeStatus)) {
    return { met: false, message: 'Consent and payment are needed before the first session.' };
  }
  return { met: false, message: `The episode is ${episodeStatusLabels[episodeStatus]}.` };
}

/**
 * The summary card's phase line on the session screen (SES-02) until the phase stepper (OUT-04)
 * gives each programme its phases. DECISION SES-02.
 */
export const phaseNotSetUp = 'Phase: not set up yet';

/**
 * The session note (SES-03, PRD J5.4 and J5.5, Blueprint 11A; user decisions 26 October 2026):
 * any new symptoms first (Yes needs a description, and closing then gives the episode's
 * consultant a task), since last visit, pain at rest, during activity and after treatment (0 to
 * 10), the treatment given as ticks from the plan (prefilled from the last signed note, or the
 * plan for the first), the response, changes to the home programme (the plan itself stays the
 * consultant's) and what the next session does. Close session signs it.
 */

const noteText = z
  .string()
  .max(2000, { error: 'Keep each note under 2000 characters.' })
  .default('');
const painReading = z.number().int().min(0).max(10).nullable().default(null);

/** A session note is a draft until Close session signs it. */
export const sessionStatuses = ['draft', 'signed'] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const newSymptomsAnswers = ['no', 'yes'] as const;
export type NewSymptomsAnswer = (typeof newSymptomsAnswers)[number];

export const sessionResponses = ['better', 'same', 'worse'] as const;
export type SessionResponse = (typeof sessionResponses)[number];
export const sessionResponseLabels: Record<SessionResponse, string> = {
  better: 'Better',
  same: 'Same',
  worse: 'Worse',
};

export const nextSessionPlans = [
  'progress',
  'maintain',
  'regress',
  'reassess',
  'escalate',
] as const;
export type NextSessionPlan = (typeof nextSessionPlans)[number];
export const nextSessionPlanLabels: Record<NextSessionPlan, string> = {
  progress: 'Progress',
  maintain: 'Maintain',
  regress: 'Regress',
  reassess: 'Reassess',
  escalate: 'Escalate',
};

export const painReadings = ['rest', 'activity', 'after'] as const;
export type PainReading = (typeof painReadings)[number];
export const painReadingLabels: Record<PainReading, string> = {
  rest: 'Pain at rest',
  activity: 'Pain during activity',
  after: 'Pain after treatment',
};

export const sessionNoteSchema = z.object({
  newSymptoms: z
    .object({
      answer: z.enum(newSymptomsAnswers).nullable().default(null),
      description: noteText,
    })
    .default({ answer: null, description: '' }),
  sinceLastVisit: noteText,
  pain: z
    .object({ rest: painReading, activity: painReading, after: painReading })
    .default({ rest: null, activity: null, after: null }),
  treatment: z
    .object({
      interventions: z.array(z.enum(interventionKinds)).max(interventionKinds.length).default([]),
      modalities: z.array(z.string().min(1).max(80)).max(20).default([]),
      note: noteText,
    })
    .default({ interventions: [], modalities: [], note: '' }),
  response: z
    .object({ rating: z.enum(sessionResponses).nullable().default(null), note: noteText })
    .default({ rating: null, note: '' }),
  homeProgramme: z.object({ note: noteText }).default({ note: '' }),
  nextSession: z
    .object({ plan: z.enum(nextSessionPlans).nullable().default(null), note: noteText })
    .default({ plan: null, note: '' }),
});

export type SessionNote = z.infer<typeof sessionNoteSchema>;

/** An empty note. */
export function emptySessionNote(): SessionNote {
  return sessionNoteSchema.parse({});
}

/** A stored note as today's schema reads it; one that no longer parses reads as empty. */
export function readSessionNote(stored: Record<string, unknown>): SessionNote {
  const read = sessionNoteSchema.safeParse(stored);
  return read.success ? read.data : emptySessionNote();
}

/**
 * A new note: the treatment given last time (the episode's last signed note), or for the first
 * session the plan's interventions and modalities; everything else starts empty.
 */
export function prefilledSessionNote(
  from:
    | { lastNote: SessionNote }
    | { plan: { interventions: readonly InterventionKind[]; modalities: readonly string[] } }
    | undefined,
): SessionNote {
  const note = emptySessionNote();
  if (!from) return note;
  if ('lastNote' in from) {
    return { ...note, treatment: { ...from.lastNote.treatment } };
  }
  return {
    ...note,
    treatment: {
      interventions: [...from.plan.interventions],
      modalities: [...from.plan.modalities],
      note: '',
    },
  };
}

/** What still holds Close session back, in the note's order; empty when it can close. */
export function sessionNoteBlockers(note: SessionNote): string[] {
  const blockers: string[] = [];
  if (note.newSymptoms.answer === null) blockers.push('Answer "Any new symptoms?".');
  else if (note.newSymptoms.answer === 'yes' && note.newSymptoms.description.trim() === '') {
    blockers.push('Describe the new symptoms.');
  }
  for (const reading of painReadings) {
    if (note.pain[reading] === null)
      blockers.push(`Set ${painReadingLabels[reading].toLowerCase()}.`);
  }
  if (note.treatment.interventions.length + note.treatment.modalities.length === 0) {
    blockers.push('Tick the treatment given.');
  }
  if (note.response.rating === null) blockers.push('Choose the response.');
  if (note.nextSession.plan === null) blockers.push('Choose what the next session does.');
  return blockers;
}

export const sessionAppointmentSchema = z.object({ appointmentId: z.guid() });

export const saveSessionNoteSchema = z.object({
  appointmentId: z.guid(),
  value: sessionNoteSchema,
  baseVersion: recordVersionSchema,
});

export const closeSessionSchema = z.object({
  appointmentId: z.guid(),
  baseVersion: recordVersionSchema,
});

/** An addendum on a signed session note (CLN-12 follow up). */
export const sessionAddendumSchema = z.object({
  sessionId: z.guid(),
  text: addendumTextSchema,
});
