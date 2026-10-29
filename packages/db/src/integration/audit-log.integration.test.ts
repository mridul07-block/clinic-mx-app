import { auditCategory, auditPlacedTables } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { auditLog, logAuditDownload } from '../audit-log';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { insertPatient } from '../patients';
import { auditEvent, episode } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { fakePatientDetails } from './fake-patients';
import { becomeStaff } from './fake-schedule';

// ADM-01 done when: the Super Admin reads every change, Centre Managers the clinical changes at
// their centres, Finance the money changes. A clinical record's values only for clinicians; Velyx
// support reads none of it. Generated rows only. Rolled back. CI database only.
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
const manager = member('manager@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const finance = member('finance@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

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

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

/**
 * An episode at the manager's centre (HSR Layout) and one elsewhere (Whitefield), each with its
 * patient; a clinical record event for each (as the trigger would write it), a payment and a
 * setting change. Returns the ids the test looks for.
 */
async function setUp(tx: Tx) {
  const ids: Record<string, string> = {};
  for (const [key, centre] of [
    ['own', centreIds.hsrLayout],
    ['other', centreIds.whitefield],
  ] as const) {
    const patient = await insertPatient(tx, fakePatientDetails(centre));
    const [row] = await tx
      .insert(episode)
      .values({ patientId: patient.id, centreId: centre })
      .returning({ id: episode.id });
    if (!row) throw new Error('episode not added');
    ids[`${key}Patient`] = patient.id;
    ids[`${key}Episode`] = row.id;
  }
  const measureId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const settingId = crypto.randomUUID();
  const managerTask = crypto.randomUUID();
  const directorTask = crypto.randomUUID();
  const task = (id: string, role: string) => ({
    actor: 'system:tests',
    action: 'insert' as const,
    entity: 'task',
    entityId: id,
    after: { assignee_role: role, assignee_staff_user_id: null, centre_id: centreIds.hsrLayout },
  });
  await tx.insert(auditEvent).values([
    {
      actor: `staff:${superAdmin.id}`,
      action: 'update',
      entity: 'measure',
      entityId: measureId,
      before: { episode_id: ids.ownEpisode, value: 'Test 4' },
      after: { episode_id: ids.ownEpisode, value: 'Test 7' },
    },
    {
      actor: `staff:${superAdmin.id}`,
      action: 'insert',
      entity: 'payment',
      entityId: paymentId,
      after: { amount_paise: 50000 },
    },
    {
      actor: `staff:${superAdmin.id}`,
      action: 'update',
      entity: 'episode',
      entityId: ids.ownEpisode,
      before: { centre_id: centreIds.hsrLayout, discharge_reason: null, discharge_note: null },
      after: {
        centre_id: centreIds.hsrLayout,
        discharge_reason: 'goals_achieved',
        discharge_note: 'Test discharge words',
      },
    },
    // Opened, with no row: the centre comes from the patient opened.
    {
      actor: `staff:${superAdmin.id}`,
      action: 'view',
      entity: 'patient',
      entityId: ids.ownPatient,
    },
    task(managerTask, 'centre_manager'),
    task(directorTask, 'super_admin'),
    {
      actor: 'system:tests',
      action: 'update',
      entity: 'setting',
      entityId: settingId,
      before: { value: 1 },
      after: { value: 2 },
    },
  ]);
  return {
    ...ids,
    measureId,
    paymentId,
    settingId,
    managerTask,
    directorTask,
    ownPatient: ids.ownPatient ?? '',
    ownEpisode: ids.ownEpisode ?? '',
    otherEpisode: ids.otherEpisode ?? '',
  };
}

/** The newest events a person reads. */
async function latest(tx: Tx, who: StaffMember) {
  return read(tx, who, { limit: 50 });
}

async function read(tx: Tx, who: StaffMember, filters: Parameters<typeof auditLog>[1]) {
  await becomeStaff(tx, who);
  const rows = await auditLog(tx, filters);
  await asOwner(tx);
  return rows;
}

describe('the audit log', () => {
  it('gives each role its part: every event, clinical at own centres, or money', async () => {
    await rolledBack(async (tx) => {
      const t = await setUp(tx);
      const watched = [
        t.ownEpisode,
        t.otherEpisode,
        t.ownPatient,
        t.measureId,
        t.paymentId,
        t.settingId,
        t.managerTask,
        t.directorTask,
      ];
      const ours = (rows: Awaited<ReturnType<typeof auditLog>>) =>
        rows.filter((row) => watched.includes(row.entityId ?? ''));
      const records = (rows: Awaited<ReturnType<typeof auditLog>>) =>
        [...new Set(ours(rows).map((row) => row.entityId))].sort();
      const discharge = (rows: Awaited<ReturnType<typeof auditLog>>) =>
        rows.find((row) => row.entityId === t.ownEpisode && row.action === 'update');

      const all = await read(tx, superAdmin, { limit: 200 });
      expect(records(all)).toEqual([...watched].sort());
      expect(all.find((row) => row.entityId === t.measureId)).toMatchObject({
        actorName: superAdmin.name,
        category: 'clinical_record',
        changed: ['value'],
        redacted: false,
        after: { value: 'Test 7' },
      });
      expect(discharge(all)?.after).toMatchObject({ discharge_note: 'Test discharge words' });

      // The Centre Manager: clinical events at HSR Layout and Koramangala, never Whitefield's,
      // money or setup, and only the tasks their inbox shows. Without the Treats patients tick a
      // clinical record's values and the discharge words are hidden; the view is theirs too.
      const managed = await read(tx, manager, { limit: 200 });
      expect(records(managed)).toEqual(
        [t.ownEpisode, t.ownPatient, t.measureId, t.managerTask].sort(),
      );
      expect(managed.find((row) => row.entityId === t.measureId)).toMatchObject({
        redacted: true,
        before: null,
        after: null,
        changed: ['value'],
      });
      expect(discharge(managed)).toMatchObject({
        redacted: false,
        changed: ['discharge_note', 'discharge_reason'],
        after: { discharge_reason: 'goals_achieved' },
      });
      expect(discharge(managed)?.after).not.toHaveProperty('discharge_note');
      expect(discharge(managed)?.hiddenFields).toContain('discharge_note');
      const treating = await read(tx, { ...manager, treatsPatients: true }, { limit: 200 });
      expect(treating.find((row) => row.entityId === t.measureId)).toMatchObject({
        redacted: false,
        after: { value: 'Test 7' },
      });
      expect(discharge(treating)?.after).toMatchObject({ discharge_note: 'Test discharge words' });

      expect(records(await read(tx, finance, { limit: 200 }))).toEqual([t.paymentId]);
      expect(ours(await read(tx, deskHsr, { limit: 200 }))).toEqual([]);
      expect(ours(await read(tx, support, { limit: 200 }))).toEqual([]);
    });
  });

  it('keeps Velyx support off the table itself, but for its own requests', async () => {
    await rolledBack(async (tx) => {
      await setUp(tx);
      await becomeStaff(tx, support);
      const [seen] = await tx.execute<{ other: number }>(
        sql`select count(*) filter (where action <> 'support_request')::int as other from audit_event`,
      );
      expect(seen?.other).toBe(0);
      await asOwner(tx);
      await becomeStaff(tx, superAdmin);
      const [admin] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from audit_event`,
      );
      expect(admin?.n).toBeGreaterThan(0);
      await asOwner(tx);
    });
  });

  it('filters by part, table, time and page', async () => {
    await rolledBack(async (tx) => {
      const t = await setUp(tx);
      const money = await read(tx, superAdmin, { part: 'finance', limit: 50 });
      expect(money.every((row) => row.category === 'finance')).toBe(true);
      expect(money.map((row) => row.entityId)).toContain(t.paymentId);
      const clinical = await read(tx, superAdmin, { part: 'clinical', limit: 200 });
      expect(clinical.every((row) => row.category.startsWith('clinical'))).toBe(true);
      expect(clinical.map((row) => row.entityId)).toContain(t.measureId);
      const measures = await read(tx, superAdmin, { entity: 'measure', limit: 5 });
      expect(measures.every((row) => row.entity === 'measure')).toBe(true);
      // Pages run newest first, each before the last one's id.
      const [first, second] = await read(tx, superAdmin, { limit: 2 });
      const next = await read(tx, superAdmin, { before: second?.id ?? 0, limit: 1 });
      expect(first && second && (next[0]?.id ?? 0) < second.id && second.id < first.id).toBe(true);
      const future = new Date(Date.now() + 86_400_000);
      expect(await read(tx, superAdmin, { from: future, limit: 5 })).toEqual([]);
    });
  });

  it('places every audited table on purpose, in the same part as the app does', async () => {
    const tables = await db.execute<{ table: string; category: string }>(sql`
      select c.relname as table, internal.audit_category(c.relname) as category
      from pg_trigger g join pg_class c on c.oid = g.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and g.tgname = 'audit_change'`);
    expect(tables.length).toBeGreaterThan(40);
    for (const { table, category } of tables) expect(category, table).toBe(auditCategory(table));
    for (const { table } of tables) expect(auditPlacedTables, table).toContain(table);
  });

  it('records each download by its readers, in the Super Admin’s part', async () => {
    await rolledBack(async (tx) => {
      const filters = { from: '2026-10-01', to: '2026-10-29' };
      for (const reader of [superAdmin, manager, finance]) {
        await becomeStaff(tx, reader);
        await logAuditDownload(tx, filters, 3);
        await asOwner(tx);
      }
      for (const nobody of [deskHsr, support]) {
        await becomeStaff(tx, nobody);
        expect(
          await tx
            .transaction((sp) => logAuditDownload(sp, filters, 3))
            .then(() => 'ok')
            .catch((error: unknown) => (error as { cause?: { code?: string } }).cause?.code),
        ).toBe('42501');
        await asOwner(tx);
      }
      const downloads = await tx.execute<{ actor: string; category: string; after: unknown }>(sql`
        select actor, category, after from audit_event
        where action = 'export' and entity = 'audit_event' order by id desc limit 3`);
      expect(downloads.map((row) => row.actor).sort()).toEqual(
        [superAdmin, manager, finance].map((who) => `staff:${who.id}`).sort(),
      );
      expect(downloads.every((row) => row.category === 'admin')).toBe(true);
      expect(downloads[0]?.after).toEqual({ filters, events: 3 });
      // Only the Super Admin reads who downloaded what.
      const read = async (who: StaffMember) =>
        (await latest(tx, who)).filter((row) => row.entity === 'audit_event');
      expect((await read(superAdmin)).length).toBeGreaterThanOrEqual(3);
      expect(await read(manager)).toEqual([]);
      expect(await read(finance)).toEqual([]);
    });
  });
});
