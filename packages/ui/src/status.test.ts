import { describe, expect, it } from 'vitest';
import { appointmentStatuses, toneByAppointmentStatus } from './status';

describe('toneByAppointmentStatus', () => {
  it('shows Checked in in blue, not amber (Frontend Specification section 9)', () => {
    expect(toneByAppointmentStatus.checked_in).toBe('info');
  });

  it('keeps amber for statuses that need attention only', () => {
    const amber = appointmentStatuses.filter((s) => toneByAppointmentStatus[s] === 'waiting');
    expect(amber).toEqual(['running_late']);
  });

  it('keeps red for no shows only', () => {
    const red = appointmentStatuses.filter((s) => toneByAppointmentStatus[s] === 'danger');
    expect(red).toEqual(['no_show']);
  });
});
