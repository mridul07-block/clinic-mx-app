import type {
  ConditionKnowledge,
  KnowledgeRegion,
  PatientContentDraft,
  RegionPhase,
} from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { aiRun, kbPatientContent } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Patient content written by AI (AI-07; docs/runbooks/patient-content.md): the conditions still
 * without any content, their knowledge base text and their region's phases, what the one-time
 * generation has spent, and an AI draft saved by the server. Run by the server only.
 */

/**
 * The live version's conditions with neither a draft nor approved content, by condition ID, with
 * their knowledge base text: the listing in their home workbook, else their first.
 */
export async function conditionsWithoutPatientContent(
  db: DbOrTransaction,
  kbVersionId: string,
): Promise<ConditionKnowledge[]> {
  const rows = await db.execute<{
    condition_id: string;
    name: string;
    synonyms: string[];
    home_region: KnowledgeRegion;
    symptoms: string | null;
    biomechanical_cause: string | null;
    red_flag_text: string | null;
    details: Record<string, { label: string; text: string }> | null;
  }>(sql`
    select distinct on (c.condition_id)
      c.condition_id, c.name, c.synonyms, c.home_region,
      l.symptoms, l.biomechanical_cause, l.red_flag_text, l.details
    from kb_condition c
    left join kb_condition_listing l
      on l.kb_version_id = c.kb_version_id and l.condition_id = c.condition_id
    where c.kb_version_id = ${kbVersionId}
      and not exists (
        select 1 from kb_patient_content p
        where p.condition_id = c.condition_id and p.status in ('draft', 'approved'))
    order by c.condition_id, (l.region = c.home_region) desc nulls last, l.region, l.row_number`);
  return rows.map((row) => ({
    conditionId: row.condition_id,
    name: row.name,
    synonyms: row.synonyms,
    region: row.home_region,
    symptoms: row.symptoms,
    biomechanicalCause: row.biomechanical_cause,
    redFlagText: row.red_flag_text,
    details: row.details ?? {},
  }));
}

/** Each region's programme phases in the version, in order (SET-09's import). */
export async function regionPhases(
  db: DbOrTransaction,
  kbVersionId: string,
): Promise<Partial<Record<KnowledgeRegion, RegionPhase[]>>> {
  const rows = await db.execute<{
    region: KnowledgeRegion;
    name: string;
    timing: string;
    goal: string;
  }>(sql`
    select region, name, timing, goal from kb_phase
    where kb_version_id = ${kbVersionId}
    order by region, number, row_number`);
  const phases: Partial<Record<KnowledgeRegion, RegionPhase[]>> = {};
  for (const row of rows) {
    (phases[row.region] ??= []).push({ name: row.name, timing: row.timing, goal: row.goal });
  }
  return phases;
}

/**
 * What writing patient content has been charged in all, in millionths of a US dollar: it has its
 * own one-time budget and never counts against the daily cap.
 */
export async function patientContentSpend(db: DbOrTransaction): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiRun.costMicroUsd}), 0)::text` })
    .from(aiRun)
    .where(eq(aiRun.kind, 'write_patient_content'));
  return BigInt(row?.total ?? '0');
}

/**
 * Saves an AI draft against the version its text was read from, by the server: source `ai`, no
 * writer, revision 1. Should that version stop being live, the draft is saved again before it can
 * be approved. Undefined when the condition gained a draft meanwhile, which is never overwritten.
 */
export async function insertAiPatientContentDraft(
  tx: DbOrTransaction,
  draft: PatientContentDraft & { kbVersionId: string },
): Promise<string | undefined> {
  const [made] = await tx
    .insert(kbPatientContent)
    .values({
      conditionId: draft.conditionId,
      explanation: draft.explanation,
      roadmap: draft.roadmap,
      homeAdvice: draft.homeAdvice,
      warningSigns: draft.warningSigns,
      kbVersionId: draft.kbVersionId,
      source: 'ai',
    })
    .onConflictDoNothing()
    .returning({ id: kbPatientContent.id });
  return made?.id;
}
