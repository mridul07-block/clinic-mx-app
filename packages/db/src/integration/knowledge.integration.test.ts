import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsForStaff } from '../access';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  KnowledgeVersionNotApprovableError,
  approveKnowledgeVersion,
  knowledgeAssessment,
  knowledgeConditions,
  knowledgeListings,
  knowledgeObjective,
  knowledgePlan,
  knowledgeVersionSignOff,
  knowledgeVersionUsage,
  latestKnowledgeVersion,
  questionnaireLibrary,
  redFlagPresentations,
  redFlagRules,
} from '../knowledge';
import { latestPhaseVersion } from '../phases';
import { latestCriteriaVersion } from '../readiness';
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
  kbQuestionnaire,
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

// SET-08: the questionnaire library. Each instrument is imported with its definition, licence and
// sign-off; none is signed off without items and a confirmed licence. A generated test instrument
// only (no invented clinical content).
describe('the questionnaire library', () => {
  const definition = {
    version: 'test-1',
    items: ['a', 'b'].map((key) => ({
      kind: 'scale' as const,
      key,
      text: `Test item ${key}`,
      min: 0,
      max: 10,
      minLabel: 'Low',
      maxLabel: 'High',
    })),
    scoring: { method: 'mean' as const, maxMissing: 0, invert: false },
    range: { min: 0, max: 10 },
    better: 'higher' as const,
    meaningfulChange: 2,
    source: 'Generated test instrument',
  };

  it('imports each instrument awaiting its items, licence and sign-off, unless the file gives them', async () => {
    await rolledBack(async (tx) => {
      const [first, ...rest] = planCatalog.questionnaires;
      if (!first) throw new Error('no questionnaires');
      const version = await applyKnowledge(tx, built, report, redFlags, objective, categories, {
        ...planCatalog,
        questionnaires: [{ ...first, definition, licence: 'free', signedOff: true }, ...rest],
      });
      const library = await questionnaireLibrary(tx, version.id);
      expect(library).toHaveLength(19);
      expect(library[0]).toEqual({
        key: first.key,
        name: first.name,
        definition,
        licence: 'free',
        signedOff: true,
      });
      expect(
        library.slice(1).every((entry) => {
          const { definition: none, licence, signedOff } = entry;
          return none === null && licence === 'unconfirmed' && !signedOff;
        }),
      ).toBe(true);
      expect(await knowledgeVersionSignOff(tx, version.id)).toMatchObject({ questionnaires: 18 });
    });
  });

  it('refuses an instrument signed off without its items or a confirmed licence', async () => {
    await rolledBack(async (tx) => {
      const version = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
      const add = (values: Partial<typeof kbQuestionnaire.$inferInsert>) =>
        failure(tx, (sp) =>
          sp.insert(kbQuestionnaire).values({
            kbVersionId: version.id,
            key: 'test_instrument',
            name: 'Test instrument',
            useFor: 'Tests',
            sort: 99,
            ...values,
          }),
        );
      expect(await add({ signedOff: true }), 'no items').toBe('23514');
      expect(await add({ signedOff: true, definition }), 'no licence').toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp.execute(sql`insert into kb_questionnaire
            (kb_version_id, key, name, use_for, sort, definition, licence, signed_off)
            values (${version.id}, 'test_instrument', 'Test', 'Tests', 99, 'null'::jsonb, 'free', true)`),
        ),
        'a JSON null for items',
      ).toBe('23514');
      expect(await add({ signedOff: true, definition, licence: 'licensed' })).toBeUndefined();
    });
    // The committed file is held to the same rule when it is read.
    const file = JSON.parse(await readPlanCatalogFile()) as { questionnaires: object[] };
    file.questionnaires = [
      { key: 'test_instrument', name: 'Test', regions: [], useFor: 'Tests', signedOff: true },
    ];
    expect(() => buildPlanCatalog(JSON.stringify(file))).toThrow(
      /Sign an instrument off only with its items and a confirmed licence/,
    );
  });
});

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
      expect(await knowledgeConditions(tx, version.id)).toHaveLength(332);
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
      expect(row?.report).toMatchObject({ totals: { listings: 354, conditions: 332, merged: 20 } });

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
        { entity: 'kb_condition', n: 332 },
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
        expect((await knowledgeConditions(tx, id)).length, reader.email).toBe(332);
        expect((await knowledgeListings(tx, id)).length, reader.email).toBe(354);
        expect((await redFlagRules(tx, id)).length, reader.email).toBe(20);
        expect((await redFlagPresentations(tx, id)).length, reader.email).toBe(136);
        // CLN-05: the Objective's measures and special tests.
        const read = await knowledgeObjective(tx, id);
        expect(read.measures.length, reader.email).toBe(143);
        expect(read.specialTests.length, reader.email).toBe(244);
        // CLN-06: the Assessment's conditions, with each workbook's row, and the categories.
        const assessment = await knowledgeAssessment(tx, id);
        expect(assessment.conditions.length, reader.email).toBe(332);
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
        // SET-06: only internal.approve_kb_version approves; direct writes stay invisible.
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

// SET-06 done when: the Super Admin approves a version; records store the version used. New
// records take the live version: the newest approved, and before the first approval the newest
// import. Approval goes only through internal.approve_kb_version: the Super Admin (not support), a
// draft newer than the live version, audited; an approved version never changes, and none is
// deleted.
describe('knowledge base approval', () => {
  /** The import as a draft, then a newer draft with no content, as the owner. */
  async function twoDrafts(tx: Tx) {
    const imported = await applyKnowledge(
      tx,
      built,
      report,
      redFlags,
      objective,
      categories,
      planCatalog,
    );
    const [newer] = await tx
      .insert(kbVersion)
      .values({
        number: imported.number + 1,
        source: { files: [{ name: 'test.xlsx', sha256: 'test' }] },
        report: {},
        createdBy: KB_IMPORT_ACTOR,
      })
      .returning({ id: kbVersion.id, number: kbVersion.number });
    if (!newer) throw new Error('no newer draft');
    return { imported, newer };
  }

  it('lets the Super Admin approve a draft, audited, and makes it the live version', async () => {
    await rolledBack(async (tx) => {
      const { imported, newer } = await twoDrafts(tx);
      // Nothing approved yet: the newest import is live.
      expect((await latestKnowledgeVersion(tx))?.number).toBe(newer.number);
      await becomes(tx, superAdmin);
      expect(await approveKnowledgeVersion(tx, { versionId: imported.id, notes: ' Read ' })).toBe(
        imported.number,
      );
      await tx.execute(sql`reset role`);
      const [row] = await tx.select().from(kbVersion).where(eq(kbVersion.id, imported.id));
      expect(row).toMatchObject({ status: 'approved', approvedBy: superAdmin.id, notes: 'Read' });
      expect(row?.approvedAt).toBeInstanceOf(Date);
      const [audited] = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'kb_version'), eq(auditEvent.entityId, imported.id)))
        .orderBy(sql`${auditEvent.id} desc`)
        .limit(1);
      expect(audited).toEqual({ actor: `staff:${superAdmin.id}`, action: 'update' });
      // Approved: the live version, and the newer draft never goes live while unapproved.
      expect((await latestKnowledgeVersion(tx))?.id).toBe(imported.id);
      await becomes(tx, superAdmin);
      expect(await approveKnowledgeVersion(tx, { versionId: newer.id })).toBe(newer.number);
      await tx.execute(sql`reset role`);
      expect((await latestKnowledgeVersion(tx))?.id).toBe(newer.id);
    });
  });

  it('refuses a second approval, an older version, and anyone but the Super Admin', async () => {
    await rolledBack(async (tx) => {
      const { imported, newer } = await twoDrafts(tx);
      for (const someone of [manager, physio, desk, finance, support]) {
        expect(
          await failure(tx, async (sp) => {
            await becomes(sp, someone);
            await approveKnowledgeVersion(sp, { versionId: imported.id });
          }),
          someone.email,
        ).toBe('42501');
      }
      await becomes(tx, superAdmin);
      await approveKnowledgeVersion(tx, { versionId: newer.id });
      // Each refusal in its own savepoint, as the error ends a transaction.
      const refusal = (versionId: string) =>
        tx.transaction((sp) => approveKnowledgeVersion(sp, { versionId }));
      await expect(refusal(newer.id)).rejects.toThrow(KnowledgeVersionNotApprovableError);
      // Older than the live version: it never goes live.
      await expect(refusal(imported.id)).rejects.toThrow(/older than the live version/);
      await expect(refusal('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
        KnowledgeVersionNotApprovableError,
      );
    });
  });

  it('never changes or deletes an approved version, nor changes a draft but by approval', async () => {
    await rolledBack(async (tx) => {
      const { imported, newer } = await twoDrafts(tx);
      // Even the owner cannot.
      expect(
        await failure(tx, (sp) =>
          sp.update(kbVersion).set({ report: {} }).where(eq(kbVersion.id, imported.id)),
        ),
      ).toBe('23514');
      await becomes(tx, superAdmin);
      await approveKnowledgeVersion(tx, { versionId: newer.id });
      await tx.execute(sql`reset role`);
      expect(
        await failure(tx, (sp) =>
          sp.update(kbVersion).set({ notes: 'Changed' }).where(eq(kbVersion.id, newer.id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) => sp.delete(kbVersion).where(eq(kbVersion.id, newer.id))),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) => sp.delete(kbVersion).where(eq(kbVersion.id, imported.id))),
      ).toBe('23514');
    });
  });

  it('switches the phases and readiness criteria to the live version too', async () => {
    await rolledBack(async (tx) => {
      const older = await applyKnowledge(
        tx,
        built,
        report,
        redFlags,
        objective,
        categories,
        planCatalog,
      );
      // A second import of the same content from a changed rules file: a newer full draft.
      const newer = await applyKnowledge(
        tx,
        built,
        report,
        {
          ...redFlags,
          rulesFile: { ...redFlags.rulesFile, sha256: `${redFlags.rulesFile.sha256}1` },
        },
        objective,
        categories,
        planCatalog,
      );
      const phaseRegion = objective.phases[0]?.region;
      const criteriaRegion = objective.readiness[0]?.region;
      if (!phaseRegion || !criteriaRegion) throw new Error('no phases or criteria imported');
      expect(await latestPhaseVersion(tx, phaseRegion)).toBe(newer.id);
      expect(await latestCriteriaVersion(tx, criteriaRegion)).toBe(newer.id);
      await becomes(tx, superAdmin);
      await approveKnowledgeVersion(tx, { versionId: older.id });
      await tx.execute(sql`reset role`);
      // The newer draft holds phases and criteria too, but is not approved.
      expect(await latestPhaseVersion(tx, phaseRegion)).toBe(older.id);
      expect(await latestCriteriaVersion(tx, criteriaRegion)).toBe(older.id);
      await becomes(tx, superAdmin);
      await approveKnowledgeVersion(tx, { versionId: newer.id });
      await tx.execute(sql`reset role`);
      expect(await latestPhaseVersion(tx, phaseRegion)).toBe(newer.id);
      expect(await latestCriteriaVersion(tx, criteriaRegion)).toBe(newer.id);
    });
  });

  it('counts every record that stored a version, for the Super Admin only', async () => {
    await rolledBack(async (tx) => {
      const version = await latestKnowledgeVersion(tx);
      if (!version) throw new Error('The knowledge base is not imported.');
      // Drafts and records at any centre, as the owner counts them.
      const [all] = await tx.execute<{ consultations: number; sessions: number }>(sql`
        select (select count(*)::integer from public.consultation where kb_version_id = ${version.id})
          as consultations,
          (select count(*)::integer from public.session where kb_version_id = ${version.id})
          as sessions`);
      await becomes(tx, superAdmin);
      expect(await knowledgeVersionUsage(tx, version.id)).toEqual(all);
      for (const someone of [manager, physio, desk, finance, support]) {
        expect(
          await failure(tx, async (sp) => {
            await becomes(sp, someone);
            await knowledgeVersionUsage(sp, version.id);
          }),
          someone.email,
        ).toBe('42501');
      }
    });
  });
});
