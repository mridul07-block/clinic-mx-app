import 'server-only';
import {
  alertForUpdate,
  consultationRecord,
  consultationRedFlags,
  episodeRecord,
  insertConsultationRedFlag,
  moveRedFlagAlert,
  openEmergencies,
  openRedFlagAlerts,
  recentlyClosedAlerts,
  redFlagAlertsByIds,
  type AlertMove,
  type ConsultationRedFlagEntry,
  type RedFlagAlertEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  alertDisplay,
  alertOrder,
  alertTransition,
  can,
  closeAlertSchema,
  episodeTransition,
  istDate,
  recordRedFlagSchema,
  redFlagTriageActions,
  referAlertSchema,
  reviewAlertSchema,
  triageRefers,
  type AlertEvent,
} from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService, type ServiceTransaction } from '../access/service';
import { asStaff } from '../access/staff-db';
import { changeEpisodeStatus } from '../episodes/services';
import { calendarHref } from '../scheduling/links';

/**
 * Red flag alerts after they are raised (ALT-01, PRD M11): clinicians say "I'm reviewing" (which
 * ends the emergency banner), refer (which puts the episode On hold, PRD J3.10) and close with a
 * written decision; the Super Admin and Centre Managers see them all at their centres; the front
 * desk sees only the banner, without clinical detail. Decisions (user, 23 October 2026): only
 * clinicians act; the banner shows to everyone at the patient's centre but Finance.
 */

/** A refusal to show staff as it is. */
export class AlertError extends Error {
  override name = 'AlertError';
}

/** How many closed alerts the list keeps below the open ones. */
const RECENTLY_CLOSED_SHOWN = 20;

export interface AlertsView {
  open: RedFlagAlertEntry[];
  recentlyClosed: RedFlagAlertEntry[];
  /** Whether the signed in person reviews, refers and closes (a clinician). */
  canAct: boolean;
}

/** The alerts list: open ones, emergencies first, then the most recently closed. */
export async function alertsOf(actor: StaffMember): Promise<AlertsView> {
  assertMay(actor, 'red_flags.view');
  return asStaff(actor, async (tx) => ({
    open: (await openRedFlagAlerts(tx)).sort(alertOrder),
    recentlyClosed: await recentlyClosedAlerts(tx, RECENTLY_CLOSED_SHOWN),
    canAct: can(actor, 'red_flags.act'),
  }));
}

/**
 * One emergency banner: for clinicians the rule and "I'm reviewing"; for those who see alerts
 * without acting, the rule and the alerts list; for the front desk only the patient.
 */
export interface EmergencyBannerEntry {
  alertId: string;
  patientName: string;
  raisedAt: Date;
  /** The visit on the calendar, for the front desk's "Open patient". */
  visitHref: string;
  /** What only alert readers see. */
  clinical?: { name: string; signedOff: boolean; canAct: boolean };
}

/** The banners the signed in person sees on every page: Raised emergencies at their centres. */
export async function emergencyBannersOf(actor: StaffMember): Promise<EmergencyBannerEntry[]> {
  if (actor.support || !can(actor, 'red_flags.view_banner')) return [];
  return asStaff(actor, async (tx) => {
    const emergencies = await openEmergencies(tx);
    const readsAlerts = can(actor, 'red_flags.view');
    const details = readsAlerts
      ? await redFlagAlertsByIds(
          tx,
          emergencies.map((emergency) => emergency.alertId),
        )
      : [];
    const canAct = can(actor, 'red_flags.act');
    return emergencies.map((emergency) => {
      const alert = details.find((detail) => detail.id === emergency.alertId);
      return {
        alertId: emergency.alertId,
        patientName: emergency.patientName,
        raisedAt: emergency.raisedAt,
        visitHref:
          emergency.appointmentId && emergency.startsAt
            ? calendarHref({
                centreId: emergency.centreId,
                date: istDate(emergency.startsAt),
                appointmentId: emergency.appointmentId,
              })
            : '/app/patients',
        clinical: alert ? { name: alert.name, signedOff: alert.signedOff, canAct } : undefined,
      };
    });
  });
}

/** The alert's centre, for the permission check; refused when it is not there to read. */
async function alertCentre(tx: ServiceTransaction, alertId: string) {
  const alert = await alertForUpdate(tx, alertId);
  if (!alert) throw new AlertError('That alert was not found.');
  return { centreId: alert.centreId };
}

/** Moves the alert by `event` if the machine allows it from where it is now. */
async function move(tx: ServiceTransaction, alertId: string, event: AlertEvent, to: AlertMove) {
  const alert = await alertForUpdate(tx, alertId);
  if (!alert) throw new AlertError('That alert was not found.');
  const transition = alertTransition(alert.status, event);
  if (!transition.ok) throw new AlertError(transition.refusal);
  if (!(await moveRedFlagAlert(tx, alertId, alert.status, to))) {
    throw new AlertError('The alert changed meanwhile. Reload and try again.');
  }
  return alert;
}

/** "I'm reviewing": the clinician takes the alert, and its emergency banner ends. */
export const reviewAlert = staffService({
  action: 'red_flags.act',
  input: reviewAlertSchema,
  target: (input, tx) => alertCentre(tx, input.alertId),
  run: async (tx, input, actor) => {
    await move(tx, input.alertId, 'review', { status: 'reviewed', reviewedBy: actor.id });
  },
});

/** A referral puts the episode On hold (PRD J3.10), unless it already is. */
async function holdEpisode(tx: ServiceTransaction, episodeId: string) {
  const current = await episodeRecord(tx, episodeId);
  if (current && episodeTransition(current, 'hold').ok) {
    await changeEpisodeStatus(tx, episodeId, 'hold');
  }
}

/**
 * Refer: where the patient was sent, and for the referral letter (ALT-07) the reason and the
 * question for the specialist; the episode goes On hold. The database queues the letter and the
 * safety advice.
 */
export const referAlert = staffService({
  action: 'red_flags.act',
  input: referAlertSchema,
  target: (input, tx) => alertCentre(tx, input.alertId),
  run: async (tx, input, actor) => {
    const alert = await move(tx, input.alertId, 'refer', {
      status: 'referred',
      referredBy: actor.id,
      referredTo: input.referredTo,
      referralReason: input.reason,
      referralQuestion: input.question,
    });
    await holdEpisode(tx, alert.episodeId);
  },
});

/** The consultation's centre, for the permission check; refused when it is not there to read. */
async function consultationCentre(tx: ServiceTransaction, consultationId: string) {
  const found = await consultationRecord(tx, consultationId);
  if (!found) throw new AlertError('That consultation was not found.');
  return { centreId: found.centreId };
}

/**
 * A red flag the consultant found in the consultation (CLN-11, PRD J3.10; user decisions 25
 * October 2026): recorded as an alert in the framework's category, reviewed by them at once, and,
 * for every category but Monitor with caution, referred with the letter's reason and question,
 * putting the episode On hold. The database queues the referral letter and the safety advice
 * (Monitor with caution: the safety advice only). Only on their own draft.
 */
export const recordConsultationRedFlag = staffService({
  action: 'red_flags.act',
  input: recordRedFlagSchema,
  target: (input, tx) => consultationCentre(tx, input.consultationId),
  run: async (tx, input, actor) => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found || found.physioId !== actor.id || found.status !== 'draft') {
      throw new AlertError('Red flags are recorded on your own consultation, before signing.');
    }
    const alertId = await insertConsultationRedFlag(tx, {
      episodeId: found.episodeId,
      appointmentId: found.appointmentId,
      kbVersionId: found.kbVersionId,
      name: input.found,
      triage: input.triage,
      display: alertDisplay(input.triage),
      action: redFlagTriageActions[input.triage],
    });
    await moveRedFlagAlert(tx, alertId, 'raised', { status: 'reviewed', reviewedBy: actor.id });
    if (triageRefers(input.triage)) {
      await moveRedFlagAlert(tx, alertId, 'reviewed', {
        status: 'referred',
        referredBy: actor.id,
        referredTo: input.referredTo,
        referralReason: input.reason,
        referralQuestion: input.question,
      });
      await holdEpisode(tx, found.episodeId);
    }
    return { alertId };
  },
});

/** The red flags recorded in a consultation, for its Screening step (CLN-11). */
export async function consultationRedFlagsOf(
  actor: StaffMember,
  consultationId: string,
): Promise<ConsultationRedFlagEntry[]> {
  if (!can(actor, 'red_flags.view')) return [];
  return asStaff(actor, async (tx) => {
    const found = await consultationRecord(tx, consultationId);
    return found ? consultationRedFlags(tx, found.appointmentId) : [];
  });
}

/** Close with the clinician's written decision. */
export const closeAlert = staffService({
  action: 'red_flags.act',
  input: closeAlertSchema,
  target: (input, tx) => alertCentre(tx, input.alertId),
  run: async (tx, input, actor) => {
    await move(tx, input.alertId, 'close', {
      status: 'closed',
      closedBy: actor.id,
      decision: input.decision,
    });
  },
});
