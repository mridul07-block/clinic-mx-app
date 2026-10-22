import type { CalendarDay, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError } from '../access/guard';
import { getSetting } from '../settings/settings';
import { loadCalendar, slotOptions } from './calendar';

const db = vi.hoisted(() => ({
  appointmentTypeList: vi.fn(),
  calendarDay: vi.fn(),
  slotFit: vi.fn(),
  order: [] as string[],
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown => {
    db.order.push('transaction');
    return work({ kind: 'transaction' });
  },
}));
vi.mock('./services', () => ({ holderOf: (actor: { id: string }) => `staff:${actor.id}` }));
// Test value only; the real one is the `scheduling.slot_minutes` row.
vi.mock('../settings/settings', () => ({
  getSetting: vi.fn(() => {
    db.order.push('setting');
    return Promise.resolve(15);
  }),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const whitefield = '00000000-0000-4000-8000-000000000103';
const physioId = '00000000-0000-4000-8000-000000000207';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000204',
  email: 'frontdesk@clinicmx.test',
  name: 'Test Front Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const physio = member({
  id: physioId,
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: true,
});
const day = (): CalendarDay => ({
  span: null,
  columns: [
    {
      physioId,
      physioName: 'Test Physio',
      consultant: true,
      fee: { label: 'Consultation', amountPaise: 75000 },
      hours: [],
      freeCells: [],
      held: [],
      appointments: [],
    },
  ],
});
const query = { centreId: hsr, date: '2026-11-02' };

// SCH-05: the calendar for the booking roles at their centres, a physio's own column, no fees for
// those who may not see prices; the free slot drawer's options say why a type does not fit.
describe('the calendar', () => {
  beforeEach(() => {
    db.calendarDay.mockReset().mockResolvedValue(day());
    db.appointmentTypeList.mockReset();
    db.slotFit.mockReset();
    db.order.length = 0;
  });

  it('shows the front desk every physio at its centre, with fees', async () => {
    const shown = await loadCalendar(member(), query);
    expect(db.calendarDay).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({ centreId: hsr, physioId: undefined, step: 15 }),
    );
    expect(shown.columns[0]?.fee).toEqual({ label: 'Consultation', amountPaise: 75000 });
    await expect(loadCalendar(member(), { ...query, centreId: whitefield })).rejects.toThrow(
      NotAllowedError,
    );
    await expect(loadCalendar(member(), { ...query, date: 'Monday' })).rejects.toThrow(z.ZodError);
  });

  it('gives a physio their own column, without prices, and refuses Finance', async () => {
    const shown = await loadCalendar(physio, query);
    expect(db.calendarDay).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({ physioId }),
    );
    expect(shown.columns[0]?.fee).toBeNull();
    await expect(loadCalendar(member({ role: 'finance', centreIds: [] }), query)).rejects.toThrow(
      NotAllowedError,
    );
  });

  it('reads the slot length before the transaction opens', async () => {
    await loadCalendar(member(), query);
    expect(db.order).toEqual(['setting', 'transaction']);
  });

  it('lists each active type at a free start, with why one does not fit', async () => {
    db.appointmentTypeList.mockResolvedValue([
      { id: 'session', name: 'Session', active: true },
      { id: 'consultation', name: 'Consultation', active: true },
      { id: 'old', name: 'Old type', active: false },
    ]);
    const startsAt = new Date('2026-11-02T04:30:00.000Z');
    db.slotFit
      .mockResolvedValueOnce({
        ok: true,
        slot: { startsAt, endsAt: new Date(startsAt.getTime() + 45 * 60000), machineUnit: null },
      })
      .mockResolvedValueOnce({ ok: false, refusal: 'needs_consultant' });
    expect(await slotOptions(member(), { centreId: hsr, physioId, startsAt })).toEqual([
      { appointmentTypeId: 'session', name: 'Session', minutes: 45, refusal: null },
      {
        appointmentTypeId: 'consultation',
        name: 'Consultation',
        minutes: null,
        refusal: 'This appointment is booked with a consultant. Pick a consultant physio.',
      },
    ]);
    expect(vi.mocked(getSetting)).toHaveBeenCalledWith('scheduling.slot_minutes');
    // A physio asks only about their own column.
    expect(
      await slotOptions(member({ id: 'someone', role: 'physiotherapist', treatsPatients: true }), {
        centreId: hsr,
        physioId,
        startsAt,
      }),
    ).toEqual([]);
  });
});
