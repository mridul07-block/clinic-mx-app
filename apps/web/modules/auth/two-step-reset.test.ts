import type { DbOrTransaction, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseAdmin } from '../../lib/supabase/admin';
import { NotAllowedError } from '../access/guard';
import { resetTwoStep } from './two-step-reset';

const db = vi.hoisted(() => ({
  authUserIdForStaff: vi.fn<(db: unknown, staffUserId: string) => Promise<string | undefined>>(),
  logAccessEvent: vi.fn<(db: unknown, event: Record<string, unknown>) => Promise<void>>(),
}));
vi.mock('@clinic-mx/db', () => ({
  ...db,
  staffActor: (id: string) => `staff:${id}`,
}));

const member = (role: StaffMember['role']): StaffMember => ({
  id: `00000000-0000-4000-8000-00000000000${role === 'super_admin' ? '1' : '2'}`,
  email: `${role}@clinicmx.test`,
  name: 'Test person',
  role,
  treatsPatients: false,
  consultant: false,
  centreIds: [],
});

function fakeAdmin(factorIds: string[]) {
  const deleteFactor = vi.fn(() => Promise.resolve({ data: {}, error: null }));
  const admin = {
    auth: {
      admin: {
        mfa: {
          listFactors: vi.fn(() =>
            Promise.resolve({ data: { factors: factorIds.map((id) => ({ id })) }, error: null }),
          ),
          deleteFactor,
        },
      },
    },
  } as unknown as SupabaseAdmin;
  return { admin, deleteFactor };
}

const target = '00000000-0000-4000-8000-000000000009';
const fakeDb = {} as DbOrTransaction;

describe('resetTwoStep', () => {
  beforeEach(() => {
    db.authUserIdForStaff.mockReset().mockResolvedValue('auth-user-9');
    db.logAccessEvent.mockReset().mockResolvedValue(undefined);
  });

  it('removes every authenticator app of the staff member and records who did it', async () => {
    const { admin, deleteFactor } = fakeAdmin(['f1', 'f2']);
    const superAdmin = member('super_admin');
    expect(
      await resetTwoStep({ db: fakeDb, admin, ip: '203.0.113.5' }, superAdmin, target),
    ).toEqual({ removed: 2 });
    expect(deleteFactor.mock.calls).toEqual([
      [{ userId: 'auth-user-9', id: 'f1' }],
      [{ userId: 'auth-user-9', id: 'f2' }],
    ]);
    expect(db.logAccessEvent).toHaveBeenCalledWith(fakeDb, {
      actor: `staff:${superAdmin.id}`,
      ip: '203.0.113.5',
      action: 'two_step_reset',
      staffUserId: target,
    });
  });

  it('is refused to every role but the Super Admin, changing nothing', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      const { admin, deleteFactor } = fakeAdmin(['f1']);
      await expect(resetTwoStep({ db: fakeDb, admin }, member(role), target)).rejects.toThrow(
        NotAllowedError,
      );
      expect(deleteFactor).not.toHaveBeenCalled();
    }
    expect(db.logAccessEvent).not.toHaveBeenCalled();
  });

  it('is refused for a staff member without a login', async () => {
    db.authUserIdForStaff.mockResolvedValue(undefined);
    const { admin } = fakeAdmin([]);
    await expect(
      resetTwoStep({ db: fakeDb, admin }, member('super_admin'), target),
    ).rejects.toThrow('no login');
  });
});
