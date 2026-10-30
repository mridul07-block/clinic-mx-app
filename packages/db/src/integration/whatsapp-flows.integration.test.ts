import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { priceItem, staffUser, whatsappFlowSession } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';
import {
  consultationFees,
  createFlowSession,
  flowSessionRecord,
  saveFlowState,
} from '../whatsapp-flows';
import { becomeStaff } from './fake-schedule';

// WA-04: the booking Flow's sessions are the server's alone and go after the retention days; a
// physio's consultation fee is read for the form. In transactions rolled back. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const everyone = [
  member('super.admin@clinicmx.test'),
  member('manager@clinicmx.test'),
  member('desk.hsr@clinicmx.test'),
  member('physio.hsr@clinicmx.test'),
  member('support.velyx@clinicmx.test'),
];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

describe('booking Flow sessions', () => {
  it('keep what was picked, and are the server’s alone', async () => {
    await rolledBack(async (tx) => {
      const id = await createFlowSession(tx, {
        phone: '+919900000001',
        kind: 'booking',
        expiresAt: tomorrow(),
      });
      await saveFlowState(tx, id, { centreId: 'c', date: '2026-11-02' });
      expect((await flowSessionRecord(tx, id))?.state).toEqual({
        centreId: 'c',
        date: '2026-11-02',
      });
      for (const staff of everyone) {
        await becomeStaff(tx, staff);
        expect(
          await failure(tx, (sp) =>
            sp.select().from(whatsappFlowSession).where(eq(whatsappFlowSession.id, id)),
          ),
          staff.email,
        ).toBe('42501');
        await tx.execute(sql`reset role`);
      }
    });
  });

  it('need a number with its country code and a later expiry', async () => {
    await rolledBack(async (tx) => {
      const insert = (values: { phone: string; expiresAt: Date }) => (sp: Tx) =>
        createFlowSession(sp, { ...values, kind: 'booking' });
      expect(await failure(tx, insert({ phone: '9900000001', expiresAt: tomorrow() }))).toBe(
        '23514',
      );
      expect(await failure(tx, insert({ phone: '+919900000001', expiresAt: new Date(0) }))).toBe(
        '23514',
      );
    });
  });

  it('go once older than the retention days', async () => {
    await rolledBack(async (tx) => {
      const old = await createFlowSession(tx, {
        phone: '+919900000002',
        kind: 'booking',
        expiresAt: tomorrow(),
      });
      const fresh = await createFlowSession(tx, {
        phone: '+919900000003',
        kind: 'booking',
        expiresAt: tomorrow(),
      });
      const longAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
      await tx
        .update(whatsappFlowSession)
        .set({ createdAt: longAgo, expiresAt: new Date(longAgo.getTime() + 1000) })
        .where(eq(whatsappFlowSession.id, old));
      await tx.execute(sql`select internal.prune_whatsapp_flow_sessions()`);
      expect(await flowSessionRecord(tx, old)).toBeUndefined();
      expect(await flowSessionRecord(tx, fresh)).toBeDefined();
    });
  });
});

describe('consultation fees', () => {
  it('are each physio’s price item, and none where unset', async () => {
    await rolledBack(async (tx) => {
      const [fee] = await tx.select().from(priceItem).where(eq(priceItem.key, 'consultation'));
      if (!fee) throw new Error('no consultation price item');
      const physio = member('physio.hsr@clinicmx.test');
      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: fee.id })
        .where(eq(staffUser.id, physio.id));
      const other = member('manager@clinicmx.test');
      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: null })
        .where(eq(staffUser.id, other.id));
      const fees = await consultationFees(tx, [physio.id, other.id]);
      expect(fees.get(physio.id)).toEqual({ label: fee.label, amountPaise: fee.amountPaise });
      expect(fees.has(other.id)).toBe(false);
      expect((await consultationFees(tx, [])).size).toBe(0);
    });
  });
});
