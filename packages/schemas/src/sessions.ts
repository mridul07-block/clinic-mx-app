import { episodeStatusLabels, type EpisodeStatus } from './episodes';

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
