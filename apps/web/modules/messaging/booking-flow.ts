import 'server-only';
import {
  SlotRefusedError,
  appointmentTypeIdByKey,
  bookAppointment,
  bookingCounterOf,
  centreContacts,
  centreList,
  consultationFees,
  datesWithFreeSlots,
  flowSessionRecord,
  freeSlots,
  insertPatient,
  markFlowBooked,
  patientsOnPhone,
  placeHold,
  saveFlowState,
  type Db,
  type DbOrTransaction,
  type WhatsappFlowSession,
} from '@clinic-mx/db';
import {
  contactText,
  documentTime,
  formatRupees,
  indianPhoneSchema,
  istDate,
  selfBookingBlock,
  slotRefusalMessages,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';

/**
 * The WhatsApp booking Flow (WA-04; PRD J1.1 to J1.3, J1.8; TAD section 6), screen by screen, for
 * the data endpoint. The Flow token is our session's id: it says whose number this is, and the
 * session keeps what they picked, so nothing in the form is trusted. Choices (user decisions,
 * 30 October 2026): a clinic, then a date with free consultation slots in the next
 * `booking.whatsapp_days_ahead` days, then a free time, then a physio free then (with their fee),
 * then who is coming (someone already on this number, or someone new), then confirm. Picking the
 * time and physio holds the slot for `booking.slot_hold_minutes`; confirm books it with the same
 * checks as the front desk, and a slot taken meanwhile sends them back to the times with the next
 * free ones. The patient and the appointment are written as `system:whatsapp`, audited.
 */

export type FlowScreenResponse = { screen: string; data: Record<string, unknown> };
export type FlowStepResult = FlowScreenResponse | { unknownToken: true };

export interface FlowStepRequest {
  action: string;
  screen?: string;
  data?: Record<string, unknown>;
  flow_token: string;
}

/** The booking Flow's state on its session. */
interface BookingState {
  centreId?: string;
  date?: string;
  time?: string;
  physioId?: string;
  person?: string;
  name?: string;
  confirmed?: { details: string; appointment: string };
}

/** Meta's limit on the items of one dropdown or radio group. */
export const MAX_ITEMS = 200;
const NEW_PERSON = 'new';

const choice = z.string().trim().min(1).max(200);

interface Rules {
  step: number;
  daysAhead: number;
  holdMinutes: number;
  blockReschedules: number;
  blockNoShows: number;
  email: string;
}

async function rules(): Promise<Rules> {
  const [step, daysAhead, holdMinutes, blockReschedules, blockNoShows, email] = await Promise.all([
    getSetting('scheduling.slot_minutes'),
    getSetting('booking.whatsapp_days_ahead'),
    getSetting('booking.slot_hold_minutes'),
    getSetting('booking.self_booking_block_reschedules'),
    getSetting('booking.self_booking_block_no_shows'),
    getSetting('whatsapp.front_desk_email'),
  ]);
  return { step, daysAhead, holdMinutes, blockReschedules, blockNoShows, email };
}

const holderOf = (session: WhatsappFlowSession) => `flow:${session.id}`;

/** "Mon, 2 Nov" for an IST calendar date. */
export function flowDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

async function activeCentres(db: DbOrTransaction) {
  return (await centreList(db)).filter((centre) => centre.active);
}

/** The closing screen with the team's contact details, after the reason (WA-04, WA-05). */
export async function blocked(
  db: DbOrTransaction,
  centreId: string | undefined,
  rule: { email: string },
  why: string,
): Promise<FlowScreenResponse> {
  const centres = await centreContacts(db, centreId);
  return {
    screen: 'BLOCKED',
    data: { message: `${why} ${contactText({ centres, email: rule.email })}` },
  };
}

function clinicScreen(
  centres: { id: string; name: string }[],
  dates: string[] | null,
  error?: string,
): FlowScreenResponse {
  return {
    screen: 'CLINIC_DATE',
    data: {
      centres: centres.map((centre) => ({ id: centre.id, title: centre.name })),
      dates: (dates ?? []).slice(0, MAX_ITEMS).map((date) => ({ id: date, title: flowDate(date) })),
      dates_visible: (dates ?? []).length > 0,
      no_dates_visible: dates !== null && dates.length === 0,
      ...(error ? { error_message: error } : {}),
    },
  };
}

/** Free consultation starts on the date at the centre, across physios, each once, in order. */
async function timesOn(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  typeId: string,
  state: BookingState,
  rule: Rules,
  now: Date,
) {
  const physios = await freeSlots(db, {
    centreId: state.centreId ?? '',
    appointmentTypeId: typeId,
    date: state.date ?? '',
    holder: holderOf(session),
    step: rule.step,
    now,
  });
  const starts = [
    ...new Set(physios.flatMap((p) => p.slots.map((slot) => slot.startsAt.toISOString()))),
  ].sort();
  return { physios, starts };
}

async function timeScreen(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  typeId: string,
  state: BookingState,
  rule: Rules,
  now: Date,
  extra: { error?: string } = {},
): Promise<FlowScreenResponse> {
  const { physios, starts } = await timesOn(db, session, typeId, state, rule, now);
  const centre = (await activeCentres(db)).find((c) => c.id === state.centreId);
  const free = state.time
    ? physios.filter((p) => p.slots.some((slot) => slot.startsAt.toISOString() === state.time))
    : [];
  const fees = await consultationFees(
    db,
    free.map((p) => p.physioId),
  );
  return {
    screen: 'TIME_PHYSIO',
    data: {
      heading: `${centre?.name ?? ''}, ${flowDate(state.date ?? '')}`,
      times: starts
        .slice(0, MAX_ITEMS)
        .map((iso) => ({ id: iso, title: documentTime(new Date(iso)) })),
      physios: free.map((p) => {
        const fee = fees.get(p.physioId);
        return {
          id: p.physioId,
          title: p.physioName,
          description: fee ? `Fee ${formatRupees(fee.amountPaise)}` : 'Fee shown at the clinic',
        };
      }),
      physios_visible: free.length > 0,
      ...(extra.error ? { error_message: extra.error } : {}),
    },
  };
}

async function personScreen(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  error?: string,
): Promise<FlowScreenResponse> {
  const people = await patientsOnPhone(db, session.phone);
  return {
    screen: 'PERSON',
    data: {
      people: [
        ...people.slice(0, MAX_ITEMS - 1).map((p) => ({ id: p.id, title: p.name })),
        { id: NEW_PERSON, title: 'Someone new' },
      ],
      ...(error ? { error_message: error } : {}),
    },
  };
}

async function details(
  db: DbOrTransaction,
  state: BookingState,
  physioName: string,
  patientName: string,
) {
  const centre = (await activeCentres(db)).find((c) => c.id === state.centreId);
  const fee = (await consultationFees(db, [state.physioId ?? ''])).get(state.physioId ?? '');
  const when = `${flowDate(state.date ?? '')}, ${documentTime(new Date(state.time ?? ''))}`;
  return {
    centre,
    lines: [
      `Who: ${patientName}`,
      `Clinic: ${centre?.name ?? ''}`,
      `When: ${when}`,
      `Physio: ${physioName}`,
      `Consultation fee: ${fee ? `${formatRupees(fee.amountPaise)}, payable at the clinic` : 'payable at the clinic'}`,
    ],
  };
}

async function physioName(
  db: DbOrTransaction,
  session: WhatsappFlowSession,
  typeId: string,
  state: BookingState,
  rule: Rules,
  now: Date,
): Promise<string | undefined> {
  const { physios } = await timesOn(db, session, typeId, state, rule, now);
  return physios.find((p) => p.physioId === state.physioId)?.physioName;
}

/** The person coming: someone on this number (by id), or someone new with a name. */
async function personOf(db: DbOrTransaction, session: WhatsappFlowSession, state: BookingState) {
  if (state.person === NEW_PERSON) return { id: null, name: state.name ?? '' };
  const match = (await patientsOnPhone(db, session.phone)).find((p) => p.id === state.person);
  return match ? { id: match.id, name: match.name } : undefined;
}

async function isBlocked(db: DbOrTransaction, patientId: string | null, rule: Rules) {
  if (!patientId) return false;
  const counts = await bookingCounterOf(db, patientId);
  return selfBookingBlock(counts, {
    reschedules: rule.blockReschedules,
    noShows: rule.blockNoShows,
  }).blocked;
}

const BLOCKED_SELF_BOOKING =
  'Online booking is paused for this patient after several reschedules or missed visits. Our front desk will book for you.';

/** Books the held slot and queues the confirmation text, or throws `SlotRefusedError`. */
const confirmBooking = systemService({
  component: 'whatsapp',
  input: z.object({
    sessionId: z.guid(),
    typeId: z.guid(),
    rule: z.custom<Rules>(),
    now: z.date(),
  }),
  run: async (tx, { sessionId, typeId, rule, now }): Promise<FlowScreenResponse> => {
    const session = await flowSessionRecord(tx, sessionId, { lock: true });
    if (!session) throw new Error('The Flow session is gone.');
    const state = session.state as BookingState;
    // A second confirm (Meta retries a request it got no answer to) books nothing more.
    if (session.appointmentId && state.confirmed) {
      return { screen: 'CONFIRMED', data: state.confirmed };
    }
    const person = await personOf(tx, session, state);
    if (!person || !state.centreId || !state.physioId || !state.time) {
      return clinicScreen(await activeCentres(tx), null, 'Something changed. Please start again.');
    }
    if (await isBlocked(tx, person.id, rule)) {
      return blocked(tx, state.centreId, rule, BLOCKED_SELF_BOOKING);
    }
    const name = await physioName(tx, session, typeId, state, rule, now);
    const patientId =
      person.id ??
      (
        await insertPatient(tx, {
          name: person.name,
          phone: indianPhoneSchema.parse(session.phone),
          registeredCentreId: state.centreId,
        })
      ).id;
    const booked = await bookAppointment(tx, {
      centreId: state.centreId,
      physioId: state.physioId,
      appointmentTypeId: typeId,
      startsAt: new Date(state.time),
      holder: holderOf(session),
      patientId,
      channel: 'whatsapp',
      step: rule.step,
      now,
    });
    await markFlowBooked(tx, session.id, booked.id);
    const { lines } = await details(tx, state, name ?? '', person.name);
    const confirmed = {
      appointment: booked.number,
      details: [`Appointment ${booked.number}`, ...lines].join('\n'),
    };
    await saveFlowState(tx, session.id, { ...state, confirmed });
    // The database queues the booking confirmation (WA-07) for the new appointment.
    return { screen: 'CONFIRMED', data: confirmed };
  },
});

const holdSlot = systemService({
  component: 'whatsapp',
  input: z.object({
    holder: z.string(),
    centreId: z.guid(),
    physioId: z.guid(),
    typeId: z.guid(),
    startsAt: z.date(),
    rule: z.custom<Rules>(),
    now: z.date(),
  }),
  run: (tx, input) =>
    placeHold(tx, {
      centreId: input.centreId,
      physioId: input.physioId,
      appointmentTypeId: input.typeId,
      startsAt: input.startsAt,
      holder: input.holder,
      holdMinutes: input.rule.holdMinutes,
      step: input.rule.step,
      now: input.now,
    }),
});

/**
 * One screen of the booking Flow. `db` is the owner connection: the person is not a signed in
 * user, the session's number decides what they may see, and every write is a system service.
 */
export async function bookingFlowStep(
  db: Db,
  request: FlowStepRequest,
  now: Date = new Date(),
): Promise<FlowStepResult> {
  const id = z.guid().safeParse(request.flow_token);
  const session = id.success ? await flowSessionRecord(db, id.data) : undefined;
  if (!session || session.kind !== 'booking' || session.expiresAt <= now) {
    return { unknownToken: true };
  }
  const rule = await rules();
  const state = session.state as BookingState;
  const centres = await activeCentres(db);
  if (state.confirmed) return { screen: 'CONFIRMED', data: state.confirmed };
  if (!indianPhoneSchema.safeParse(session.phone).success) {
    return blocked(db, undefined, rule, 'Online booking is for Indian mobile numbers.');
  }
  const typeId = await appointmentTypeIdByKey(db, 'consultation');
  if (!typeId) return blocked(db, undefined, rule, 'Online booking is not available just now.');
  const data = request.data ?? {};
  const save = (next: BookingState) => saveFlowState(db, session.id, { ...next });

  if (request.action !== 'data_exchange') return clinicScreen(centres, null);

  switch (data.step) {
    case 'centre': {
      const centreId = choice.safeParse(data.centre);
      const centre = centres.find((c) => c.id === (centreId.success ? centreId.data : ''));
      if (!centre) return clinicScreen(centres, null, 'Pick a clinic.');
      await save({ centreId: centre.id });
      const dates = await datesWithFreeSlots(db, {
        centreId: centre.id,
        appointmentTypeId: typeId,
        from: istDate(now),
        days: rule.daysAhead,
        holder: holderOf(session),
        step: rule.step,
        now,
      });
      return clinicScreen(centres, dates);
    }
    case 'date': {
      const centre = centres.find((c) => c.id === data.centre);
      const date = choice.safeParse(data.date);
      if (!centre || !date.success) return clinicScreen(centres, null, 'Pick a clinic and a date.');
      const next = { centreId: centre.id, date: date.data };
      const { starts } = await timesOn(db, session, typeId, next, rule, now);
      if (starts.length === 0) {
        return clinicScreen(centres, null, 'That day just filled up. Pick another date.');
      }
      await save(next);
      return timeScreen(db, session, typeId, next, rule, now);
    }
    case 'time': {
      const time = choice.safeParse(data.time);
      if (!state.centreId || !state.date) return clinicScreen(centres, null, 'Please start again.');
      const next = {
        centreId: state.centreId,
        date: state.date,
        time: time.success ? time.data : undefined,
      };
      await save(next);
      return timeScreen(db, session, typeId, next, rule, now);
    }
    case 'slot': {
      const time = choice.safeParse(data.time);
      const physio = choice.safeParse(data.physio);
      if (!state.centreId || !state.date) return clinicScreen(centres, null, 'Please start again.');
      const next: BookingState = {
        centreId: state.centreId,
        date: state.date,
        time: time.success ? time.data : undefined,
        physioId: physio.success ? physio.data : undefined,
      };
      const startsAt = new Date(next.time ?? '');
      if (!next.physioId || Number.isNaN(startsAt.getTime())) {
        return timeScreen(db, session, typeId, next, rule, now, {
          error: 'Pick a time and a physio.',
        });
      }
      try {
        await holdSlot(db, {
          holder: holderOf(session),
          centreId: next.centreId ?? '',
          physioId: next.physioId,
          typeId,
          startsAt,
          rule,
          now,
        });
      } catch (error) {
        if (!(error instanceof SlotRefusedError)) throw error;
        const fresh = { centreId: next.centreId, date: next.date };
        await save(fresh);
        return timeScreen(db, session, typeId, fresh, rule, now, {
          error: slotRefusalMessages[error.refusal],
        });
      }
      await save(next);
      return personScreen(db, session);
    }
    case 'person': {
      const person = choice.safeParse(data.person);
      const name = z.string().trim().min(2).max(100).safeParse(data.name);
      if (!person.success) return personScreen(db, session, 'Choose who is coming.');
      if (person.data === NEW_PERSON && !name.success) {
        return personScreen(db, session, 'Enter the full name of the person coming.');
      }
      const next: BookingState = {
        ...state,
        person: person.data,
        name: person.data === NEW_PERSON && name.success ? name.data : undefined,
      };
      const who = await personOf(db, session, next);
      if (!who) return personScreen(db, session, 'Choose who is coming.');
      if (await isBlocked(db, who.id, rule)) {
        return blocked(db, state.centreId, rule, BLOCKED_SELF_BOOKING);
      }
      await save(next);
      const name2 = await physioName(db, session, typeId, next, rule, now);
      const { lines } = await details(db, next, name2 ?? '', who.name);
      return { screen: 'SUMMARY', data: { summary: lines.join('\n') } };
    }
    case 'confirm': {
      try {
        return await confirmBooking(db, { sessionId: session.id, typeId, rule, now });
      } catch (error) {
        if (!(error instanceof SlotRefusedError)) throw error;
        // Taken meanwhile (PRD J1.3): back to the times, which now show the next free ones.
        const fresh = { centreId: state.centreId, date: state.date };
        await save(fresh);
        return timeScreen(db, session, typeId, fresh, rule, now, {
          error: slotRefusalMessages[error.refusal],
        });
      }
    }
    default:
      return clinicScreen(centres, null);
  }
}
