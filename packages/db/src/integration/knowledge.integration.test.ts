import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsForStaff } from '../access';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  knowledgeAssessment,
  knowledgeConditions,
  knowledgeListings,
  knowledgeObjective,
  knowledgePlan,
  latestKnowledgeVersion,
  redFlagPresentations,
  redFlagRules,
} from '../knowledge';
import { AlreadyImportedError, applyKnowledge, KB_IMPORT_ACTOR } from '../knowledge/apply';
import { buildKnowledge, type BuiltKnowledge } from '../knowledge/build';
import { buildCategories, type BuiltCategories } from '../knowledge/categories';
import { buildPlanCatalog, type BuiltPlanCatalog } from '../knowledge/plan-catalog';
import {
  readCategoriesFile,
  readConditionIds,
  readPlanCatalogFile,
  readRulesFile,
  WORKBOOK_FOLDER_PATH,
} from '../knowledge/paths';
import { buildObjective, type BuiltObjective } from '../knowledge/objective';
import { buildRedFlags, type RedFlags } from '../knowledge/red-flags';
import { buildReport, type ImportReport } from '../knowledge/report';
import { readWorkbooks } from '../knowledge/workbook';
import {
  auditEvent,
  kbCondition,
  kbDiagnosisCategory,
  kbMeasure,
  kbModality,
  kbVersion,
} from '../schema';
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
let redFlags: RedFlags;
let objective: BuiltObjective;
let categories: BuiltCategories;
let planCatalog: BuiltPlanCatalog;

beforeAll(async () => {
  const workbooks = await readWorkbooks(WORKBOOK_FOLDER_PATH);
  built = buildKnowledge(workbooks, await readConditionIds());
  redFlags = buildRedFlags(workbooks, await readRulesFile());
  objective = buildObjective(workbooks);
  categories = buildCategories(await readCategoriesFile(), built);
  planCatalog = buildPlanCatalog(await readPlanCatalogFile());
  report = buildReport(workbooks, built, redFlags, objective, categories, planCatalog);
  // A source no real import has, so a version this database already holds never refuses it.
  report = { ...report, files: report.files.map((f) => ({ ...f, sha256: `${f.sha256}0` })) };
  redFlags = {
    ...redFlags,
    rulesFile: { ...redFlags.rulesFile, sha256: `${redFlags.rulesFile.sha256}0` },
  };
}, 60_000);

describe('the knowledge base import', () => {
  it('records the next version as a draft, audited as the import', async () => {
    await rolledBack(async (tx) => {
      const before = (await latestKnowledgeVersion(tx))?.number ?? 0;
      const version = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
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
        { entity: 'kb_diagnosis_category', n: 44 },
        { entity: 'kb_measure', n: 143 },
        { entity: 'kb_modality', n: 8 },
        { entity: 'kb_phase', n: 40 },
        { entity: 'kb_phase_criterion', n: 122 },
        { entity: 'kb_questionnaire', n: 19 },
        { entity: 'kb_readiness_criterion', n: 139 },
        { entity: 'kb_red_flag_presentation', n: 136 },
        { entity: 'kb_red_flag_rule', n: 20 },
        { entity: 'kb_special_test', n: 244 },
        { entity: 'kb_version', n: 1 },
      ]);
    });
  });

  it('stores the red flag rules as written, and a changed rules file makes a new version', async () => {
    await rolledBack(async (tx) => {
      const { id, number } = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
      const cauda = (await redFlagRules(tx, id)).find((r) => r.ruleKey === 'back.cauda_equina');
      expect(cauda).toMatchObject({
        regions: ['back'],
        triage: 'immediate_emergency',
        signedOff: false,
        trigger: redFlags.rules.find((r) => r.key === 'back.cauda_equina')?.trigger,
      });
      const lumbar = (await redFlagPresentations(tx, id)).filter((p) => p.region === 'lumbar_sij');
      expect(lumbar[0]).toMatchObject({
        kind: 'presentation',
        presentation: 'CAUDA EQUINA SYNDROME',
      });
      expect(lumbar.filter((p) => p.kind === 'screening_note')).toHaveLength(6);
      const edited = { ...redFlags, rulesFile: { ...redFlags.rulesFile, sha256: 'edited' } };
      expect(
        (await applyKnowledge(tx, built, report, edited, objective, categories, planCatalog))
          .number,
      ).toBe(number + 1);
    });
  });

  it('refuses the same workbooks twice', async () => {
    await rolledBack(async (tx) => {
      const { number } = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
      await expect(
        applyKnowledge(tx, built, report, redFlags, objective, categories, planCatalog),
      ).rejects.toEqual(new AlreadyImportedError(number));
    });
  });

  it('is read by the Super Admin, Centre Managers and physiotherapists only', async () => {
    await rolledBack(async (tx) => {
      const { id } = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
      for (const reader of [superAdmin, manager, physio, support]) {
        await becomes(tx, reader);
        expect((await knowledgeConditions(tx, id)).length, reader.email).toBe(345);
        expect((await knowledgeListings(tx, id)).length, reader.email).toBe(354);
        expect((await redFlagRules(tx, id)).length, reader.email).toBe(20);
        expect((await redFlagPresentations(tx, id)).length, reader.email).toBe(136);
        // CLN-05: the Objective's measures and special tests.
        const read = await knowledgeObjective(tx, id);
        expect(read.measures.length, reader.email).toBe(143);
        expect(read.specialTests.length, reader.email).toBe(244);
        // CLN-06: the Assessment's conditions, with each workbook's row, and the categories.
        const assessment = await knowledgeAssessment(tx, id);
        expect(assessment.conditions.length, reader.email).toBe(345);
        expect(assessment.categories.length, reader.email).toBe(44);
        expect(
          assessment.conditions
            .find((c) => c.conditionId === 'SHO-026')
            ?.listings.map((l) => l.region),
          reader.email,
        ).toEqual(['shoulder', 'cervical']);
        // CLN-07: each workbook's "Physiotherapy specific exercise" (Knee has no such column).
        const exercises = assessment.conditions.flatMap((c) =>
          c.listings.filter((l) => l.specificExercise).map((l) => l.region),
        );
        expect(exercises, reader.email).toContain('shoulder');
        expect(exercises, reader.email).not.toContain('knee');
        // CLN-07: the plan catalog.
        const plan = await knowledgePlan(tx, id);
        expect(plan.modalities.length, reader.email).toBe(8);
        expect(plan.questionnaires.length, reader.email).toBe(19);
        expect(
          plan.modalities
            .find((m) => m.key === 'radial_shockwave')
            ?.precautions.map((p) => p.precaution),
          reader.email,
        ).toEqual(['bleeding', 'pregnancy', 'cancer', 'chronic_infection']);
        expect((await latestKnowledgeVersion(tx))?.id, reader.email).toBe(id);
      }
      for (const outsider of [desk, finance]) {
        await becomes(tx, outsider);
        expect(await knowledgeConditions(tx, id), outsider.email).toEqual([]);
        expect(await redFlagRules(tx, id), outsider.email).toEqual([]);
        expect(await redFlagPresentations(tx, id), outsider.email).toEqual([]);
        expect(await knowledgeObjective(tx, id), outsider.email).toEqual({
          measures: [],
          specialTests: [],
        });
        expect(await knowledgeAssessment(tx, id), outsider.email).toEqual({
          conditions: [],
          categories: [],
        });
        expect(await knowledgePlan(tx, id), outsider.email).toEqual({
          modalities: [],
          questionnaires: [],
        });
        expect(await latestKnowledgeVersion(tx), outsider.email).toBeUndefined();
      }
    });
  });

  it('is written by nobody signed in, the Super Admin and support included', async () => {
    await rolledBack(async (tx) => {
      const { id } = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
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
        const measure = await tx
          .update(kbMeasure)
          .set({ unit: 'lb' })
          .where(eq(kbMeasure.kbVersionId, id))
          .returning({ id: kbMeasure.id });
        expect(measure, writer.email).toEqual([]);
        const category = await tx
          .update(kbDiagnosisCategory)
          .set({ name: 'Changed' })
          .where(eq(kbDiagnosisCategory.kbVersionId, id))
          .returning({ id: kbDiagnosisCategory.id });
        expect(category, writer.email).toEqual([]);
        const modality = await tx
          .update(kbModality)
          .set({ signedOff: true })
          .where(eq(kbModality.kbVersionId, id))
          .returning({ id: kbModality.id });
        expect(modality, writer.email).toEqual([]);
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
