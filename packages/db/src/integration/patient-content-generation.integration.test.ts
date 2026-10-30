import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { aiSpendSince, insertAiRun } from '../ai-runs';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { liveKbVersionId, patientContentOf, savePatientContentDraft } from '../patient-content';
import {
  conditionsWithoutPatientContent,
  insertAiPatientContentDraft,
  patientContentSpend,
  regionPhases,
} from '../patient-content-generation';
import { centreIds, seedStaff } from '../seed/data';
import { becomeStaff, testPhysio } from './fake-schedule';

// AI-07 done when: content generated once per condition; clinician approves before patients see
// it. The one-time run drafts only conditions with neither a draft nor approved content, from their
// own knowledge base text and their region's phases; an AI draft is the server's (source ai, no
// writer) and never replaces a draft; its spend has its own budget, never the daily cap. Generated
// text only. Rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const superAdminId = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';

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

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

const text = (word: string) => ({
  explanation: `Test explanation ${word}`,
  roadmap: `Test roadmap ${word}`,
  homeAdvice: `Test home advice ${word}`,
  warningSigns: `Test warning signs ${word}`,
});

async function liveVersion(tx: Tx) {
  const id = await liveKbVersionId(tx);
  if (!id) throw new Error('No live knowledge base version.');
  return id;
}

describe('patient content written by AI', () => {
  it('drafts only conditions without content, as the server, and never over a draft', async () => {
    await rolledBack(async (tx) => {
      const kbVersionId = await liveVersion(tx);
      const before = await conditionsWithoutPatientContent(tx, kbVersionId);
      const [first, second] = before;
      if (!first || !second) throw new Error('The live knowledge base has too few conditions.');
      expect(first).toMatchObject({
        conditionId: expect.stringMatching(/^[A-Z]{3}-\d{3}$/) as string,
        name: expect.any(String) as string,
        region: expect.any(String) as string,
      });
      expect(before.some((c) => c.symptoms !== null && Object.keys(c.details).length > 0)).toBe(
        true,
      );

      // A consultant's draft on the first, an AI draft on the second.
      const consultant = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: superAdminId,
      });
      await becomeStaff(tx, consultant);
      await savePatientContentDraft(tx, { conditionId: first.conditionId, ...text('clinician') });
      await asOwner(tx);
      const aiDraft = await insertAiPatientContentDraft(tx, {
        conditionId: second.conditionId,
        kbVersionId,
        ...text('ai'),
      });
      expect(aiDraft).toBeDefined();
      expect((await patientContentOf(tx, second.conditionId)).draft).toMatchObject({
        id: aiDraft,
        source: 'ai',
        writtenByName: null,
        revision: 1,
        ...text('ai'),
      });

      // Neither is asked for again.
      const after = await conditionsWithoutPatientContent(tx, kbVersionId);
      expect(after).toHaveLength(before.length - 2);
      expect(after.map((c) => c.conditionId)).not.toContain(first.conditionId);
      expect(after.map((c) => c.conditionId)).not.toContain(second.conditionId);

      // An AI draft never replaces the consultant's.
      expect(
        await insertAiPatientContentDraft(tx, {
          conditionId: first.conditionId,
          kbVersionId,
          ...text('late'),
        }),
      ).toBeUndefined();
      expect((await patientContentOf(tx, first.conditionId)).draft).toMatchObject({
        source: 'clinician',
        ...text('clinician'),
      });
    });
  });

  it('reads each region’s phases in order', async () => {
    await rolledBack(async (tx) => {
      const phases = await regionPhases(tx, await liveVersion(tx));
      const regions = Object.values(phases);
      expect(regions.length).toBeGreaterThan(0);
      for (const list of regions) {
        expect(list.every((p) => p.name.length > 0)).toBe(true);
      }
    });
  });

  it('counts its spend apart from the daily cap, and only for a version, never an episode', async () => {
    await rolledBack(async (tx) => {
      const kbVersionId = await liveVersion(tx);
      const since = new Date(Date.now() - 60_000);
      const [dailyBefore, contentBefore] = [
        await aiSpendSince(tx, since),
        await patientContentSpend(tx),
      ];
      const run = (kind: 'write_patient_content' | 'rank_diagnoses', cost: bigint) => ({
        kind,
        kbVersionId,
        model: 'vendor/model-1',
        promptVersion: `${kind}.v1`,
        inputHash: createHash('sha256').update(kind).digest('hex'),
        status: 'ok' as const,
        attempts: 1,
        latencyMs: 900,
        costMicroUsd: cost,
      });
      await insertAiRun(tx, run('write_patient_content', 5000n));
      await insertAiRun(tx, run('rank_diagnoses', 1200n));
      expect(await patientContentSpend(tx)).toBe(contentBefore + 5000n);
      expect(await aiSpendSince(tx, since)).toBe(dailyBefore + 1200n);
      expect(
        await failure(tx, (sp) =>
          insertAiRun(sp, { ...run('write_patient_content', 1n), kbVersionId: null }),
        ),
      ).toBe('23514');
    });
  });
});
