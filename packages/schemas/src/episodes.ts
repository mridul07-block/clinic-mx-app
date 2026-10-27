import { z } from 'zod';
import { screeningRegions } from './red-flags';

/**
 * Clinical episodes (SCH-03, PRD M1, TAD section 4): the backbone every visit, plan, payment and
 * message belongs to (rule 1). The statuses are the PRD's; each change is an explicit event with a
 * guard (TAD conventions), run here without I/O so the services and the database trigger enforce
 * the same machine. Decisions (user, 22 October 2026): an episode opens at booking (Intake
 * pending); discharge reasons are the Blueprint's (section 13); the status buttons arrive with the
 * tickets that own each change.
 */

export const episodeStatuses = [
  'intake_pending',
  'awaiting_consultation',
  'on_hold',
  'plan_proposed',
  'active',
  'under_review',
  'discharged',
  'lost_to_follow_up',
] as const;

export type EpisodeStatus = (typeof episodeStatuses)[number];

export const episodeStatusLabels: Record<EpisodeStatus, string> = {
  intake_pending: 'Intake pending',
  awaiting_consultation: 'Awaiting consultation',
  on_hold: 'On hold',
  plan_proposed: 'Plan proposed',
  active: 'Active',
  under_review: 'Under review',
  discharged: 'Discharged',
  lost_to_follow_up: 'Lost to follow up',
};

/** Statuses an episode can be paused from and return to (On hold, Lost to follow up). */
const pausable = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
  'under_review',
] as const;

/** Blueprint section 13; PRD J6.6: non attendance is never counted as recovered. */
export const dischargeReasons = [
  'goals_achieved',
  'independent_management',
  'referred_on',
  'patient_choice',
  'financial_or_logistical',
  'lost_to_follow_up',
  'other',
] as const;

export type DischargeReason = (typeof dischargeReasons)[number];

export const dischargeReasonLabels: Record<DischargeReason, string> = {
  goals_achieved: 'Goals achieved',
  independent_management: 'Independent management',
  referred_on: 'Referred on',
  patient_choice: 'Patient choice',
  financial_or_logistical: 'Financial or logistical barriers',
  lost_to_follow_up: 'Lost to follow-up',
  other: 'Other',
};

/** How far each goal of the plan was met, marked at discharge (OUT-11, user decision 27 October 2026). */
export const goalOutcomes = ['achieved', 'partly_achieved', 'not_achieved'] as const;

export type GoalOutcome = (typeof goalOutcomes)[number];

export const goalOutcomeLabels: Record<GoalOutcome, string> = {
  achieved: 'Achieved',
  partly_achieved: 'Partly achieved',
  not_achieved: 'Not achieved',
};

/** Reasons that say the patient recovered: only after treatment (Active or Under review). */
const recoveredReasons: readonly DischargeReason[] = ['goals_achieved', 'independent_management'];
const treatedStatuses: readonly EpisodeStatus[] = ['active', 'under_review'];

export const episodeEvents = [
  'submit_intake',
  'propose_plan',
  'activate',
  'start_review',
  'continue',
  'hold',
  'resume',
  'mark_lost',
  'return',
  'discharge',
] as const;

export type EpisodeEvent = (typeof episodeEvents)[number];

/** The moves each event allows: from a status to a status, or back to the paused one. */
const moves: Record<
  EpisodeEvent,
  { from: readonly EpisodeStatus[]; to: EpisodeStatus | 'paused' }
> = {
  submit_intake: { from: ['intake_pending'], to: 'awaiting_consultation' },
  propose_plan: { from: ['awaiting_consultation'], to: 'plan_proposed' },
  activate: { from: ['plan_proposed'], to: 'active' },
  start_review: { from: ['active'], to: 'under_review' },
  continue: { from: ['under_review'], to: 'active' },
  hold: { from: pausable, to: 'on_hold' },
  resume: { from: ['on_hold'], to: 'paused' },
  mark_lost: { from: [...pausable, 'on_hold'], to: 'lost_to_follow_up' },
  return: { from: ['lost_to_follow_up'], to: 'paused' },
  discharge: { from: [...pausable, 'on_hold', 'lost_to_follow_up'], to: 'discharged' },
};

export interface EpisodeState {
  status: EpisodeStatus;
  /** The status an On hold or Lost to follow up episode returns to. */
  pausedFrom: EpisodeStatus | null;
}

export interface DischargeDetails {
  reason: DischargeReason;
  note?: string;
  /** OUT-11: what the discharge report prints; the machine does not look at them. */
  goals?: { text: string; outcome: GoalOutcome }[];
  ongoingNeeds?: string;
  recommendations?: string;
}

export type EpisodeTransition = { ok: true; next: EpisodeState } | { ok: false; refusal: string };

const eventWords: Record<EpisodeEvent, string> = {
  submit_intake: 'take a health form',
  propose_plan: 'get a proposed plan',
  activate: 'become active',
  start_review: 'start a review',
  continue: 'continue after a review',
  hold: 'be put on hold',
  resume: 'resume',
  mark_lost: 'be marked lost to follow up',
  return: 'return from lost to follow up',
  discharge: 'be discharged',
};

const refuse = (refusal: string): EpisodeTransition => ({ ok: false, refusal });

/**
 * The state after `event`, or why it is refused. On hold keeps the status it paused (and Lost to
 * follow up keeps the one before, through a hold too), so resume and return go back there.
 */
export function episodeTransition(
  state: EpisodeState,
  event: EpisodeEvent,
  discharge?: DischargeDetails,
): EpisodeTransition {
  const move = moves[event];
  if (!move.from.includes(state.status)) {
    return refuse(
      state.status === 'discharged'
        ? 'The episode is discharged; a new problem or a recurrence opens a new episode.'
        : `An episode that is ${episodeStatusLabels[state.status]} cannot ${eventWords[event]}.`,
    );
  }
  if (move.to === 'paused') {
    if (!state.pausedFrom) return refuse('The episode has no status to go back to.');
    return { ok: true, next: { status: state.pausedFrom, pausedFrom: null } };
  }
  if (event === 'discharge') {
    if (!discharge) return refuse('Choose the discharge reason.');
    const before = state.status === 'on_hold' && state.pausedFrom ? state.pausedFrom : state.status;
    if (recoveredReasons.includes(discharge.reason) && !treatedStatuses.includes(before)) {
      return refuse(
        `${dischargeReasonLabels[discharge.reason]} needs treatment first: the episode was ${episodeStatusLabels[before]}. Non attendance is never counted as recovered.`,
      );
    }
    if (discharge.reason === 'other' && !discharge.note?.trim()) {
      return refuse('Say why the episode is discharged.');
    }
    return { ok: true, next: { status: 'discharged', pausedFrom: null } };
  }
  if (move.to === 'on_hold' || move.to === 'lost_to_follow_up') {
    // A hold then lost keeps the status from before the hold.
    const pausedFrom = state.status === 'on_hold' ? state.pausedFrom : state.status;
    return { ok: true, next: { status: move.to, pausedFrom } };
  }
  return { ok: true, next: { status: move.to, pausedFrom: null } };
}

/** Every status change the machine allows, as from → to pairs (the database trigger's table). */
export function allowedStatusPairs(): [EpisodeStatus, EpisodeStatus][] {
  const pairs = new Set<string>();
  for (const event of episodeEvents) {
    const move = moves[event];
    for (const from of move.from) {
      const targets: readonly EpisodeStatus[] = move.to === 'paused' ? pausable : [move.to];
      for (const to of targets) pairs.add(`${from}>${to}`);
    }
  }
  return [...pairs].sort().map((pair) => pair.split('>') as [EpisodeStatus, EpisodeStatus]);
}

/** Opening an episode (SCH-07 calls it when a consultation is booked for a new problem). */
export const openEpisodeSchema = z.object({
  patientId: z.guid(),
  centreId: z.guid(),
  bodyRegion: z.enum(screeningRegions).optional(),
  linkedEpisodeId: z.guid().optional(),
});

/**
 * A recurrence (SCH-14, PRD J7.5): from a consultation, the consultant links its episode to the
 * discharged one it is the same problem as, or removes the link (null).
 */
export const recurrenceLinkSchema = z.object({
  consultationId: z.guid(),
  linkedEpisodeId: z.guid().nullable(),
});
