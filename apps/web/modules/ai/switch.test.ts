import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { AiSwitchError, switchAiSheet } from './switch';

const stored = vi.hoisted((): { value: unknown } => ({ value: undefined }));
const fakeTx = {
  kind: 'transaction',
  update: vi.fn(() => ({
    set: (values: { value: unknown }) => {
      stored.value = values.value;
      return { where: () => ({ returning: () => [{ key: 'ai.preparation_sheet' }] }) };
    },
  })),
};
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  aiSheetGate: vi.fn(),
  latestKnowledgeVersion: vi.fn(),
  setting: { key: 'key' },
  staffActor: (id: string) => `staff:${id}`,
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ settingsDb: () => ({}) }));

const superAdmin: StaffMember = {
  id: '00000000-0000-4000-8000-000000000201',
  email: 'super.admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
};
const context = (actor: StaffMember) => ({ db: {} as Db, actor });
const kb = { id: '00000000-0000-4000-8000-000000000c01', number: 3 };
const records = {
  blindTest: { date: '2026-10-20', reference: 'Blind test report v1' },
  legalCheck: { date: '2026-10-21', reference: 'Opinion 12/2026' },
};

// AI-09 done when: the AI sheet is switched on only after the blind test passes and the legal
// check clears (the database tests hold the row's own check, the audit and who may write it).
describe('switching the AI preparation sheet', () => {
  beforeEach(() => {
    for (const fn of Object.values(db))
      if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
    stored.value = undefined;
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.latestKnowledgeVersion.mockResolvedValue({ ...kb, status: 'approved' });
  });

  it('switches on with both records, for the live knowledge base version', async () => {
    const value = await switchAiSheet(context(superAdmin), { on: true, ...records });
    expect(value).toMatchObject({
      on: true,
      ...records,
      kbVersionId: kb.id,
      kbVersionNumber: kb.number,
    });
    expect(stored.value).toEqual(value);
  });

  it('switches off any time, with nothing recorded', async () => {
    await expect(switchAiSheet(context(superAdmin), { on: false })).resolves.toEqual({ on: false });
    expect(stored.value).toEqual({ on: false });
    expect(db.latestKnowledgeVersion).not.toHaveBeenCalled();
  });

  it('refuses on without both records, or before a knowledge base is imported', async () => {
    await expect(
      switchAiSheet(context(superAdmin), { on: true, blindTest: records.blindTest }),
    ).rejects.toThrow(z.ZodError);
    db.latestKnowledgeVersion.mockResolvedValueOnce(undefined);
    await expect(switchAiSheet(context(superAdmin), { on: true, ...records })).rejects.toThrow(
      AiSwitchError,
    );
    expect(stored.value).toBeUndefined();
  });

  it('is for the Super Admin only, and read only for Velyx support', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      await expect(
        switchAiSheet(
          context({ ...superAdmin, role, treatsPatients: role === 'physiotherapist' }),
          { on: false },
        ),
      ).rejects.toThrow(NotAllowedError);
    }
    await expect(
      switchAiSheet(context({ ...superAdmin, support: true }), { on: false }),
    ).rejects.toThrow(ReadOnlyError);
    expect(stored.value).toBeUndefined();
  });
});
