import {
  aiPreparationSheet,
  appointment,
  aiRun,
  aiSuggestion,
  createDb,
  intakeResponse,
  kbConditionListing,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { and, asc, desc, eq } from 'drizzle-orm';

// AI preparation sheets for the AI-03 tests. No OpenRouter key exists, so a ranked sheet is seeded
// as the system would store one, from real rows of the live knowledge base version; the real
// pipeline makes an unavailable sheet (not configured). Generated patients only (rule 12).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export interface SeededRow {
  conditionId: string;
  name: string;
  discriminatingQuestion: string | null;
  testsImaging: string | null;
}

/**
 * A ready sheet for the episode: five of the live version's knee rows ranked (three on top, two
 * under Also consider) and one Red flag knee row on Must rule out, by rule.
 */
export async function seedReadySheet(
  episodeId: string,
  version: { id: string },
): Promise<{ suggestions: SeededRow[]; mustRuleOut: SeededRow }> {
  const knee = await db()
    .select({
      conditionId: kbConditionListing.conditionId,
      region: kbConditionListing.region,
      rowNumber: kbConditionListing.rowNumber,
      name: kbConditionListing.name,
      discriminatingQuestion: kbConditionListing.discriminatingQuestion,
      testsImaging: kbConditionListing.testsImaging,
      redFlagTier: kbConditionListing.redFlagTier,
    })
    .from(kbConditionListing)
    .where(
      and(eq(kbConditionListing.kbVersionId, version.id), eq(kbConditionListing.region, 'knee')),
    )
    .orderBy(asc(kbConditionListing.rowNumber));
  const ranked = knee
    .filter((row) => row.redFlagTier !== 'red_flag' && row.discriminatingQuestion)
    .slice(0, 5);
  const flagged = knee.find((row) => row.redFlagTier === 'red_flag' && row.discriminatingQuestion);
  if (ranked.length < 5 || !flagged) throw new Error('The live version has too few knee rows.');
  const fit = { age: 'match', onset: 'unknown', sex: 'neutral' };
  await withActor(db(), systemActor('ai'), async (tx) => {
    const [run] = await tx
      .insert(aiRun)
      .values({
        kind: 'rank_diagnoses',
        episodeId,
        kbVersionId: version.id,
        model: 'vendor/e2e-model',
        promptVersion: 'rank_diagnoses.v1',
        inputHash: 'e'.repeat(64),
        status: 'ok',
        attempts: 1,
        latencyMs: 1200,
      })
      .returning({ id: aiRun.id });
    if (!run) throw new Error('no run');
    const [sheet] = await tx
      .insert(aiPreparationSheet)
      .values({
        episodeId,
        kbVersionId: version.id,
        status: 'ready',
        aiRunId: run.id,
        readyAt: new Date(),
        shortlist: {
          status: 'ok',
          knowledgeRegion: 'knee',
          candidateCount: ranked.length,
          gaps: [],
          items: [
            { ...pick(flagged), fit, filtered: false, mustRuleOut: true },
            ...ranked.map((row) => ({ ...pick(row), fit, filtered: true, mustRuleOut: false })),
          ],
        },
        case: {
          age: 34,
          sex: 'female',
          region: 'knee',
          symptoms: ['Pain on stairs'],
          durationWeeks: 6,
          sport: ['Running'],
          goal: 'Run a 10 km race',
        },
      })
      .returning({ id: aiPreparationSheet.id });
    if (!sheet) throw new Error('no sheet');
    await tx.insert(aiSuggestion).values(
      ranked.map((row, index) => ({
        sheetId: sheet.id,
        aiRunId: run.id,
        ...pick(row),
        rank: index + 1,
        section: index < 3 ? ('top' as const) : ('also_consider' as const),
        reason: `E2E reason ${String(index + 1)}`,
      })),
    );
  });
  return { suggestions: ranked, mustRuleOut: flagged };
}

function pick(row: { conditionId: string; region: string; rowNumber: number }) {
  return { conditionId: row.conditionId, region: row.region as 'knee', rowNumber: row.rowNumber };
}

/** The episode's sheet as stored, its run and the form it was made from. */
export async function sheetOf(episodeId: string) {
  const [sheet] = await db()
    .select({
      status: aiPreparationSheet.status,
      reason: aiPreparationSheet.unavailableReason,
      readyAt: aiPreparationSheet.readyAt,
      runStatus: aiRun.status,
      shortlist: aiPreparationSheet.shortlist,
    })
    .from(aiPreparationSheet)
    .leftJoin(aiRun, eq(aiRun.id, aiPreparationSheet.aiRunId))
    .where(eq(aiPreparationSheet.episodeId, episodeId));
  const [form] = await db()
    .select({ submittedAt: intakeResponse.submittedAt })
    .from(intakeResponse)
    .where(eq(intakeResponse.episodeId, episodeId))
    .orderBy(desc(intakeResponse.submittedAt))
    .limit(1);
  return { sheet, submittedAt: form?.submittedAt ?? null };
}

/** Each suggestion's disposition, by condition. */
export async function dispositionsOf(episodeId: string) {
  return db()
    .select({ conditionId: aiSuggestion.conditionId, disposition: aiSuggestion.disposition })
    .from(aiSuggestion)
    .innerJoin(aiPreparationSheet, eq(aiPreparationSheet.id, aiSuggestion.sheetId))
    .where(eq(aiPreparationSheet.episodeId, episodeId))
    .orderBy(asc(aiSuggestion.rank));
}

/** The episode the visit's health form opened. */
export async function episodeOfVisit(appointmentId: string): Promise<string> {
  const [row] = await db()
    .select({ episodeId: appointment.episodeId })
    .from(appointment)
    .where(eq(appointment.id, appointmentId));
  if (!row?.episodeId) throw new Error('The visit has no episode.');
  return row.episodeId;
}
