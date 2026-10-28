import { istDate, startOfIstDay } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AI_SPEND_CAP_TASK,
  aiSpendSince,
  blindTestSpend,
  insertAiRun,
  openAiSpendCapTask,
} from '../ai-runs';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { latestKnowledgeVersion } from '../knowledge';
import { aiRun, auditEvent, task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio } from './fake-schedule';

// AI-01 done when (the database part): every gateway run is logged to ai_run, written only by the
// server and never changed; consultants read the runs of episodes at their centres (TAD: "ai_run
// only with consultant"); the daily spend counts the IST day; one open spend cap task at a time.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

class Rollback extends Error {}
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('audit.actor', 'system:ai', true)`);
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The Postgres error code a statement failed with, inside a savepoint; undefined if none. */
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

const hash = 'a'.repeat(64);

async function setUp(tx: Tx) {
  const version = await latestKnowledgeVersion(tx);
  if (!version) throw new Error('The knowledge base is not imported.');
  const episodeId = await insertEpisode(tx, {
    patientId: await testPatient(tx),
    centreId: centreIds.hsrLayout,
  });
  const run = (extra: Partial<Parameters<typeof insertAiRun>[1]> = {}) =>
    insertAiRun(tx, {
      kind: 'rank_diagnoses',
      episodeId,
      kbVersionId: version.id,
      model: 'vendor/model-1',
      promptVersion: 'rank_diagnoses.v1',
      inputHash: hash,
      input: { case: { region: 'knee' } },
      status: 'ok',
      attempts: 1,
      latencyMs: 900,
      costMicroUsd: 1200n,
      ...extra,
    });
  const consultantHere = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const consultantElsewhere = await testPhysio(tx, {
    centreIds: [centreIds.whitefield],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const physioHere = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: false,
    createdBy: superAdmin.id,
  });
  await tx.execute(sql`select set_config('audit.actor', 'system:ai', true)`);
  return { version, episodeId, run, consultantHere, consultantElsewhere, physioHere };
}

async function sees(tx: Tx, who: StaffMember, id: string): Promise<boolean> {
  await becomeStaff(tx, who);
  const rows = await tx.select({ id: aiRun.id }).from(aiRun).where(eq(aiRun.id, id));
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('audit.actor', 'system:ai', true)`);
  return rows.length === 1;
}

describe('the AI run log', () => {
  it('is read by consultants at the episode’s centre only', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const id = await s.run();
      expect(await sees(tx, s.consultantHere, id)).toBe(true);
      for (const someone of [s.consultantElsewhere, s.physioHere, desk, finance, manager]) {
        expect(await sees(tx, someone, id), someone.email).toBe(false);
      }
      // A run outside an episode is read by nobody signed in.
      const outside = await s.run({ kind: 'tag_feedback', episodeId: null, kbVersionId: null });
      expect(await sees(tx, s.consultantHere, outside)).toBe(false);
    });
  });

  it('is written only by the server, audited, and never changed or deleted', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const id = await s.run();
      const [audited] = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'ai_run'), eq(auditEvent.entityId, id)));
      expect(audited).toEqual({ actor: 'system:ai', action: 'insert' });
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, s.consultantHere);
          await sp.insert(aiRun).values({
            kind: 'rank_diagnoses',
            episodeId: s.episodeId,
            kbVersionId: s.version.id,
            promptVersion: 'rank_diagnoses.v1',
            inputHash: hash,
            status: 'ok',
            attempts: 1,
            latencyMs: 1,
          });
        }),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          sp.update(aiRun).set({ status: 'failed' }).where(eq(aiRun.id, id)),
        ),
      ).toBe('23514');
      expect(await failure(tx, (sp) => sp.delete(aiRun).where(eq(aiRun.id, id)))).toBe('23514');
      // A clinical run names its knowledge base version.
      expect(await failure(tx, () => s.run({ kbVersionId: null }))).toBe('23514');
    });
  });

  // AI-06: a blind test's runs are tagged, outside any episode, counted against their own budget
  // and never against the live daily cap, and read by nobody signed in.
  it('keeps blind test runs out of the live spend, and out of sight', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const blindRun = '00000000-0000-4000-8000-000000000b01';
      const today = startOfIstDay(istDate(new Date()));
      const before = await aiSpendSince(tx, today);
      const id = await s.run({ episodeId: null, blindTestRun: blindRun, costMicroUsd: 7000n });
      await s.run({ episodeId: null, blindTestRun: blindRun, costMicroUsd: 3000n });
      expect(await blindTestSpend(tx, blindRun)).toBe(10000n);
      expect(await aiSpendSince(tx, today)).toBe(before);
      expect(await sees(tx, s.consultantHere, id)).toBe(false);
      // A blind run is never an episode's, and only ever a ranking.
      expect(await failure(tx, () => s.run({ blindTestRun: blindRun }))).toBe('23514');
      expect(
        await failure(tx, () =>
          s.run({ episodeId: null, blindTestRun: blindRun, kind: 'recheck_with_findings' }),
        ),
      ).toBe('23514');
    });
  });

  it('counts the spend of the IST day, in millionths of a dollar', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const today = startOfIstDay(istDate(new Date()));
      const before = await aiSpendSince(tx, today);
      await s.run({ costMicroUsd: 1200n });
      await s.run({ costMicroUsd: null, status: 'failed' });
      const yesterday = await s.run({ costMicroUsd: 5000n });
      await tx.execute(sql`alter table public.ai_run disable trigger ai_run_append_only`);
      await tx
        .update(aiRun)
        .set({ createdAt: new Date(today.getTime() - 60_000) })
        .where(eq(aiRun.id, yesterday));
      await tx.execute(sql`alter table public.ai_run enable trigger ai_run_append_only`);
      expect(await aiSpendSince(tx, today)).toBe(before + 1200n);
    });
  });

  it('keeps one open spend cap task at a time, for the Super Admin', async () => {
    await rolledBack(async (tx) => {
      const day = istDate(new Date());
      await openAiSpendCapTask(tx, { capPaise: 20000, spentPaise: '20001', day });
      await openAiSpendCapTask(tx, { capPaise: 20000, spentPaise: '20500', day });
      const open = await tx
        .select({ role: task.assigneeRole, priority: task.priority })
        .from(task)
        .where(and(eq(task.kind, AI_SPEND_CAP_TASK), eq(task.status, 'open')));
      expect(open).toEqual([{ role: 'super_admin', priority: 'high' }]);
    });
  });
});
