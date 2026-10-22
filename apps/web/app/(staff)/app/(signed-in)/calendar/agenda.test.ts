import type { CalendarAppointment, CalendarColumn, CalendarDay } from '@clinic-mx/db';
import { describe, expect, it } from 'vitest';
import { agendaRows, type AgendaRow } from './agenda';
import { calendarHref } from './links';

// IST 2 November 2026; generated names only.
const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00+05:30`);

function appointment(id: string, starts: string, ends: string, status = 'booked') {
  return {
    id,
    number: `MVH-${id}`,
    patientId: `p${id}`,
    patientName: `Test Patient ${id}`,
    opNumber: `OP-${id}`,
    typeName: 'Session',
    startsAt: at(starts),
    endsAt: at(ends),
    status,
    channel: 'whatsapp',
    bookedByName: null,
    machineUnit: null,
    episodeId: null,
  } as CalendarAppointment;
}

function column(
  physioName: string,
  appointments: CalendarAppointment[],
  free: string[] = [],
): CalendarColumn {
  return {
    physioId: physioName.toLowerCase().replace(/\s/g, '-'),
    physioName,
    consultant: false,
    fee: null,
    hours: [{ startsAt: at('09:00'), endsAt: at('13:00') }],
    freeCells: free.map(at),
    held: [],
    appointments,
  };
}

const day: CalendarDay = {
  span: { startsAt: at('09:00'), endsAt: at('13:00') },
  columns: [
    column(
      'Test Physio B',
      [appointment('1', '10:00', '10:45'), appointment('2', '09:00', '09:45', 'cancelled')],
      ['09:00', '09:15', '09:30', '11:00', '11:15'],
    ),
    column('Test Physio A', [appointment('3', '10:00', '10:30')], ['09:00']),
  ],
};

const describeRow = (row: AgendaRow) =>
  row.kind === 'appointment'
    ? `${row.appointment.id} ${row.physioName}`
    : row.kind === 'free'
      ? `free ${String(row.starts.length)}`
      : 'now';

const before = at('08:00').getTime();

describe('the phone agenda', () => {
  it('lists everyone’s appointments by time, then physio, without free time', () => {
    const rows = agendaRows(day, { now: before, step: 15 });
    expect(rows.map(describeRow)).toEqual([
      '2 Test Physio B',
      '3 Test Physio A',
      '1 Test Physio B',
    ]);
  });

  it('merges one physio’s free cells into gaps, kept cancelled ones in place', () => {
    const rows = agendaRows(day, { physioId: 'test-physio-b', now: before, step: 15 });
    expect(rows.map(describeRow)).toEqual([
      '2 Test Physio B',
      'free 3',
      '1 Test Physio B',
      'free 2',
    ]);
    const gap = rows[1];
    expect(gap?.kind === 'free' && gap.endsAt).toEqual(at('09:45'));
    const last = rows[3];
    expect(last?.kind === 'free' && last.starts).toEqual([at('11:00'), at('11:15')]);
  });

  it('puts now before the first later row, and nowhere outside the day', () => {
    const rows = agendaRows(day, { now: at('10:10').getTime(), step: 15 });
    expect(rows.map(describeRow)).toEqual([
      '2 Test Physio B',
      '3 Test Physio A',
      '1 Test Physio B',
      'now',
    ]);
    const early = agendaRows(day, { now: at('09:05').getTime(), step: 15 });
    expect(early.map(describeRow)[1]).toBe('now');
    expect(agendaRows(day, { now: at('14:00').getTime(), step: 15 })).toHaveLength(3);
  });

  it('keeps the chosen physio in the address', () => {
    expect(
      calendarHref({ centreId: 'c', date: '2026-11-02', physioId: 'p', appointmentId: 'a' }),
    ).toBe('/app/calendar?centre=c&date=2026-11-02&physio=p&appointment=a');
  });
});
