import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import { appointmentStatuses } from './slots';
import {
  canCheckIn,
  checkInSchema,
  firstName,
  healthFormOpen,
  healthFormState,
  inTodayFilter,
  needsHealthForm,
  reportAddedBy,
  reportSizeText,
  todayGroup,
  walkInNewPatientSchema,
  walkInSchema,
} from './today';

// INT-01: the Today board's chips, and checking in on the appointment's own IST day.
describe('today board', () => {
  it('puts each status under one chip, leaving cancelled and rescheduled off', () => {
    expect(Object.fromEntries(appointmentStatuses.map((s) => [s, todayGroup(s)]))).toEqual({
      booked: 'to_arrive',
      confirmed: 'to_arrive',
      checked_in: 'here',
      in_progress: 'with_physio',
      completed: 'done',
      no_show: 'done',
      cancelled: undefined,
      rescheduled: undefined,
    });
  });

  it('filters Not confirmed to Booked, and All to what is on the board', () => {
    expect(appointmentStatuses.filter((s) => inTodayFilter(s, 'not_confirmed'))).toEqual([
      'booked',
    ]);
    expect(appointmentStatuses.filter((s) => inTodayFilter(s, undefined))).not.toContain(
      'cancelled',
    );
    expect(appointmentStatuses.filter((s) => inTodayFilter(s, 'done'))).toEqual([
      'completed',
      'no_show',
    ]);
  });

  it('checks in on the appointment’s day in IST only', () => {
    const start = istInstant('2026-11-02', 600);
    expect(canCheckIn(start, istInstant('2026-11-02', 0))).toBe(true);
    expect(canCheckIn(start, istInstant('2026-11-02', 24 * 60 - 1))).toBe(true);
    expect(canCheckIn(start, istInstant('2026-11-03', 0))).toBe(false);
    expect(canCheckIn(start, istInstant('2026-11-01', 24 * 60 - 1))).toBe(false);
  });

  // INT-02: the identity tick, the health form for a first visit, and where it stands.
  it('checks in only with the identity ticked', () => {
    const appointmentId = '00000000-0000-4000-8000-000000000801';
    expect(checkInSchema.safeParse({ appointmentId }).error?.issues[0]?.message).toBe(
      'Tick that you have checked who this is.',
    );
    expect(checkInSchema.safeParse({ appointmentId, identityChecked: true }).success).toBe(true);
  });

  it('gives a health form to a first visit only, and reads its link', () => {
    expect(needsHealthForm({ episodeId: null })).toBe(true);
    expect(needsHealthForm({ episodeId: 'episode' })).toBe(false);
    // Its own submitted form opened the episode (INT-10): still the visit's form.
    expect(needsHealthForm({ episodeId: 'episode' }, { completedAt: new Date() })).toBe(true);
    expect(needsHealthForm({ episodeId: 'episode' }, { completedAt: null })).toBe(false);
    const now = new Date('2026-11-02T05:00:00.000Z');
    const link = {
      expiresAt: new Date('2026-11-02T06:00:00.000Z'),
      revokedAt: null,
      completedAt: null,
    };
    expect(healthFormState(undefined, now)).toBe('not_sent');
    expect(healthFormState(link, now)).toBe('waiting');
    expect(healthFormState({ ...link, completedAt: now }, now)).toBe('submitted');
    expect(healthFormState({ ...link, expiresAt: now }, now)).toBe('expired');
    expect(healthFormState({ ...link, revokedAt: now }, now)).toBe('expired');
    expect(healthFormState(link, now, true)).toBe('declined');
    expect(healthFormState({ ...link, completedAt: now }, now, true)).toBe('submitted');
  });
});

// INT-03: the health form link opens only while the visit is on, and greets by first name.
describe('health form link', () => {
  it('opens while checked in or in consultation, and not otherwise', () => {
    expect(appointmentStatuses.filter(healthFormOpen)).toEqual(['checked_in', 'in_progress']);
  });

  it('greets by the first word of the name only', () => {
    expect(firstName('Test Patient Asha')).toBe('Test');
    expect(firstName('  Ravi   Kumar ')).toBe('Ravi');
    expect(firstName('Meera')).toBe('Meera');
  });
});

// INT-12: a walk in is booked and checked in only after the same identity tick.
describe('walk in', () => {
  const slot = {
    centreId: '00000000-0000-4000-8000-000000000101',
    physioId: '00000000-0000-4000-8000-000000000301',
    appointmentTypeId: '00000000-0000-4000-8000-000000000401',
    startsAt: '2026-11-02T04:30:00.000Z',
  };

  it('needs the identity tick, for a patient on file or a new one', () => {
    const patientId = '00000000-0000-4000-8000-000000000501';
    expect(walkInSchema.safeParse({ ...slot, patientId }).error?.issues[0]?.message).toBe(
      'Tick that you have checked who this is.',
    );
    expect(walkInSchema.safeParse({ ...slot, patientId, identityChecked: true }).success).toBe(
      true,
    );
    const person = { ...slot, name: 'Test Walk In', phone: '9845012345' };
    expect(walkInNewPatientSchema.safeParse(person).success).toBe(false);
    expect(walkInNewPatientSchema.safeParse({ ...person, identityChecked: true }).success).toBe(
      true,
    );
  });
});

// ALT-08: how report lists name a report's size and who added it.
describe('report wording', () => {
  it('names the size and who added it, "staff" when the name is not readable', () => {
    expect(reportSizeText(820 * 1024)).toBe('820 KB');
    expect(reportSizeText(1.44 * 1024 * 1024)).toBe('1.4 MB');
    expect(reportSizeText(10)).toBe('1 KB');
    expect(reportAddedBy({ addedByPatient: true, uploadedByName: null })).toBe('the patient');
    expect(reportAddedBy({ addedByPatient: false, uploadedByName: 'Test Desk' })).toBe('Test Desk');
    expect(reportAddedBy({ addedByPatient: false, uploadedByName: null })).toBe('staff');
  });
});
