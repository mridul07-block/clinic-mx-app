import { addDays, istDate, todayGroup } from '@clinic-mx/schemas';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { demoCentres } from '../demo/context';
import { fillDemo } from '../demo/fill';
import { DEMO_EMAIL_DOMAIN } from '../demo/names';
import { removeDemo } from '../demo/remove';
import { myPatientsToday } from '../my-patients';
import { revenueMonthly } from '../finance';
import { appointment, bill, consultation, episode, job, patient, staffUser } from '../schema';
import { todayBoard } from '../today';

// The demo data (docs/runbooks/demo-data.md): one fill gives every screen something, from the
// screens' own queries; a second fill the same day adds nothing; nothing is queued for WhatsApp;
// the remove takes every demo row away. Eight patients a centre cover every stage. The set up rows
// this test made (hours, fees, packages, discounts, tablets, leave) are taken away after, so later
// tests see the database as they expect. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });

const centres = demoCentres();
const demo = like(patient.email, `%@${DEMO_EMAIL_DOMAIN}`);
/** Set up tables the fill adds to; what it added is taken away after. */
const setupTables = ['roster', 'staff_leave', 'kiosk_device', 'discount_preset', 'package_type'];
const before = new Map<string, string[]>();
const feesBefore = new Map<string, string | null>();

beforeAll(async () => {
  await withActor(db, systemActor('tests'), (tx) => removeDemo(tx));
  for (const table of setupTables) {
    const rows = await db.execute<{ id: string }>(
      sql`select id::text as id from ${sql.identifier(table)}`,
    );
    before.set(
      table,
      rows.map((row) => row.id),
    );
  }
  for (const centre of centres) {
    const [row] = await db
      .select({ fee: staffUser.consultationPriceItemId })
      .from(staffUser)
      .where(eq(staffUser.id, centre.consultant.id));
    feesBefore.set(centre.consultant.id, row?.fee ?? null);
  }
}, 60_000);

afterAll(async () => {
  await withActor(db, systemActor('tests'), async (tx) => {
    await removeDemo(tx);
    // A Postgres array literal: the ids there before.
    const kept = (table: string) => sql`${`{${(before.get(table) ?? []).join(',')}}`}::uuid[]`;
    await tx.execute(
      sql`delete from package_type_item where package_type_id <> all(${kept('package_type')})`,
    );
    for (const table of setupTables) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where id <> all(${kept(table)})`);
    }
    for (const [staffId, fee] of feesBefore) {
      await tx
        .update(staffUser)
        .set({ consultationPriceItemId: fee })
        .where(eq(staffUser.id, staffId));
    }
  });
  await close();
}, 120_000);

describe('demo data', () => {
  const now = new Date();
  const today = istDate(now);

  it('fills every screen, quietly, once a day, and is removed whole', async () => {
    const first = await fillDemo(db, { patientsPerCentre: 8, now });
    expect(first.patients.made).toBe(24);
    expect(Object.keys(first.patients.byStage).sort()).toEqual(
      [
        'active',
        'awaiting_consultation',
        'discharged',
        'old_discharged',
        'on_hold',
        'plan_proposed',
        'think_about_it',
        'under_review',
      ].sort(),
    );

    for (const centre of centres) {
      // Today: something in every column, unless the clock is too near midnight for it.
      const board = await todayBoard(db, { centreId: centre.id, date: today });
      const groups = new Set(board.map((visit) => todayGroup(visit.status)));
      const made = first.today[centre.code]?.made ?? [];
      if (made.includes('done')) expect(groups.has('done')).toBe(true);
      if (made.includes('with_physio')) expect(groups.has('with_physio')).toBe(true);
      if (made.includes('here_now')) expect(groups.has('here')).toBe(true);
      if (made.includes('confirmed')) expect(groups.has('to_arrive')).toBe(true);
      // My patients: the consultant's visits today.
      if (made.length > 0) {
        const mine = await myPatientsToday(db, { staffId: centre.consultant.id, date: today });
        expect(mine.length).toBeGreaterThan(0);
      }
    }

    // History: signed consultations weeks back, and money over several months.
    const [old] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(consultation)
      .innerJoin(episode, eq(episode.id, consultation.episodeId))
      .innerJoin(patient, eq(patient.id, episode.patientId))
      .where(
        and(
          demo,
          eq(consultation.status, 'signed'),
          sql`${consultation.signedAt} < now() - interval '30 days'`,
        ),
      );
    expect(old?.n).toBeGreaterThan(0);
    const revenue = await revenueMonthly(db, addDays(today, -200), today);
    expect(new Set(revenue.map((row) => row.month)).size).toBeGreaterThanOrEqual(3);

    // Nothing waits to be sent to a made up number.
    const demoIds = db
      .select({ id: sql<string>`${appointment.id}::text` })
      .from(appointment)
      .innerJoin(patient, eq(patient.id, appointment.patientId))
      .where(demo);
    const [queued] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(job)
      .where(
        sql`${job.kind} like 'whatsapp.%' and ${job.status} = 'queued' and exists (
          select 1 from jsonb_each_text(${job.payload}) v where v.value in (${demoIds}))`,
      );
    expect(queued?.n).toBe(0);

    // The same day again: nothing new.
    const again = await fillDemo(db, { patientsPerCentre: 8, now });
    expect(again.patients.made).toBe(0);
    expect(Object.values(again.today).every((day) => day.already)).toBe(true);

    // Removed whole: the patients and everything that pointed at them.
    const patientIds = (await db.select({ id: patient.id }).from(patient).where(demo)).map(
      (row) => row.id,
    );
    expect(patientIds.length).toBeGreaterThan(24);
    const removed = await withActor(db, systemActor('tests'), (tx) => removeDemo(tx));
    expect(removed.patients).toBe(patientIds.length);
    for (const table of [appointment, bill, episode] as const) {
      const [left] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(inArray(table.patientId, patientIds));
      expect(left?.n).toBe(0);
    }
    const [patientsLeft] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(patient)
      .where(demo);
    expect(patientsLeft?.n).toBe(0);
  }, 300_000);
});
