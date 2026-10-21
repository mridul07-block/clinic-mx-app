import type { Db, StaffMember } from '@clinic-mx/db';
import type { StaffRole } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from './guard';
import { staffService, type ServiceTransaction } from './service';

const fakeTx = { kind: 'transaction' } as unknown as ServiceTransaction;
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const whitefield = '00000000-0000-4000-8000-000000000103';

const member = (role: StaffRole, extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000201',
  email: `${role}@clinicmx.test`,
  name: 'Test person',
  role,
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});

const fakeDb = {} as Db;
const run = vi.fn((_tx: ServiceTransaction, input: { centreId: string }) =>
  Promise.resolve(`booked in ${input.centreId}`),
);
const book = staffService({
  action: 'bookings.manage',
  input: z.object({ centreId: z.guid() }),
  target: (input) => Promise.resolve({ centreId: input.centreId }),
  run,
});

// IAM-04, rule 17: every service checks permission, validates, then writes in one audited
// transaction.
describe('staffService', () => {
  beforeEach(() => {
    run.mockClear();
    db.withStaffAccess
      .mockReset()
      .mockImplementation((_db: Db, _context: unknown, work: (tx: ServiceTransaction) => unknown) =>
        work(fakeTx),
      );
  });

  it('runs the work in one transaction as the actor, under row level security', async () => {
    const desk = member('front_desk');
    expect(await book({ db: fakeDb, actor: desk, ip: '203.0.113.5' }, { centreId: hsr })).toBe(
      `booked in ${hsr}`,
    );
    expect(db.withStaffAccess).toHaveBeenCalledWith(
      fakeDb,
      { actor: desk, ip: '203.0.113.5' },
      expect.any(Function),
    );
    expect(run).toHaveBeenCalledWith(fakeTx, { centreId: hsr }, desk);
  });

  it('refuses a role the map does not allow before reading the input or opening a transaction', async () => {
    const parse = vi.fn();
    const guarded = staffService({
      action: 'bookings.manage',
      input: z.unknown().transform(parse),
      run,
    });
    for (const role of ['physiotherapist', 'finance'] as const) {
      await expect(guarded({ db: fakeDb, actor: member(role) }, {})).rejects.toThrow(
        NotAllowedError,
      );
    }
    expect(parse).not.toHaveBeenCalled();
    expect(db.withStaffAccess).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a Velyx support login, read only, even for an action its role has (IAM-08)', async () => {
    const support = member('super_admin', { support: true, centreIds: [] });
    await expect(book({ db: fakeDb, actor: support }, { centreId: hsr })).rejects.toThrow(
      ReadOnlyError,
    );
    await expect(book({ db: fakeDb, actor: support }, { centreId: hsr })).rejects.toThrow(
      'Velyx support access is read only.',
    );
    expect(db.withStaffAccess).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    // The same role without the support mark may.
    expect(await book({ db: fakeDb, actor: member('super_admin') }, { centreId: hsr })).toBe(
      `booked in ${hsr}`,
    );
  });

  it('refuses input that fails its schema before any write', async () => {
    await expect(
      book({ db: fakeDb, actor: member('front_desk') }, { centreId: 'not an id' }),
    ).rejects.toThrow(z.ZodError);
    expect(db.withStaffAccess).not.toHaveBeenCalled();
  });

  it('refuses a record in a centre the person is not assigned', async () => {
    await expect(
      book({ db: fakeDb, actor: member('front_desk') }, { centreId: whitefield }),
    ).rejects.toThrow(NotAllowedError);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a grant for one’s own records when the service names no owner', async () => {
    const physio = member('physiotherapist', { treatsPatients: true });
    const ownLeave = staffService({
      action: 'leave.manage',
      input: z.object({ staffUserId: z.guid() }),
      target: (input) => Promise.resolve({ ownerId: input.staffUserId }),
      run: () => Promise.resolve('saved'),
    });
    expect(await ownLeave({ db: fakeDb, actor: physio }, { staffUserId: physio.id })).toBe('saved');
    await expect(
      ownLeave({ db: fakeDb, actor: physio }, { staffUserId: whitefield }),
    ).rejects.toThrow(NotAllowedError);

    const noOwner = staffService({
      action: 'leave.manage',
      input: z.object({}),
      run: () => Promise.resolve('saved'),
    });
    await expect(noOwner({ db: fakeDb, actor: physio }, {})).rejects.toThrow(NotAllowedError);
    expect(await noOwner({ db: fakeDb, actor: member('centre_manager') }, {})).toBe('saved');
  });
});
