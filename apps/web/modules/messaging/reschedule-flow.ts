import 'server-only';
import {
  SlotRefusedError,
  bookAppointment,
  bookingCounterOf,
  centreContacts,
  centreList,
  changeAppointment,
  createFlowSession,
  datesWithFreeSlots,
  flowSessionRecord,
  freeSlots,
  markFlowBooked,
  movableAppointment,
  packageRescheduleState,
  placeHold,
  queueMessage,
  saveFlowState,
  upcomingAppointmentsOnPhone,
  type Db,
  type DbOrTransaction,
  type MovableAppointment,
  type WhatsappFlowSession,
} from '@clinic-mx/db';
import {
  SESSION_REPLY_VERSION,
  TEMPLATE_LANGUAGE,
  documentTime,
  indianPhoneSchema,
  isChangeable,
  istDate,
  rescheduleRefusalMessages,
  selfRescheduleCheck,
  slotRefusalMessages,
  type AppointmentStatus,
  type SelfRescheduleCheck,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import {
  MAX_ITEMS,
  blocked,
  flowDate,
  type FlowScreenResponse,
  type FlowStepRequest,
  type FlowStepResult,
} from './booking-flow';

/**
 * The WhatsApp reschedule Flow (WA-05; PRD J1.7, J1.8; Frontend Specification, Reschedule), screen
 * by screen, for its data endpoint. The Flow token is our session's id: from the menu it holds
 * the number, and the form first lists the upcoming appointments of everyone on it; from the day
 * before reminder it names the appointment. The clinic, physio and type stay as booked; the
 * patient picks a date in the next `booking.whatsapp_days_ahead` days and a time (user decisions,
 * 31 October 2026), the old time counting as free. Confirm moves it as the front desk's
 * reschedule does, in one transaction (the old slot is given up only for the new booking), asked
 * by the patient, on WhatsApp, with no staff member: the database counts it (SCH-09) and takes
 * one of the package's reschedules (SCH-10). Cancelling stays with the clinic (decision 11).
 */

interface RescheduleState {
  appointmentId?: string;
  /** The reminder's token names the appointment; from the menu they pick it. */
  fixed?: boolean;
  date?: string;
  time?: string;
  done?: { details: string; appointment: string };
}

interface Rules {
  step: number;
  daysAhead: number;
  holdMinutes: number;
  limits: { reschedules: number; noShows: number };
  neverReschedulable: string[];
  sessionTypes: string[];
  email: string;
}

async function rules(): Promise<Rules> {
  const [
    step,
    daysAhead,
    holdMinutes,
    reschedules,
    noShows,
    neverReschedulable,
    sessionTypes,
    email,
  ] = await Promise.all([
    getSetting('scheduling.slot_minutes'),
    getSetting('booking.whatsapp_days_ahead'),
    getSetting('booking.slot_hold_minutes'),
    getSetting('booking.self_booking_block_reschedules'),
    getSetting('booking.self_booking_block_no_shows'),
    getSetting('packages.never_reschedulable_items'),
    getSetting('packages.session_appointment_types'),
    getSetting('whatsapp.front_desk_email'),
  ]);
  return {
    step,
    daysAhead,
    holdMinutes,
    limits: { reschedules, noShows },
    neverReschedulable,
    sessionTypes,
    email,
  };
}

const holderOf = (session: WhatsappFlowSession) => `flow:${session.id}`;

/** "Tue, 3 Nov, 10:00 AM". */
const when = (at: Date) => `${flowDate(istDate(at))}, ${documentTime(at)}`;

/**
 * A session the day before reminder carries (WA-08): it names the appointment and lasts until
 * the appointment starts. Undefined once it has started.
 */
export async function rescheduleFlowToken(
  db: DbOrTransaction,
  appointment: { id: string; phone: string; startsAt: Date },
  now: Date = new Date(),
): Promise<string | undefined> {
  if (appointment.startsAt <= now) return undefined;
  return createFlowSession(db, {
    phone: appointment.phone,
    kind: 'reschedule',
    expiresAt: appointment.startsAt,
    state: { appointmentId: appointment.id, fixed: true },
  });
}

async function appointmentScreen(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  rule: Rules,
  now: Date,
  error?: string,
): Promise<FlowScreenResponse> {
  const upcoming = await upcomingAppointmentsOnPhone(db, session.phone, now);
  if (upcoming.length === 0) {
    return blocked(db, undefined, rule, 'There is no upcoming appointment on this number to move.');
  }
  return {
    screen: 'APPOINTMENT',
    data: {
      appointments: upcoming.slice(0, MAX_ITEMS).map((visit) => ({
        id: visit.id,
        title: when(visit.startsAt),
        description: `${visit.patientName}: ${visit.typeName} with ${visit.physioName}, ${visit.centreName}`,
      })),
      ...(error ? { error_message: error } : {}),
    },
  };
}

type Checked = { visit: MovableAppointment; allowance: SelfRescheduleCheck } | FlowScreenResponse;

/**
 * The appointment the session moves, when it still may be moved by the patient: on this number,
 * Booked or Confirmed, not started, and allowed (`selfRescheduleCheck`). Otherwise the closing
 * screen with the reason and the clinic's contact details.
 */
async function checkedVisit(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  appointmentId: string,
  rule: Rules,
  now: Date,
): Promise<Checked> {
  const visit = await movableAppointment(db, appointmentId);
  if (
    !visit ||
    visit.phone !== session.phone ||
    !isChangeable(visit.status as AppointmentStatus) ||
    visit.startsAt <= now
  ) {
    return blocked(db, visit?.centreId, rule, rescheduleRefusalMessages.not_movable);
  }
  const [counts, packageSession] = await Promise.all([
    bookingCounterOf(db, visit.patientId),
    packageRescheduleState(
      db,
      visit.id,
      { sessionTypes: rule.sessionTypes, neverReschedulable: rule.neverReschedulable },
      now,
    ),
  ]);
  const allowance = selfRescheduleCheck({
    typeKey: visit.typeKey,
    neverReschedulable: rule.neverReschedulable,
    packageSession: packageSession ? { reschedulesLeft: packageSession.reschedulesLeft } : null,
    counts,
    limits: rule.limits,
  });
  if (allowance.refusal) {
    return blocked(db, visit.centreId, rule, rescheduleRefusalMessages[allowance.refusal]);
  }
  return { visit, allowance };
}

/** Free starts with the appointment's own physio on a date, its own time counting as free. */
async function timesOn(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  visit: MovableAppointment,
  date: string,
  rule: Rules,
  now: Date,
): Promise<string[]> {
  const [physio] = await freeSlots(db, {
    centreId: visit.centreId,
    appointmentTypeId: visit.appointmentTypeId,
    physioId: visit.physioId,
    date,
    holder: holderOf(session),
    freeing: visit.id,
    step: rule.step,
    now,
  });
  return (physio?.slots ?? [])
    .filter((slot) => slot.startsAt.getTime() !== visit.startsAt.getTime())
    .map((slot) => slot.startsAt.toISOString());
}

async function dateScreen(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  checked: { visit: MovableAppointment; allowance: SelfRescheduleCheck },
  state: RescheduleState,
  rule: Rules,
  now: Date,
  error?: string,
): Promise<FlowScreenResponse> {
  const { visit, allowance } = checked;
  const dates = (
    await datesWithFreeSlots(db, {
      centreId: visit.centreId,
      appointmentTypeId: visit.appointmentTypeId,
      physioId: visit.physioId,
      from: istDate(now),
      days: rule.daysAhead,
      holder: holderOf(session),
      freeing: visit.id,
      step: rule.step,
      now,
    })
  ).slice(0, MAX_ITEMS);
  const times = state.date ? await timesOn(db, session, visit, state.date, rule, now) : [];
  const [centre] = await centreContacts(db, visit.centreId);
  return {
    screen: 'DATE_TIME',
    data: {
      heading: `${visit.typeName} ${visit.number}`,
      details: [
        `Who: ${visit.patientName}`,
        `Clinic: ${visit.centreName}`,
        `Physio: ${visit.physioName}`,
        `Now: ${when(visit.startsAt)}`,
      ].join('\n'),
      allowance: allowance.lines.join('\n'),
      cancel_note: `To cancel, call the clinic${centre?.phone ? ` on ${centre.phone}` : ''}.`,
      dates: dates.map((date) => ({ id: date, title: flowDate(date) })),
      dates_visible: dates.length > 0,
      no_dates_visible: dates.length === 0,
      times: times
        .slice(0, MAX_ITEMS)
        .map((iso) => ({ id: iso, title: documentTime(new Date(iso)) })),
      times_visible: times.length > 0,
      ...(error ? { error_message: error } : {}),
    },
  };
}

function summaryLines(visit: MovableAppointment, to: Date) {
  return [
    `Who: ${visit.patientName}`,
    `Clinic: ${visit.centreName}`,
    `Physio: ${visit.physioName}`,
    `From: ${when(visit.startsAt)}`,
    `To: ${when(to)}`,
  ];
}

/** The package reschedule allowance's refusals (SCH-10), raised by the database's trigger. */
const packageRefusals: [RegExp, string][] = [
  [/No reschedules left in this package/, rescheduleRefusalMessages.package_used],
  [/cannot be rescheduled at the patient's request/, rescheduleRefusalMessages.treadmill],
];

function packageRefusal(error: unknown): string | undefined {
  const cause = (error as { cause?: { message?: string } }).cause?.message ?? '';
  return packageRefusals.find(([pattern]) => pattern.test(cause))?.[1];
}

/** Moves the held slot's appointment and queues the confirmation text, or throws. */
const confirmMove = systemService({
  component: 'whatsapp',
  input: z.object({ sessionId: z.guid(), rule: z.custom<Rules>(), now: z.date() }),
  run: async (tx, { sessionId, rule, now }): Promise<FlowScreenResponse> => {
    const session = await flowSessionRecord(tx, sessionId, { lock: true });
    if (!session) throw new Error('The Flow session is gone.');
    const state = session.state as RescheduleState;
    // A second confirm (Meta retries a request it got no answer to) moves nothing more.
    if (session.appointmentId && state.done) return { screen: 'DONE', data: state.done };
    if (!state.appointmentId || !state.time) {
      return appointmentScreen(tx, session, rule, now, 'Something changed. Please start again.');
    }
    const checked = await checkedVisit(tx, session, state.appointmentId, rule, now);
    if ('screen' in checked) return checked;
    const { visit } = checked;
    const startsAt = new Date(state.time);
    // PRD J1.7: the old time is given up only for the new booking, in this one transaction.
    const changed = await changeAppointment(tx, {
      appointmentId: visit.id,
      status: 'rescheduled',
      reason: 'patient',
      changedBy: null,
      channel: 'whatsapp',
      now,
    });
    if (!changed) return blocked(tx, visit.centreId, rule, rescheduleRefusalMessages.not_movable);
    const booked = await bookAppointment(tx, {
      centreId: visit.centreId,
      physioId: visit.physioId,
      appointmentTypeId: visit.appointmentTypeId,
      startsAt,
      holder: holderOf(session),
      patientId: visit.patientId,
      episodeId: visit.episodeId ?? undefined,
      channel: 'whatsapp',
      rescheduledFromId: visit.id,
      step: rule.step,
      now,
    });
    await markFlowBooked(tx, session.id, booked.id);
    const lines = summaryLines(visit, startsAt).filter((line) => !line.startsWith('From:'));
    const done = {
      appointment: booked.number,
      details: [`Appointment ${booked.number} (was ${visit.number})`, ...lines].join('\n'),
    };
    await saveFlowState(tx, session.id, { ...state, done });
    const centre = (await centreList(tx)).find((c) => c.id === visit.centreId);
    // The confirmation text, as the booking Flow's, until WA-07's approved template.
    const text = [
      `Your appointment is moved: ${booked.number} (was ${visit.number}).`,
      ...lines,
      ...(centre?.mapLink ? [`Map: ${centre.mapLink}`] : []),
      'Please arrive 10 minutes early.',
      ...(centre?.phone ? [`Front desk: ${centre.phone}`] : []),
    ].join('\n');
    await queueMessage(tx, {
      patientId: visit.patientId,
      toPhone: session.phone,
      kind: 'session',
      templateKey: 'reschedule_confirmation',
      templateVersion: SESSION_REPLY_VERSION,
      language: TEMPLATE_LANGUAGE,
      variables: { text },
      createdBy: 'system:whatsapp',
    });
    return { screen: 'DONE', data: done };
  },
});

const holdSlot = systemService({
  component: 'whatsapp',
  input: z.object({
    holder: z.string(),
    visit: z.custom<MovableAppointment>(),
    startsAt: z.date(),
    rule: z.custom<Rules>(),
    now: z.date(),
  }),
  run: (tx, { holder, visit, startsAt, rule, now }) =>
    placeHold(tx, {
      centreId: visit.centreId,
      physioId: visit.physioId,
      appointmentTypeId: visit.appointmentTypeId,
      startsAt,
      holder,
      freeing: visit.id,
      holdMinutes: rule.holdMinutes,
      step: rule.step,
      now,
    }),
});

const choice = z.string().trim().min(1).max(200);

/**
 * One screen of the reschedule Flow. `db` is the owner connection: the person is not a signed in
 * user, the session's number decides what they may see, and every write is a system service.
 */
export async function rescheduleFlowStep(
  db: Db,
  request: FlowStepRequest,
  now: Date = new Date(),
): Promise<FlowStepResult> {
  const id = z.guid().safeParse(request.flow_token);
  const session = id.success ? await flowSessionRecord(db, id.data) : undefined;
  if (!session || session.kind !== 'reschedule' || session.expiresAt <= now) {
    return { unknownToken: true };
  }
  const rule = await rules();
  const state = session.state as RescheduleState;
  if (state.done) return { screen: 'DONE', data: state.done };
  if (!indianPhoneSchema.safeParse(session.phone).success) {
    return blocked(db, undefined, rule, 'Online changes are for Indian mobile numbers.');
  }
  const data = request.data ?? {};
  const save = (next: RescheduleState) => saveFlowState(db, session.id, { ...next });
  const restart = (error?: string) =>
    state.fixed && state.appointmentId
      ? opened(state.appointmentId, { appointmentId: state.appointmentId, fixed: true }, error)
      : appointmentScreen(db, session, rule, now, error);

  async function opened(
    appointmentId: string,
    next: RescheduleState,
    error?: string,
  ): Promise<FlowScreenResponse> {
    const checked = await checkedVisit(
      db,
      session as WhatsappFlowSession,
      appointmentId,
      rule,
      now,
    );
    if ('screen' in checked) return checked;
    try {
      return await dateScreen(db, session as WhatsappFlowSession, checked, next, rule, now, error);
    } catch (refused) {
      if (!(refused instanceof SlotRefusedError)) throw refused;
      return blocked(
        db,
        checked.visit.centreId,
        rule,
        'Online changes are not available just now.',
      );
    }
  }

  if (request.action !== 'data_exchange') return restart();

  switch (data.step) {
    case 'appointment': {
      if (state.fixed) return restart();
      const picked = choice.safeParse(data.appointment);
      const upcoming = await upcomingAppointmentsOnPhone(db, session.phone, now);
      const visit = upcoming.find((v) => v.id === (picked.success ? picked.data : ''));
      if (!visit) return appointmentScreen(db, session, rule, now, 'Pick an appointment.');
      const next = { appointmentId: visit.id };
      await save(next);
      return opened(visit.id, next);
    }
    case 'date': {
      const date = z.iso.date().safeParse(data.date);
      if (!state.appointmentId) return restart('Please start again.');
      const next = { ...state, date: date.success ? date.data : undefined, time: undefined };
      await save(next);
      return opened(state.appointmentId, next);
    }
    case 'slot': {
      if (!state.appointmentId) return restart('Please start again.');
      const date = z.iso.date().safeParse(data.date);
      const time = choice.safeParse(data.time);
      const next: RescheduleState = {
        ...state,
        date: date.success ? date.data : state.date,
        time: time.success ? time.data : undefined,
      };
      const startsAt = new Date(next.time ?? '');
      if (Number.isNaN(startsAt.getTime())) {
        return opened(state.appointmentId, next, 'Pick a date and a time.');
      }
      const checked = await checkedVisit(db, session, state.appointmentId, rule, now);
      if ('screen' in checked) return checked;
      try {
        await holdSlot(db, {
          holder: holderOf(session),
          visit: checked.visit,
          startsAt,
          rule,
          now,
        });
      } catch (error) {
        if (!(error instanceof SlotRefusedError)) throw error;
        const fresh = { ...next, time: undefined };
        await save(fresh);
        return opened(state.appointmentId, fresh, slotRefusalMessages[error.refusal]);
      }
      await save(next);
      return {
        screen: 'SUMMARY',
        data: {
          summary: [
            `Move ${checked.visit.typeName} ${checked.visit.number}`,
            ...summaryLines(checked.visit, startsAt),
          ].join('\n'),
          allowance: checked.allowance.lines.join('\n'),
        },
      };
    }
    case 'confirm': {
      try {
        return await confirmMove(db, { sessionId: session.id, rule, now });
      } catch (error) {
        const refusal = packageRefusal(error);
        if (refusal) return blocked(db, undefined, rule, refusal);
        if (!(error instanceof SlotRefusedError) || !state.appointmentId) throw error;
        // Taken meanwhile (PRD J1.3): back to the times, which now show the next free ones.
        const fresh = { ...state, time: undefined };
        await save(fresh);
        return opened(state.appointmentId, fresh, slotRefusalMessages[error.refusal]);
      }
    }
    default:
      return restart();
  }
}
