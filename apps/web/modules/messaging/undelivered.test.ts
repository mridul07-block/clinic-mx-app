import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undeliveredFor } from './undelivered';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({ undeliveredMessages: vi.fn(), followUpUndelivered: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_staff: unknown, work: (tx: unknown) => unknown) => work('staff-tx'),
}));
vi.mock('../access/service', () => ({ staffService: () => vi.fn() }));

// WA-13: the Not delivered list is read as the person, only by those who run Today at the centre,
// never by a Velyx support login. Generated ids.
const hsr = '00000000-0000-4000-8000-000000000101';
const kor = '00000000-0000-4000-8000-000000000102';
const person = (role: StaffMember['role'], extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000901',
  email: 'test@clinicmx.test',
  name: 'Test Staff',
  role,
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});

describe('the Not delivered list', () => {
  beforeEach(() => {
    db.undeliveredMessages.mockReset().mockResolvedValue([{ id: 'm1' }]);
  });

  it('is read as the front desk at their centre', async () => {
    expect(await undeliveredFor(person('front_desk'), hsr)).toEqual([{ id: 'm1' }]);
    expect(db.undeliveredMessages).toHaveBeenCalledWith('staff-tx', hsr);
  });

  it('is empty for another centre, a physio, finance and support', async () => {
    for (const [staff, centre] of [
      [person('front_desk'), kor],
      [person('physiotherapist'), hsr],
      [person('finance'), hsr],
      [person('super_admin', { support: true }), hsr],
    ] as const) {
      expect(await undeliveredFor(staff, centre)).toEqual([]);
    }
    expect(db.undeliveredMessages).not.toHaveBeenCalled();
  });
});
