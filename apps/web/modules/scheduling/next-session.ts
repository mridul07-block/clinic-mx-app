import 'server-only';
import {
  appointmentTypeIdByKey,
  bookAppointment,
  episodeRecord,
  freeSlots,
  planFrequencyOf,
  sessionNoteOf,
  sessionVisit,
  type DbOrTransaction,
  type StaffMember,
} from '@clinic-mx/db';
import {
  bookNextSessionSchema,
  can,
  istDate,
  nextSessionDate,
  nextSessionTimesSchema,
  type FreeSlot,
} from '@clinic-mx/schemas';
import { assertCan, assertMay } from '../access/guard';
import { staffService, type ServiceContext } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';
import { sessionsLeft } from './plan-sessions';
import { SchedulingError } from './services';

/**
 * The physio books the next session (SCH-12; PRD access table "Own schedule; book a patient's next
 * session"; docs/runbooks/calendar.md). On the session screen, the physio who writes the note
 * books their own free time at the visit's centre, a Session in the visit's Active episode, capped
 * like Book plan sessions (SCH-11). No hold: the start is rechecked under lock when booked. User
 * decisions, 26 October 2026.
 */

export interface NextSessionPanel {
  appointmentId: string;
  /** The plan's sessions left to book. */
  toBook: number;
  /** The date offered first, from the plan's frequency. */
  defaultDate: string;
  /** Today in IST, the earliest date. */
  today: string;
}

/** The holder name of a next session booking: never the physio's own hold. */
const holderOf = (actor: StaffMember) => `next-session:${actor.id}`;

/** The session, when the caller writes its note, with its episode and what is left to book. */
async function contextOf(
  tx: DbOrTransaction,
  actor: StaffMember,
  appointmentId: string,
  sessionKeys: readonly string[],
  now: Date,
) {
  const visit = await sessionVisit(tx, appointmentId);
  if (!visit?.episodeId) return undefined;
  const stored = await sessionNoteOf(tx, visit.id);
  const writer = stored?.physioId ?? visit.startedBy ?? visit.physioId;
  if (writer !== actor.id) return undefined;
  const episode = await episodeRecord(tx, visit.episodeId);
  const frequency = await planFrequencyOf(tx, visit.episodeId);
  const left = await sessionsLeft(tx, visit.episodeId, frequency, sessionKeys, now);
  const typeKey = sessionKeys.at(0);
  const typeId = typeKey ? await appointmentTypeIdByKey(tx, typeKey) : undefined;
  return { visit: { ...visit, episodeId: visit.episodeId }, episode, left, typeId };
}

type Context = Awaited<ReturnType<typeof contextOf>>;

/** Why the next session cannot be booked now, or nothing. */
function refusalOf(context: Context): string | undefined {
  if (!context) return 'Only the physio writing this session books its next one.';
  if (context.episode?.status !== 'active') return 'Book the next session once the plan is paid.';
  if (!context.typeId) return 'The Session appointment type is not set up.';
  if (context.left.toBook === 0) return 'All planned sessions are booked.';
  return undefined;
}

/**
 * The Next session panel for the session's writer in an Active episode; undefined for anyone else,
 * so readers never see it.
 */
export async function nextSessionPanel(
  actor: StaffMember,
  appointmentId: string,
): Promise<NextSessionPanel | undefined> {
  if (actor.support || !can(actor, 'bookings.book_next_session')) return undefined;
  const sessionKeys = await getSetting('packages.session_appointment_types');
  return asStaff(actor, async (tx) => {
    const now = new Date();
    const context = await contextOf(tx, actor, appointmentId, sessionKeys, now);
    if (!context || context.episode?.status !== 'active' || !context.typeId) return undefined;
    if (!can(actor, 'bookings.book_next_session', { centreId: context.visit.centreId })) {
      return undefined;
    }
    const today = istDate(now);
    return {
      appointmentId,
      toBook: context.left.toBook,
      defaultDate: nextSessionDate(today, context.left.sessionsPerWeek),
      today,
    };
  });
}

/** The physio's own free starts on a date at the session's centre. */
export async function nextSessionTimes(actor: StaffMember, rawInput: unknown): Promise<FreeSlot[]> {
  assertMay(actor, 'bookings.book_next_session');
  const input = nextSessionTimesSchema.parse(rawInput);
  const [sessionKeys, step] = await Promise.all([
    getSetting('packages.session_appointment_types'),
    getSetting('scheduling.slot_minutes'),
  ]);
  return asStaff(actor, async (tx) => {
    const now = new Date();
    const context = await contextOf(tx, actor, input.appointmentId, sessionKeys, now);
    const refusal = refusalOf(context);
    if (refusal || !context) throw new SchedulingError(refusal);
    assertCan(actor, 'bookings.book_next_session', { centreId: context.visit.centreId });
    if (input.date < istDate(now)) throw new SchedulingError('Pick today or later.');
    const [mine] = await freeSlots(tx, {
      centreId: context.visit.centreId,
      appointmentTypeId: context.typeId ?? '',
      date: input.date,
      physioId: actor.id,
      holder: holderOf(actor),
      step,
      now,
    });
    return mine?.slots ?? [];
  });
}

/**
 * Books the picked start with the physio, rechecked under lock: a Session in the visit's episode,
 * booked by them. A start no longer free is refused with the slot engine's words.
 */
export async function bookNextSession(
  context: ServiceContext,
  rawInput: unknown,
): Promise<{ id: string; number: string; startsAt: Date }> {
  const [sessionKeys, step] = await Promise.all([
    getSetting('packages.session_appointment_types'),
    getSetting('scheduling.slot_minutes'),
  ]);
  return staffService({
    action: 'bookings.book_next_session',
    input: bookNextSessionSchema,
    target: async (input, tx) => {
      const visit = await sessionVisit(tx, input.appointmentId);
      if (!visit) throw new SchedulingError('That session was not found.');
      return { centreId: visit.centreId };
    },
    run: async (tx, input, actor) => {
      const now = new Date();
      const found = await contextOf(tx, actor, input.appointmentId, sessionKeys, now);
      const refusal = refusalOf(found);
      if (refusal || !found) throw new SchedulingError(refusal);
      const row = await bookAppointment(tx, {
        centreId: found.visit.centreId,
        physioId: actor.id,
        appointmentTypeId: found.typeId ?? '',
        startsAt: input.startsAt,
        holder: holderOf(actor),
        patientId: found.visit.patientId,
        episodeId: found.visit.episodeId,
        channel: 'front_desk',
        bookedBy: actor.id,
        step,
        now,
      });
      return { ...row, startsAt: input.startsAt };
    },
  })(context, rawInput);
}
