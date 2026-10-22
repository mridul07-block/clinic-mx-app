import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsForStaff } from '../access';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { knowledgeConditions, knowledgeListings, latestKnowledgeVersion } from '../knowledge';
import { AlreadyImportedError, applyKnowledge, KB_IMPORT_ACTOR } from '../knowledge/apply';
import { buildKnowledge, type BuiltKnowledge } from '../knowledge/build';
import { readConditionIds, WORKBOOK_FOLDER_PATH } from '../knowledge/paths';
import { buildReport, type ImportReport } from '../knowledge/report';
import { readWorkbooks } from '../knowledge/workbook';
import { auditEvent, kbCondition, kbVersion } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';

// SET-05 done when: the workbooks are imported as a knowledge base version with stable condition
// IDs, read by the people who use it clinically and written by nobody signed in. The import runs
// as the owner in a transaction that is rolled back, so the database keeps no version. CI only.
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
const desk = member('desk.hsr@clinicmx.test');
const finance = member('finance@clinicmx.test');
const physio = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/** Runs `work` as the database owner in a transaction that is always rolled back. */
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Becomes a signed in staff member inside the transaction (their claims and role). */
async function becomes(tx: Tx, actor: StaffMember) {
  await tx.execute(sql`reset role`);
  const claims = JSON.stringify({ role: 'authenticated', clinic: claimsForStaff(actor) });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`select set_config('audit.actor', ${`staff:${actor.id}`}, true)`);
  await tx.execute(sql`set local role authenticated`);
}

/** The Postgres error code a statement failed with, inside a savepoint. */
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

let built: BuiltKnowledge;
let report: ImportReport;

beforeAll(async () => {
  const workbooks = await readWorkbooks(WORKBOOK_FOLDER_PATH);
  built = buildKnowledge(workbooks, await readConditionIds());
  report = buildReport(workbooks, built);
  // A source no real import has, so a version this database already holds never refuses it.
  report = { ...report, files: report.files.map((f) => ({ ...f, sha256: `${f.sha256}0` })) };
}, 60_000);

describe('the knowledge base import', () => {
  it('records the next version as a draft, audited as the import', async () => {
    await rolledBack(async (tx) => {
      const before = (await latestKnowledgeVersion(tx))?.number ?? 0;
      const version = await applyKnowledge(tx, built, report);
      expect(version.number).toBe(before + 1);
      expect(await latestKnowledgeVersion(tx)).toMatchObject({
        id: version.id,
        number: before + 1,
        status: 'draft',
        approvedAt: null,
      });
      expect(await knowledgeConditions(tx, version.id)).toHaveLength(345);
      const listings = await knowledgeListings(tx, version.id);
      expect(listings).toHaveLength(354);
      expect(listings.filter((l) => l.conditionId === 'SHO-026').map((l) => l.region)).toEqual([
        'shoulder',
        'cervical',
      ]);
      const [row] = await tx
        .select({ createdBy: kbVersion.createdBy, report: kbVersion.report })
        .from(kbVersion)
        .where(eq(kbVersion.id, version.id));
      expect(row?.createdBy).toBe(KB_IMPORT_ACTOR);
      expect(row?.report).toMatchObject({ totals: { listings: 354, conditions: 345, merged: 9 } });

      const audited = await tx
        .select({ entity: auditEvent.entity, n: sql<number>`count(*)::int` })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.actor, KB_IMPORT_ACTOR),
            sql`${auditEvent.at} = now()`,
            sql`${auditEvent.entity} like 'kb_%'`,
          ),
        )
        .groupBy(auditEvent.entity)
        .orderBy(auditEvent.entity);
      expect(audited).toEqual([
        { entity: 'kb_condition', n: 345 },
        { entity: 'kb_condition_listing', n: 354 },
        { entity: 'kb_version', n: 1 },
      ]);
    });
  });

  it('refuses the same workbooks twice', async () => {
    await rolledBack(async (tx) => {
      const { number } = await applyKnowledge(tx, built, report);
      await expect(applyKnowledge(tx, built, report)).rejects.toEqual(
        new AlreadyImportedError(number),
      );
    });
  });

  it('is read by the Super Admin, Centre Managers and physiotherapists only', async () => {
    await rolledBack(async (tx) => {
      const { id } = await applyKnowledge(tx, built, report);
      for (const reader of [superAdmin, manager, physio, support]) {
        await becomes(tx, reader);
        expect((await knowledgeConditions(tx, id)).length, reader.email).toBe(345);
        expect((await knowledgeListings(tx, id)).length, reader.email).toBe(354);
        expect((await latestKnowledgeVersion(tx))?.id, reader.email).toBe(id);
      }
      for (const outsider of [desk, finance]) {
        await becomes(tx, outsider);
        expect(await knowledgeConditions(tx, id), outsider.email).toEqual([]);
        expect(await latestKnowledgeVersion(tx), outsider.email).toBeUndefined();
      }
    });
  });

  it('is written by nobody signed in, the Super Admin and support included', async () => {
    await rolledBack(async (tx) => {
      const { id } = await applyKnowledge(tx, built, report);
      for (const writer of [superAdmin, support, physio]) {
        await becomes(tx, writer);
        expect(
          await failure(tx, (sp) =>
            sp.insert(kbCondition).values({
              kbVersionId: id,
              conditionId: 'SHO-999',
              name: 'Made up',
              homeRegion: 'shoulder',
            }),
          ),
          writer.email,
        ).toBe('42501');
        const changed = await tx
          .update(kbCondition)
          .set({ name: 'Changed' })
          .where(eq(kbCondition.kbVersionId, id))
          .returning({ id: kbCondition.id });
        expect(changed, writer.email).toEqual([]);
        // Approval arrives with SET-06; until then nobody signed in can approve a version.
        const approved = await tx
          .update(kbVersion)
          .set({ status: 'approved', approvedBy: writer.id, approvedAt: new Date() })
          .where(eq(kbVersion.id, id))
          .returning({ id: kbVersion.id });
        expect(approved, writer.email).toEqual([]);
      }
    });
  });
});
