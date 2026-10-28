import type {
  AiCase,
  AiDisposition,
  AiSheetStatus,
  AiSheetUnavailableReason,
  Shortlist,
  ValidatedSuggestion,
} from '@clinic-mx/schemas';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  aiPreparationSheet,
  aiSuggestion,
  episode,
  guardian,
  kbConditionListing,
  kbVersion,
  patient,
} from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Takes an episode's preparation sheet to make (AI-03): a new sheet, or one still pending whose
 * run stopped more than `retryAfterSeconds` ago. Null when another run holds it or it is made, so
 * two runners never both pay for a model call.
 */
export async function claimSheet(
  tx: DbOrTransaction,
  sheet: {
    episodeId: string;
    kbVersionId: string;
    shortlist: Shortlist;
    case: AiCase | null;
    retryAfterSeconds: number;
  },
): Promise<{ id: string; claimedAt: Date } | null> {
  const [row] = await tx
    .insert(aiPreparationSheet)
    .values({
      episodeId: sheet.episodeId,
      kbVersionId: sheet.kbVersionId,
      status: 'pending',
      shortlist: sheet.shortlist,
      case: sheet.case,
    })
    .onConflictDoUpdate({
      target: aiPreparationSheet.episodeId,
      set: {
        kbVersionId: sheet.kbVersionId,
        shortlist: sheet.shortlist,
        case: sheet.case,
        claimedAt: sql`now()`,
      },
      setWhere: sql`${aiPreparationSheet.status} = 'pending'
        and ${aiPreparationSheet.claimedAt} < now() - make_interval(secs => ${sheet.retryAfterSeconds})`,
    })
    .returning({ id: aiPreparationSheet.id, claimedAt: aiPreparationSheet.claimedAt });
  return row ?? null;
}

/** Whether the episode's sheet is still being made; undefined when there is none. */
export async function sheetStatus(
  db: DbOrTransaction,
  episodeId: string,
): Promise<AiSheetStatus | undefined> {
  const [row] = await db
    .select({ status: aiPreparationSheet.status })
    .from(aiPreparationSheet)
    .where(eq(aiPreparationSheet.episodeId, episodeId));
  return row?.status;
}

/**
 * Records how the sheet ended, with the model's validated suggestions when it has any, only while
 * this run still holds its claim: a run that outlived its claim writes nothing. Whether it wrote.
 */
export async function finishSheet(
  tx: DbOrTransaction,
  claim: { id: string; claimedAt: Date },
  result:
    | { status: 'ready'; aiRunId: string; suggestions: readonly ValidatedSuggestion[] }
    | { status: 'unavailable'; reason: AiSheetUnavailableReason; aiRunId: string | null },
): Promise<boolean> {
  const finished = await tx
    .update(aiPreparationSheet)
    .set({
      status: result.status,
      unavailableReason: result.status === 'unavailable' ? result.reason : null,
      aiRunId: result.aiRunId,
      readyAt: sql`now()`,
    })
    .where(
      and(
        eq(aiPreparationSheet.id, claim.id),
        eq(aiPreparationSheet.status, 'pending'),
        // The claim's own moment, to the millisecond a Date holds.
        sql`date_trunc('milliseconds', ${aiPreparationSheet.claimedAt}) = ${claim.claimedAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: aiPreparationSheet.id });
  if (finished.length === 0) return false;
  if (result.status === 'ready' && result.suggestions.length > 0) {
    await tx
      .insert(aiSuggestion)
      .values(
        result.suggestions.map((s) => ({ ...s, sheetId: claim.id, aiRunId: result.aiRunId })),
      );
  }
  return true;
}

export interface PreparationSheet {
  id: string;
  episodeId: string;
  kbVersionId: string;
  kbVersionNumber: number;
  status: AiSheetStatus;
  unavailableReason: string | null;
  shortlist: Shortlist;
  case: AiCase | null;
  readyAt: Date | null;
  suggestions: {
    id: string;
    conditionId: string;
    region: Shortlist['items'][number]['region'];
    rowNumber: number;
    rank: number;
    section: 'top' | 'also_consider';
    reason: string;
    disposition: AiDisposition | null;
    disposedAt: Date | null;
  }[];
}

/** An episode's sheet with its suggestions, under the reader's access; undefined when none. */
export async function sheetForEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<PreparationSheet | undefined> {
  const [sheet] = await db
    .select({
      id: aiPreparationSheet.id,
      episodeId: aiPreparationSheet.episodeId,
      kbVersionId: aiPreparationSheet.kbVersionId,
      kbVersionNumber: kbVersion.number,
      status: aiPreparationSheet.status,
      unavailableReason: aiPreparationSheet.unavailableReason,
      shortlist: aiPreparationSheet.shortlist,
      case: aiPreparationSheet.case,
      readyAt: aiPreparationSheet.readyAt,
      aiRunId: aiPreparationSheet.aiRunId,
    })
    .from(aiPreparationSheet)
    .innerJoin(kbVersion, eq(kbVersion.id, aiPreparationSheet.kbVersionId))
    .where(eq(aiPreparationSheet.episodeId, episodeId));
  if (!sheet) return undefined;
  const suggestions = sheet.aiRunId
    ? await db
        .select({
          id: aiSuggestion.id,
          conditionId: aiSuggestion.conditionId,
          region: aiSuggestion.region,
          rowNumber: aiSuggestion.rowNumber,
          rank: aiSuggestion.rank,
          section: aiSuggestion.section,
          reason: aiSuggestion.reason,
          disposition: aiSuggestion.disposition,
          disposedAt: aiSuggestion.disposedAt,
        })
        .from(aiSuggestion)
        .where(and(eq(aiSuggestion.sheetId, sheet.id), eq(aiSuggestion.aiRunId, sheet.aiRunId)))
        .orderBy(asc(aiSuggestion.rank))
    : [];
  return {
    id: sheet.id,
    episodeId: sheet.episodeId,
    kbVersionId: sheet.kbVersionId,
    kbVersionNumber: sheet.kbVersionNumber,
    status: sheet.status,
    unavailableReason: sheet.unavailableReason,
    readyAt: sheet.readyAt,
    shortlist: sheet.shortlist as Shortlist,
    case: sheet.case as AiCase | null,
    suggestions,
  };
}

export type SheetListing = Pick<
  typeof kbConditionListing.$inferSelect,
  | 'conditionId'
  | 'region'
  | 'rowNumber'
  | 'name'
  | 'discriminatingQuestion'
  | 'testsImaging'
  | 'biomechanicalCause'
  | 'redFlagText'
  | 'details'
>;

/** The knowledge base's own words for the sheet's rows, from the sheet's version. */
export async function sheetListings(
  db: DbOrTransaction,
  kbVersionId: string,
  conditionIds: readonly string[],
): Promise<SheetListing[]> {
  if (conditionIds.length === 0) return [];
  return db
    .select({
      conditionId: kbConditionListing.conditionId,
      region: kbConditionListing.region,
      rowNumber: kbConditionListing.rowNumber,
      name: kbConditionListing.name,
      discriminatingQuestion: kbConditionListing.discriminatingQuestion,
      testsImaging: kbConditionListing.testsImaging,
      biomechanicalCause: kbConditionListing.biomechanicalCause,
      redFlagText: kbConditionListing.redFlagText,
      details: kbConditionListing.details,
    })
    .from(kbConditionListing)
    .where(
      and(
        eq(kbConditionListing.kbVersionId, kbVersionId),
        inArray(kbConditionListing.conditionId, [...conditionIds]),
      ),
    );
}

/** The patient's and guardians' name words: never sent to a model (rule 11). Server only. */
export async function episodeNameWords(db: DbOrTransaction, episodeId: string): Promise<string[]> {
  const [row] = await db
    .select({ patientId: patient.id, name: patient.name })
    .from(episode)
    .innerJoin(patient, eq(patient.id, episode.patientId))
    .where(eq(episode.id, episodeId));
  if (!row) return [];
  const guardians = await db
    .select({ name: guardian.name })
    .from(guardian)
    .where(eq(guardian.patientId, row.patientId));
  return [row.name, ...guardians.map((g) => g.name)];
}

/** A suggestion's sheet, episode and centre, under the reader's access; undefined when unseen. */
export async function suggestionTarget(
  db: DbOrTransaction,
  suggestionId: string,
): Promise<{ sheetId: string; episodeId: string; centreId: string } | undefined> {
  const [row] = await db
    .select({
      sheetId: aiSuggestion.sheetId,
      episodeId: aiPreparationSheet.episodeId,
      centreId: episode.centreId,
    })
    .from(aiSuggestion)
    .innerJoin(aiPreparationSheet, eq(aiPreparationSheet.id, aiSuggestion.sheetId))
    .innerJoin(episode, eq(episode.id, aiPreparationSheet.episodeId))
    .where(eq(aiSuggestion.id, suggestionId));
  return row;
}

/** Whether the signed in staff member may keep or dismiss this sheet's suggestions now. */
export async function canDisposeSheet(db: DbOrTransaction, sheetId: string): Promise<boolean> {
  const [row] = await db.execute<{ ok: boolean }>(
    sql`select internal.ai_sheet_disposer(${sheetId}::uuid) as ok`,
  );
  return row?.ok === true;
}

/** Keeps or dismisses a suggestion as the signed in physio; how many rows changed. */
export async function setDisposition(
  tx: DbOrTransaction,
  suggestionId: string,
  disposition: AiDisposition,
  staffId: string,
): Promise<number> {
  const rows = await tx
    .update(aiSuggestion)
    .set({ disposition, disposedBy: staffId, disposedAt: sql`now()` })
    .where(eq(aiSuggestion.id, suggestionId))
    .returning({ id: aiSuggestion.id });
  return rows.length;
}
