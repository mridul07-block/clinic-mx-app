import { addDays, istDate } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  packageCounts,
  paymentsDaily,
  paymentsUndone,
  revenueMonthly,
  unpaidBills,
} from '../finance';
import type { StaffMember } from '../identity';
import { bill, payment } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, claimsOf, episodeThrough, paidBill, visit } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// DSH-04: Finance's money figures, read under row level security: the Super Admin and Finance
// read every centre's; a Centre Manager none; the Front Desk only its own centre's. Each test
// reads before and after adding generated records, all rolled back. CI database only.
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
const superAdmin = member('super.admin@clinicmx.test');
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');

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

async function as<R>(tx: Tx, staff: StaffMember, read: (tx: Tx) => Promise<R>): Promise<R> {
  await becomeStaff(tx, staff);
  const result = await read(tx);
  await asSystem(tx);
  return result;
}

const today = istDate(new Date());
const month = today.slice(0, 7);
const hsr = centreIds.hsrLayout;
const whitefield = centreIds.whitefield;

describe('collections and revenue', () => {
  it('counts payments not undone by day, method and month, and undone ones apart', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [hsr, whitefield],
        createdBy: superAdmin.id,
      });
      const sum = (rows: Awaited<ReturnType<typeof paymentsDaily>>, centreId: string) =>
        rows
          .filter((row) => row.centreId === centreId && row.day === today && row.method === 'upi')
          .reduce((total, row) => total + row.paise, 0);
      const before = await as(tx, finance, (t) => paymentsDaily(t, today, today));
      const revenueBefore = await as(tx, finance, (t) => revenueMonthly(t, `${month}-01`, today));
      const undoneBefore = await as(tx, finance, (t) => paymentsUndone(t, today));

      await paidBill(tx, hsr, physio, 150_000);
      await paidBill(tx, whitefield, physio, 60_000);
      const undone = await paidBill(tx, hsr, physio, 90_000);
      await tx
        .update(payment)
        .set({ undoneAt: new Date(), undoneBy: deskHsr.id, undoReason: 'Recorded twice' })
        .where(eq(payment.id, undone));

      const after = await as(tx, finance, (t) => paymentsDaily(t, today, today));
      expect(sum(after, hsr) - sum(before, hsr)).toBe(150_000);
      expect(sum(after, whitefield) - sum(before, whitefield)).toBe(60_000);
      const revenue = await as(tx, finance, (t) => revenueMonthly(t, `${month}-01`, today));
      const consultations = (rows: typeof revenue) =>
        rows
          .filter(
            (row) => row.centreId === hsr && row.month === month && row.kind === 'consultation',
          )
          .reduce((total, row) => total + row.paise, 0);
      expect(consultations(revenue) - consultations(revenueBefore)).toBe(150_000);
      const undoneAfter = await as(tx, finance, (t) => paymentsUndone(t, today));
      const taken = (rows: typeof undoneAfter) =>
        rows.find((row) => row.centreId === hsr)?.paise ?? 0;
      expect(taken(undoneAfter) - taken(undoneBefore)).toBe(90_000);

      // The desk at HSR Layout reads its own centre's money only; a Centre Manager reads none.
      const desk = await as(tx, deskHsr, (t) => paymentsDaily(t, today, today));
      expect(desk.every((row) => row.centreId === hsr)).toBe(true);
      expect(await as(tx, manager, (t) => paymentsDaily(t, addDays(today, -30), today))).toEqual(
        [],
      );
    });
  });
});

describe('unpaid bills and packages', () => {
  it('lists unpaid bills largest first with numbers, never the patient’s name', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const owing = await visit(tx, {
        centreId: hsr,
        physio,
        type: 'consultation',
        day: today,
        status: 'booked',
      });
      await tx.delete(bill).where(eq(bill.appointmentId, owing.id));
      const [made] = await tx
        .insert(bill)
        .values({
          number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
          kind: 'consultation',
          status: 'unpaid',
          patientId: owing.patientId,
          centreId: hsr,
          appointmentId: owing.id,
          totalPaise: 9_999_900,
        })
        .returning({ id: bill.id, number: bill.number });
      const rows = await as(tx, finance, unpaidBills);
      expect(rows[0]).toMatchObject({
        id: made?.id,
        number: made?.number,
        centreName: 'HSR Layout',
      });
      expect(rows[0]?.opNumber).toMatch(/^HSR-/);
      expect(Object.keys(rows[0] ?? {})).not.toContain('name');
      expect(await as(tx, manager, unpaidBills)).toEqual([]);
    });
  });

  it('counts live packages per centre: active, expiring and expired with sessions left', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const before = await as(tx, finance, (t) => packageCounts(t, today, 14));
      const of = (rows: typeof before) =>
        rows.find((row) => row.centreId === hsr) ?? {
          active: 0,
          expiring: 0,
          expired: 0,
          sessionsLeftActive: 0,
          sessionsLeftExpired: 0,
        };
      // Two opening packages (SCH-13): one expiring in 10 days, one in 60.
      for (const [days, sessions] of [
        [10, 6],
        [60, 4],
      ] as const) {
        const opened = await episodeThrough(tx, hsr, [
          'awaiting_consultation',
          'plan_proposed',
          'active',
        ]);
        await claimsOf(tx, superAdmin);
        await tx.execute(sql`insert into opening_entry (patient_id, episode_id, centre_id, physio_id,
          sessions_left, valid_until)
          values (${opened.patientId}, ${opened.id}, ${hsr}, ${physio.id}, ${sessions}, ${addDays(today, days)})`);
        await asSystem(tx);
      }
      const after = await as(tx, finance, (t) => packageCounts(t, today, 14));
      expect(of(after).active - of(before).active).toBe(2);
      expect(of(after).expiring - of(before).expiring).toBe(1);
      expect(of(after).sessionsLeftActive - of(before).sessionsLeftActive).toBe(10);
      // Thirty days on, the first has expired with its sessions left.
      const later = await as(tx, finance, (t) => packageCounts(t, addDays(today, 30), 14));
      expect(of(later).expired).toBeGreaterThanOrEqual(1);
      expect(of(later).sessionsLeftExpired).toBeGreaterThanOrEqual(6);
    });
  });
});
