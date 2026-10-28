import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { approveVersion } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  approveKnowledgeVersion: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const versionId = '00000000-0000-4000-8000-000000000b01';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000201',
  email: 'admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });

// SET-06 done when: the Super Admin approves a version; records store the version used (the
// database tests hold the rest: the live version, the guard, who may approve).
describe('approving a knowledge base version', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.approveKnowledgeVersion.mockResolvedValue(2);
  });

  it('approves with a trimmed note, once the Super Admin confirms', async () => {
    expect(
      await approveVersion(context(), { versionId, notes: ' Report read ', confirmed: true }),
    ).toBe(2);
    expect(db.approveKnowledgeVersion).toHaveBeenCalledWith(fakeTx, {
      versionId,
      notes: 'Report read',
    });
    await approveVersion(context(), { versionId, notes: '', confirmed: true });
    expect(db.approveKnowledgeVersion).toHaveBeenLastCalledWith(fakeTx, {
      versionId,
      notes: undefined,
    });
  });

  it('needs the confirmation and a version', async () => {
    await expect(approveVersion(context(), { versionId, confirmed: false })).rejects.toThrow(
      z.ZodError,
    );
    await expect(approveVersion(context(), { versionId: '', confirmed: true })).rejects.toThrow(
      z.ZodError,
    );
    expect(db.approveKnowledgeVersion).not.toHaveBeenCalled();
  });

  it('is for the Super Admin only, and read only for Velyx support', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      await expect(
        approveVersion(context(member({ role, treatsPatients: role === 'physiotherapist' })), {
          versionId,
          confirmed: true,
        }),
      ).rejects.toThrow(NotAllowedError);
    }
    await expect(
      approveVersion(context(member({ support: true })), { versionId, confirmed: true }),
    ).rejects.toThrow(ReadOnlyError);
    expect(db.approveKnowledgeVersion).not.toHaveBeenCalled();
  });
});
