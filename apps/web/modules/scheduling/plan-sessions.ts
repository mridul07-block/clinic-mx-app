import 'server-only';
import {
  SlotRefusedError,
  appointmentTypeIdByKey,
  bookAppointment,
  episodeRecord,
  episodeSessionCounts,
  packagesOfEpisode,
  physiosForType,
  planForPricing,
  recordPlanBooking,
  seriesFit,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import {
  bookPlanSessionsSchema,
  can,
  istDate,
  istInstant,
  parseTime,
  planSessionsPatternSchema,
  planSessionsToBook,
  seriesDates,
  seriesStartText,
  weekdaysMessage,
  type EpisodeStatus,
  type PlanSessionsPattern,
  type SeriesRow,
} from '@clinic-mx/schemas';
import { assertCan, assertMay } from '../access/guard';
import { staffService, type ServiceContext } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';
import { SchedulingError } from './services';

/**
 * Book plan sessions (SCH-11, PRD J4.8; docs/runbooks/calendar.md). On the plan and payment sheet,
 * once the episode is Active, those who book at its centre set a weekly pattern; the plan's
 * remaining sessions are checked by the slot engine, the desk resolves each clash (the nearest
 * free times that day, the next day, or Skip), and the series is booked in one transaction,
 * rechecked under lock: all or nothing. The database queues one WhatsApp plan sessions list. The
 * type booked is the first of `packages.session_appointment_types` (Session). User decisions, 26
 * October 2026.
 */

export interface PlanSessionsView extends SessionsLeft {
  episodeId: string;
  centreId: string;
  episodeStatus: EpisodeStatus;
  appointmentTypeId: string | undefined;
  /** Who may take sessions at the centre, by name. */
  physios: { id: string; name: string }[];
  /** The plan's treating physio, suggested when they take sessions at the centre. */
  suggestedPhysioId: string | undefined;
  /** Whether this person books at the episode's centre (not a support login). */
  mayBook: boolean;
  /** Whether this person may book the series now. */
  canBook: boolean;
  /** Today in IST, the earliest start date. */
  today: string;
}

/** What the plan asks for and what is booked: the cap for Book plan sessions and SCH-12. */
export interface SessionsLeft {
  sessionsPerWeek: number | null;
  weeks: number | null;
  /** Sessions a week × weeks; null when the plan sets no frequency. */
  planned: number | null;
  booked: number;
  done: number;
  /** With a package bought: its sessions left; null for pay per session. */
  packageLeft: number | null;
  toBook: number;
}

/**
 * The plan's sessions left to book in an episode (SCH-11, SCH-12): its frequency less the session
 * appointments booked or done, never more than an active package has left less those booked.
 */
export async function sessionsLeft(
  tx: DbOrTransaction,
  episodeId: string,
  frequency: { sessionsPerWeek: number | null; weeks: number | null } | undefined,
  sessionKeys: readonly string[],
  now: Date,
): Promise<SessionsLeft> {
  const { booked, done } = await episodeSessionCounts(tx, episodeId, sessionKeys);
  const bought = (await packagesOfEpisode(tx, episodeId, now)).filter(
    (entry) => entry.state !== 'cancelled',
  );
  const packageLeft =
    bought.length === 0
      ? null
      : bought
          .filter((entry) => entry.state === 'active')
          .reduce((sum, entry) => sum + entry.sessionsLeft, 0);
  const sessionsPerWeek = frequency?.sessionsPerWeek ?? null;
  const weeks = frequency?.weeks ?? null;
  const planned = sessionsPerWeek !== null && weeks !== null ? sessionsPerWeek * weeks : null;
  return {
    sessionsPerWeek,
    weeks,
    planned,
    booked,
    done,
    packageLeft,
    toBook: planSessionsToBook({ planned, booked, done, packageLeft }),
  };
}

/** The holder name of a series booking: never the person's own hold, so that stays busy. */
const seriesHolder = (actor: StaffMember) => `plan-series:${actor.id}`;

async function viewOf(
  tx: DbOrTransaction,
  actor: StaffMember,
  episodeId: string,
  sessionKeys: readonly string[],
  now: Date,
): Promise<PlanSessionsView | undefined> {
  const episode = await episodeRecord(tx, episodeId);
  if (!episode) return undefined;
  const today = istDate(now);
  const plan = await planForPricing(tx, episodeId);
  const left = await sessionsLeft(tx, episodeId, plan, sessionKeys, now);
  const { toBook } = left;
  const typeKey = sessionKeys.at(0);
  const appointmentTypeId = typeKey ? await appointmentTypeIdByKey(tx, typeKey) : undefined;
  const physios = appointmentTypeId
    ? (
        await physiosForType(tx, { centreId: episode.centreId, appointmentTypeId, date: today })
      ).map(({ id, name }) => ({ id, name }))
    : [];
  const suggested = plan?.treatingPhysioId ?? undefined;
  const mayBook = !actor.support && can(actor, 'bookings.manage', { centreId: episode.centreId });
  return {
    episodeId,
    centreId: episode.centreId,
    episodeStatus: episode.status,
    ...left,
    appointmentTypeId,
    physios,
    suggestedPhysioId: physios.some((p) => p.id === suggested) ? suggested : undefined,
    mayBook,
    canBook:
      mayBook && episode.status === 'active' && toBook > 0 && appointmentTypeId !== undefined,
    today,
  };
}

/** Why a pattern cannot be booked now, or nothing. */
function refusalOf(view: PlanSessionsView, pattern: PlanSessionsPattern): string | undefined {
  if (view.episodeStatus !== 'active') return 'Book plan sessions once the plan is paid.';
  if (view.sessionsPerWeek === null || view.planned === null) {
    return 'The plan sets no frequency, so there are no plan sessions to book.';
  }
  if (view.toBook === 0) return 'All planned sessions are booked.';
  if (!view.appointmentTypeId) return 'The Session appointment type is not set up.';
  if (pattern.fromDate < view.today) return 'Start today or later.';
  if (!view.physios.some((p) => p.id === pattern.physioId)) {
    return 'That physio does not take sessions at this centre. Pick another.';
  }
  return weekdaysMessage(pattern.weekdays.length, view.sessionsPerWeek);
}

/** The section on the plan and payment sheet; undefined when the reader does not see the episode. */
export async function planSessionsOf(
  actor: StaffMember,
  episodeId: string,
): Promise<PlanSessionsView | undefined> {
  const sessionKeys = await getSetting('packages.session_appointment_types');
  return asStaff(actor, (tx) => viewOf(tx, actor, episodeId, sessionKeys, new Date()));
}

export interface PlanSessionsPreview {
  rows: SeriesRow[];
}

/**
 * Checks the pattern's dates (the plan's remaining sessions) without booking anything: each date
 * free, or why not with the nearest free times that day and the next.
 */
export async function previewPlanSessions(
  actor: StaffMember,
  rawInput: unknown,
): Promise<PlanSessionsPreview> {
  assertMay(actor, 'bookings.manage');
  const pattern = planSessionsPatternSchema.parse(rawInput);
  const [sessionKeys, step, alternatives] = await Promise.all([
    getSetting('packages.session_appointment_types'),
    getSetting('scheduling.slot_minutes'),
    getSetting('booking.plan_clash_alternatives'),
  ]);
  return asStaff(actor, async (tx) => {
    const now = new Date();
    const view = await viewOf(tx, actor, pattern.episodeId, sessionKeys, now);
    if (!view) throw new SchedulingError('That episode was not found.');
    assertCan(actor, 'bookings.manage', { centreId: view.centreId });
    const refusal = refusalOf(view, pattern);
    if (refusal) throw new SchedulingError(refusal);
    const minutes = parseTime(pattern.time) ?? 0;
    const starts = seriesDates(pattern.fromDate, pattern.weekdays, view.toBook).map((date) =>
      istInstant(date, minutes),
    );
    const rows = await seriesFit(tx, {
      centreId: view.centreId,
      physioId: pattern.physioId,
      appointmentTypeId: view.appointmentTypeId ?? '',
      starts,
      holder: seriesHolder(actor),
      step,
      now,
      alternatives,
    });
    return { rows };
  });
}

export interface PlanSessionsBooked {
  planBookingId: string;
  booked: { id: string; number: string; startsAt: Date }[];
}

/**
 * Books the series the desk kept: the plan_booking row, then each start rechecked under lock. A
 * start no longer free refuses the whole series with the date, so nothing is half booked.
 */
export async function bookPlanSessions(
  context: ServiceContext,
  rawInput: unknown,
): Promise<PlanSessionsBooked> {
  const [sessionKeys, step] = await Promise.all([
    getSetting('packages.session_appointment_types'),
    getSetting('scheduling.slot_minutes'),
  ]);
  return staffService({
    action: 'bookings.manage',
    input: bookPlanSessionsSchema,
    target: async (input, tx) => {
      const episode = await episodeRecord(tx, input.episodeId);
      if (!episode) throw new SchedulingError('That episode was not found.');
      return { centreId: episode.centreId };
    },
    run: async (tx, input, actor) => {
      const now = new Date();
      const view = await viewOf(tx, actor, input.episodeId, sessionKeys, now);
      if (!view) throw new SchedulingError('That episode was not found.');
      const refusal = refusalOf(view, input);
      if (refusal) throw new SchedulingError(refusal);
      if (input.starts.length > view.toBook) {
        throw new SchedulingError(
          `Only ${String(view.toBook)} sessions are left to book. Check dates again.`,
        );
      }
      const episode = await episodeRecord(tx, input.episodeId);
      if (!episode) throw new SchedulingError('That episode was not found.');
      const appointmentTypeId = view.appointmentTypeId ?? '';
      const planBookingId = await recordPlanBooking(tx, {
        episodeId: input.episodeId,
        centreId: view.centreId,
        physioId: input.physioId,
        appointmentTypeId,
        fromDate: input.fromDate,
        weekdays: input.weekdays,
        time: input.time,
        bookedBy: actor.id,
      });
      const starts = [...input.starts].sort((a, b) => a.getTime() - b.getTime());
      const booked: PlanSessionsBooked['booked'] = [];
      for (const startsAt of starts) {
        try {
          const row = await bookAppointment(tx, {
            centreId: view.centreId,
            physioId: input.physioId,
            appointmentTypeId,
            startsAt,
            holder: seriesHolder(actor),
            patientId: episode.patientId,
            episodeId: input.episodeId,
            channel: 'front_desk',
            bookedBy: actor.id,
            planBookingId,
            step,
            now,
          });
          booked.push({ ...row, startsAt });
        } catch (error) {
          if (error instanceof SlotRefusedError) {
            throw new SchedulingError(
              `${seriesStartText(startsAt)} is no longer free. Nothing was booked. Check dates again.`,
            );
          }
          throw error;
        }
      }
      return { planBookingId, booked };
    },
  })(context, rawInput);
}
