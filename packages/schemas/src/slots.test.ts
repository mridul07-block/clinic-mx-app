import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import {
  cancelAppointmentSchema,
  isChangeable,
  rescheduleAppointmentSchema,
  selfBookingBlock,
  appointmentStatuses,
  checkSlot,
  holdsSlot,
  onGrid,
  slotStarts,
  type Interval,
  type SlotQuery,
} from './slots';

// SCH-04: free starts sit on the 15 minute grid inside the physio's hours, clear of their
// appointments and other holds, after now, with a free machine unit when the type needs one.
const day = '2026-11-02';
const at = (minutes: number) => istInstant(day, minutes);
const span = (from: number, to: number): Interval => ({ startsAt: at(from), endsAt: at(to) });
const times = (query: SlotQuery) =>
  slotStarts(query).map((slot) => (slot.startsAt.getTime() - at(0).getTime()) / 60000);

const base: SlotQuery = {
  windows: [span(9 * 60, 11 * 60)],
  busy: [],
  minutes: 45,
  step: 15,
  now: istInstant('2026-11-01', 0),
};

describe('slotStarts', () => {
  it('steps through the hours on the grid, stopping where the length no longer fits', () => {
    expect(times(base)).toEqual([540, 555, 570, 585, 600, 615]);
    expect(times({ ...base, minutes: 120 })).toEqual([540]);
    expect(times({ ...base, minutes: 135 })).toEqual([]);
  });

  it('keeps each window separate, so a break or leave is never booked across', () => {
    // 09:00 to 10:00 and 10:30 to 11:00 (leave from 10:00 to 10:30 already cut out).
    const windows = [span(540, 600), span(630, 660)];
    expect(times({ ...base, windows, minutes: 30 })).toEqual([540, 555, 570, 630]);
  });

  it('starts an off grid window at the next grid time', () => {
    expect(times({ ...base, windows: [span(545, 630)] })).toEqual([555, 570, 585]);
  });

  it('skips starts that overlap busy time, and allows touching ends (no buffer)', () => {
    const busy = [span(600, 645)];
    expect(times({ ...base, windows: [span(540, 720)], busy })).toEqual([540, 555, 645, 660, 675]);
  });

  it('offers only starts after now', () => {
    expect(times({ ...base, now: at(570) })).toEqual([585, 600, 615]);
    expect(times({ ...base, now: at(571) })).toEqual([585, 600, 615]);
  });

  it('needs one free machine unit, and says which', () => {
    const one = slotStarts({ ...base, machineUnits: [[span(540, 600)]] });
    expect(one.map((slot) => slot.machineUnit)).toEqual([1, 1]);
    expect(one[0]?.startsAt).toEqual(at(600));
    const two = slotStarts({ ...base, machineUnits: [[span(540, 600)], []] });
    expect(two[0]).toMatchObject({ startsAt: at(540), machineUnit: 2 });
    expect(slotStarts({ ...base, machineUnits: [] })).toEqual([]);
    expect(slotStarts(base)[0]?.machineUnit).toBeNull();
  });

  it('counts the grid from midnight IST', () => {
    expect(onGrid(at(555), 15)).toBe(true);
    expect(onGrid(at(560), 15)).toBe(false);
    // 09:00 IST is 03:30 UTC: on an IST grid of 60 minutes, not a UTC one.
    expect(onGrid(at(540), 60)).toBe(true);
  });
});

describe('checkSlot', () => {
  it('accepts a free start and says why any other is refused', () => {
    expect(checkSlot(base, at(570))).toMatchObject({ ok: true, slot: { endsAt: at(615) } });
    expect(checkSlot({ ...base, now: at(600) }, at(570))).toEqual({ ok: false, refusal: 'past' });
    expect(checkSlot(base, at(580))).toEqual({ ok: false, refusal: 'off_grid' });
    expect(checkSlot(base, at(630))).toEqual({ ok: false, refusal: 'outside_hours' });
    expect(checkSlot({ ...base, busy: [span(600, 615)] }, at(570))).toEqual({
      ok: false,
      refusal: 'taken',
    });
    expect(checkSlot({ ...base, machineUnits: [[span(600, 615)]] }, at(570))).toEqual({
      ok: false,
      refusal: 'no_machine',
    });
  });

  it('agrees with slotStarts on every grid time', () => {
    const query = { ...base, busy: [span(600, 645)], machineUnits: [[span(540, 570)]] };
    const free = times(query);
    for (let minutes = 480; minutes < 720; minutes += 15) {
      expect(checkSlot(query, at(minutes)).ok).toBe(free.includes(minutes));
    }
  });
});

describe('holdsSlot', () => {
  it('frees the time only when cancelled or rescheduled', () => {
    const freed = appointmentStatuses.filter((status) => !holdsSlot(status));
    expect(freed).toEqual(['cancelled', 'rescheduled']);
  });
});

// SCH-08: only Booked or Confirmed changes, and who asked is one of two, always given.
describe('reschedule and cancel', () => {
  const appointmentId = '00000000-0000-4000-8000-000000000801';
  it('changes only booked or confirmed appointments', () => {
    expect(appointmentStatuses.filter(isChangeable)).toEqual(['booked', 'confirmed']);
  });

  it('needs who asked: the patient or the clinic', () => {
    expect(cancelAppointmentSchema.parse({ appointmentId, reason: 'patient' }).reason).toBe(
      'patient',
    );
    const missing = cancelAppointmentSchema.safeParse({ appointmentId, reason: '' });
    expect(missing.error?.issues[0]?.message).toBe('Choose who asked for the change.');
    expect(cancelAppointmentSchema.safeParse({ appointmentId, reason: 'staff' }).success).toBe(
      false,
    );
    const move = rescheduleAppointmentSchema.parse({
      appointmentId,
      physioId: appointmentId,
      startsAt: '2026-11-03T05:00:00.000Z',
      reason: 'clinic',
    });
    expect(move.startsAt).toEqual(new Date('2026-11-03T05:00:00.000Z'));
  });
});

// SCH-09 (PRD J1.8): at either limit the patient books through the front desk only.
describe('self booking block', () => {
  const limits = { reschedules: 2, noShows: 2 };
  it('blocks at either limit, reschedules named first', () => {
    expect(selfBookingBlock({ reschedules: 1, noShows: 1 }, limits)).toEqual({
      blocked: false,
      reschedules: 1,
      noShows: 1,
      because: null,
    });
    expect(selfBookingBlock({ reschedules: 2, noShows: 0 }, limits).because).toBe('reschedules');
    expect(selfBookingBlock({ reschedules: 0, noShows: 3 }, limits).because).toBe('no_shows');
    expect(selfBookingBlock({ reschedules: 2, noShows: 2 }, limits)).toMatchObject({
      blocked: true,
      because: 'reschedules',
    });
  });
});
