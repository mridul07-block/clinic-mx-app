import { z } from 'zod';
import { adherenceSnapshotSchema } from './adherence';
import { baselineBlockers, baselineEntrySchema, type BaselineMarker } from './baseline';
import {
  reassessmentBlockers,
  reassessmentEntrySchema,
  type ReassessedMeasure,
} from './reassessment';
import { recordVersionSchema } from './drafts';
import { episodeStatusLabels, type EpisodeStatus } from './episodes';
import { interventionKinds, type InterventionKind, type ModalityParameter } from './plan';
import { partBGateMessage, type PartBGateReason } from './part-b-consent';
import { addendumTextSchema } from './signed-record';

/**
 * Treatment session check in (SES-01, PRD J5.1, M9; user decisions 25 October 2026). A
 * checked in Session or Zero Gravity Treadmill appointment (`packages.session_appointment_types`)
 * is session n of the episode, in check in order, of N planned in the signed plan (sessions per
 * week x weeks). The gate: the desk still checks the patient in, but the physio starts the
 * session only once it is met. Payment is met once the chosen plan is paid, so the episode is in
 * treatment (Active or Under review); Part B consent (BIL-03) is met as `partBGate` decides, read by
 * the database (`internal.part_b_gate`; BIL-12, PRD J4.9, DECISION BIL-12).
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

/** A session appointment as the screens show it: its label once checked in, and the gate. */
export interface SessionView {
  /** "Session 3 of 12" once checked in; null before. */
  label: string | null;
  gate: SessionGate;
}

/** The view of a session appointment from its progress, or null for other appointments. */
export function sessionView(
  progress:
    | {
        number: number | null;
        planned: number | null;
        episodeStatus: EpisodeStatus | null;
        partB?: PartBGateReason | null;
      }
    | undefined,
): SessionView | null {
  if (!progress) return null;
  return {
    label: progress.number === null ? null : sessionLabel(progress.number, progress.planned),
    gate: sessionGate(progress.episodeStatus, progress.partB ?? null),
  };
}

/**
 * Whether a session of an episode in this status, with this Part B, may start, and why not: the
 * chosen plan paid (in treatment) and Part B met (or on paper, for an opening entry).
 */
export function sessionGate(
  episodeStatus: EpisodeStatus | null,
  partB: PartBGateReason | null,
): SessionGate {
  if (episodeStatus === null) return { met: false, message: 'Not part of an episode yet.' };
  if (inTreatment.includes(episodeStatus)) {
    if (partB === 'met' || partB === 'opening_entry') {
      return { met: true, message: 'Consent and payment complete' };
    }
    return { met: false, message: partBGateMessage(partB ?? 'missing') };
  }
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
const modalityKey = z.string().min(1).max(80);

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
      modalities: z.array(modalityKey).max(20).default([]),
      note: noteText,
      // SES-05: each modality's parameters by field, and why it is given despite a precaution.
      parameters: z
        .record(
          modalityKey,
          z.record(
            z.string().min(1).max(80),
            z.string().max(200, { error: 'Keep each parameter under 200 characters.' }),
          ),
        )
        .default({}),
      reasons: z.record(modalityKey, noteText).default({}),
    })
    .default({ interventions: [], modalities: [], note: '', parameters: {}, reasons: {} }),
  response: z
    .object({
      rating: z.enum(sessionResponses).nullable().default(null),
      note: noteText,
      // SES-06: an adverse event, ticked under the response, with its description.
      adverseEvent: z
        .object({ reported: z.boolean().default(false), description: noteText })
        .default({ reported: false, description: '' }),
    })
    .default({ rating: null, note: '', adverseEvent: { reported: false, description: '' } }),
  homeProgramme: z.object({ note: noteText }).default({ note: '' }),
  nextSession: z
    .object({ plan: z.enum(nextSessionPlans).nullable().default(null), note: noteText })
    .default({ plan: null, note: '' }),
  // OUT-01: session 1's entries for the baseline markers it asks for, by measure key.
  baseline: z
    .record(
      z
        .string()
        .regex(/^[a-z_]+\.[a-z0-9_.]+$/)
        .max(120),
      baselineEntrySchema,
    )
    .default({})
    .refine((entries) => Object.keys(entries).length <= 50, 'Too many baseline markers.'),
  // OUT-05: session 4's entries for the baseline's measures, by measure key.
  reassessment: z
    .record(
      z
        .string()
        .regex(/^[a-z_]+\.[a-z0-9_.]+$/)
        .max(120),
      reassessmentEntrySchema,
    )
    .default({})
    .refine((entries) => Object.keys(entries).length <= 100, 'Too many reassessed measures.'),
  /**
   * Home exercise adherence (PAT-02), kept with the note when it is signed, so the signed note
   * never changes; null while a draft (the screen works it out live) and in notes before PAT-02.
   */
  adherence: adherenceSnapshotSchema.nullable().default(null),
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

/** A note's treatment as a copy, its parameters included (SES-05). */
function copiedTreatment(note: SessionNote): Omit<SessionNote['treatment'], 'reasons'> {
  return {
    interventions: [...note.treatment.interventions],
    modalities: [...note.treatment.modalities],
    note: note.treatment.note,
    parameters: Object.fromEntries(
      Object.entries(note.treatment.parameters).map(([key, values]) => [key, { ...values }]),
    ),
  };
}

/**
 * A modality as a session note needs it (SES-05): its name and parameters at the note's knowledge
 * base version, and the patient's precautions it warns about.
 */
export interface SessionModality {
  key: string;
  name: string;
  parameters: ModalityParameter[];
  warnings: { label: string; source: string }[];
}

/** Whether a parameter holds a value of its kind. */
function parameterFilled(field: ModalityParameter, value: string | undefined): boolean {
  const text = (value ?? '').trim();
  if (text === '') return false;
  return field.kind === 'text' || Number.isFinite(Number(text));
}

/** "Achilles · 10 min · 0.12 mJ/mm² · 8 Hz", a modality's parameters in its fields' order. */
export function sessionParameterLine(
  values: Record<string, string> | undefined,
  fields: readonly ModalityParameter[],
): string {
  return fields
    .flatMap((field) => {
      const text = (values?.[field.key] ?? '').trim();
      if (text === '') return [];
      return [field.unit ? `${text} ${field.unit}` : text];
    })
    .join(' · ');
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
    // Parameters carry over (SES-05); a precaution's reason is asked again each time.
    return { ...note, treatment: { ...copiedTreatment(from.lastNote), reasons: {} } };
  }
  return {
    ...note,
    treatment: {
      interventions: [...from.plan.interventions],
      modalities: [...from.plan.modalities],
      note: '',
      parameters: {},
      reasons: {},
    },
  };
}

/**
 * "Same as last time" (SES-04, user decisions 26 October 2026): the plan side of the episode's
 * previous signed note, the treatment, home programme changes and next session, copied into
 * today's note for editing. New symptoms, since last visit, pain and the response are today's to
 * ask and measure, so they stay as they are.
 */
export function sameAsLastTime(current: SessionNote, last: SessionNote): SessionNote {
  return {
    ...current,
    treatment: { ...copiedTreatment(last), reasons: current.treatment.reasons },
    homeProgramme: { ...last.homeProgramme },
    nextSession: { ...last.nextSession },
  };
}

/** The sections "Same as last time" replaces, to compare (reasons are today's own). */
function copiedSections(note: SessionNote): string {
  const { interventions, modalities, note: text, parameters } = note.treatment;
  return JSON.stringify([
    { interventions, modalities, note: text, parameters },
    note.homeProgramme,
    note.nextSession,
  ]);
}

/**
 * Whether "Same as last time" would replace something the physio entered: the copied sections
 * differ both from how the draft opened (prefilled from that same note) and from the note itself.
 */
export function sameAsLastTimeOverwrites(current: SessionNote, last: SessionNote): boolean {
  const now = copiedSections(current);
  return (
    now !== copiedSections(prefilledSessionNote({ lastNote: last })) &&
    now !== copiedSections(sameAsLastTime(current, last))
  );
}

const painAfterNumber: Record<PainReading, string> = {
  rest: 'at rest',
  activity: 'during activity',
  after: 'after treatment',
};

/** "Pain 2 at rest · 4 during activity · 1 after treatment · Better", for a list of signed notes (CLN-12 follow up). */
export function sessionNoteDigest(note: SessionNote): string {
  const pain = painReadings
    .map((reading) => {
      const value = note.pain[reading];
      return value === null ? null : `${String(value)} ${painAfterNumber[reading]}`;
    })
    .filter((part) => part !== null);
  return [
    pain.length > 0 ? `Pain ${pain.join(' · ')}` : null,
    note.response.rating ? sessionResponseLabels[note.response.rating] : null,
    note.response.adverseEvent.reported ? 'Adverse event' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/**
 * Whether a staff member covers colleagues' sessions at a centre (SES-08, user decisions 26
 * October 2026): the Treats patients tick, never Velyx support, and working at that centre
 * (`internal.covers_visit` holds the same in the database).
 */
export function coversSessionsAt(
  staff: { treatsPatients: boolean; support: boolean; centreIds: readonly string[] },
  centreId: string,
): boolean {
  return staff.treatsPatients && !staff.support && staff.centreIds.includes(centreId);
}

/**
 * What still holds Close session back, in the note's order; empty when it can close. With the
 * note's modalities (SES-05), each ticked one needs its parameters, and a reason when it warns
 * about one of the patient's precautions. At session 1, each baseline marker it asks for (OUT-01)
 * needs a reading, or Not tested with a reason; at session 4, each baseline measure it reassesses
 * (OUT-05) the same.
 */
export function sessionNoteBlockers(
  note: SessionNote,
  modalities: readonly SessionModality[] = [],
  baselineMissing: readonly BaselineMarker[] = [],
  reassessed: readonly ReassessedMeasure[] = [],
): string[] {
  const blockers: string[] = [];
  if (note.newSymptoms.answer === null) blockers.push('Answer "Any new symptoms?".');
  else if (note.newSymptoms.answer === 'yes' && note.newSymptoms.description.trim() === '') {
    blockers.push('Describe the new symptoms.');
  }
  for (const reading of painReadings) {
    if (note.pain[reading] === null)
      blockers.push(`Set ${painReadingLabels[reading].toLowerCase()}.`);
  }
  blockers.push(...baselineBlockers(note.baseline, baselineMissing));
  blockers.push(...reassessmentBlockers(note.reassessment, reassessed));
  if (note.treatment.interventions.length + note.treatment.modalities.length === 0) {
    blockers.push('Tick the treatment given.');
  }
  for (const key of note.treatment.modalities) {
    const modality = modalities.find((m) => m.key === key);
    if (!modality) continue;
    const values = note.treatment.parameters[key];
    if (modality.parameters.some((field) => !parameterFilled(field, values?.[field.key]))) {
      blockers.push(`Fill the parameters for ${modality.name}.`);
    }
    if (modality.warnings.length > 0 && (note.treatment.reasons[key] ?? '').trim() === '') {
      blockers.push(
        `Give a reason for ${modality.name} despite ${modality.warnings.map((w) => w.label).join(', ')}.`,
      );
    }
  }
  if (note.response.rating === null) blockers.push('Choose the response.');
  if (note.response.adverseEvent.reported && note.response.adverseEvent.description.trim() === '') {
    blockers.push('Describe the adverse event.');
  }
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
