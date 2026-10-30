import 'server-only';
import {
  claimSheet,
  episodeNameWords,
  finishSheet,
  sheetStatus,
  type Db,
  type KnowledgeListing,
} from '@clinic-mx/db';
import {
  aiCaseFrom,
  validateRanking,
  type AiCase,
  type AiSheetUnavailableReason,
  type Shortlist,
  type ValidatedSuggestion,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { buildCandidates } from './candidates';
import { findSimilarCases } from './similar-cases';
import { aiSheetPass } from './gate';
import { rankDiagnoses, type ShortlistRow } from './gateway';
import type { AiTransport } from './gateway/transport';

/**
 * The AI preparation sheet (AI-03; PRD section 6 steps 3 to 6; TAD section 7 steps 5 to 7). Made
 * when a health form is submitted: straight after the submit, and by its queued job as the retry.
 * It checks the AI gate first (AI-09) and does nothing while the sheet is off. Then it builds the
 * shortlist (AI-02), takes the sheet so no other run pays for a model call, asks the model to rank
 * it (AI-01), validates the ranking (unknown and repeated rows dropped, decision 3's count kept)
 * and stores the suggestions. Must rule out stays on the sheet by rule, whatever the model says.
 * Never throws for the model: a sheet without suggestions is unavailable, with why.
 */
export type SheetOutcome = 'off' | 'already' | 'busy' | 'ready' | 'unavailable' | 'superseded';

const claim = systemService({
  component: 'ai',
  input: z.custom<Parameters<typeof claimSheet>[1]>(),
  run: (tx, sheet) => claimSheet(tx, sheet),
});

const finish = systemService({
  component: 'ai',
  input: z.custom<{
    claim: Parameters<typeof finishSheet>[1];
    result: Parameters<typeof finishSheet>[2];
  }>(),
  run: (tx, { claim, result }) => finishSheet(tx, claim, result),
});

const clip = (text: string | null, max: number) => (text === null ? null : text.slice(0, max));

/** The shortlist rows as the model reads them: the knowledge base's own words, numbered by place. */
export function rowsFor(
  shortlist: Shortlist,
  listings: readonly KnowledgeListing[],
): ShortlistRow[] {
  return shortlist.items.flatMap((item) => {
    const listing = listings.find(
      (l) =>
        l.conditionId === item.conditionId &&
        l.region === item.region &&
        l.rowNumber === item.rowNumber,
    );
    if (!listing) return [];
    return [
      {
        conditionId: item.conditionId,
        name: listing.name.slice(0, 200),
        mustRuleOut: item.mustRuleOut,
        age: clip(listing.ageText, 200),
        onset: clip(listing.onsetText, 200),
        sex: clip(listing.sexText, 200),
        symptoms: clip(listing.symptoms, 2000),
      },
    ];
  });
}

export async function runPreparationSheet(
  db: Db,
  episodeId: string,
  options: { transport?: AiTransport | null } = {},
): Promise<SheetOutcome> {
  const pass = await aiSheetPass(db);
  if (!pass) return 'off';
  const built = await buildCandidates(db, pass, episodeId);
  const shortlist: Shortlist = built?.shortlist ?? {
    status: 'no_region',
    knowledgeRegion: null,
    items: [],
    candidateCount: 0,
    gaps: [],
  };
  const sent: AiCase | null = built ? aiCaseFrom(built.case, built.answers) : null;
  // Rows are numbered by their place in this list, which is the shortlist's own order.
  const rows = built ? rowsFor(shortlist, built.listings) : [];
  const forbidden = await episodeNameWords(db, episodeId);
  // AI-05: chosen before the claim, so the sheet keeps exactly what was sent.
  const similar =
    built && sent
      ? await findSimilarCases(
          db,
          { episodeId, patientId: built.patientId, case: built.case },
          rows,
          forbidden,
        )
      : [];
  const claimed = await claim(db, {
    episodeId,
    kbVersionId: pass.kbVersionId,
    shortlist,
    case: sent,
    similar,
    retryAfterSeconds: await getSetting('ai.sheet_retry_after_seconds'),
  });
  // Taken: made already, or being made by another run (`busy`: the job tries again later).
  if (!claimed) return (await sheetStatus(db, episodeId)) === 'pending' ? 'busy' : 'already';

  const unavailable = async (
    reason: AiSheetUnavailableReason,
    aiRunId: string | null = null,
  ): Promise<SheetOutcome> =>
    (await finish(db, { claim: claimed, result: { status: 'unavailable', reason, aiRunId } }))
      ? 'unavailable'
      : 'superseded';
  if (!built) return unavailable('no_form');
  if (!sent || shortlist.status === 'no_region') return unavailable('no_region');

  const items = shortlist.items.filter((item) =>
    rows.some((row) => row.conditionId === item.conditionId),
  );
  const counts = {
    top: await getSetting('ai.sheet_top_count'),
    alsoConsider: await getSetting('ai.sheet_also_consider_count'),
  };
  const result = await rankDiagnoses(db, pass, {
    case: sent,
    rows,
    similar,
    limit: counts.top + counts.alsoConsider,
    episodeId,
    forbidden,
    transport: options.transport,
  });
  if (result.status !== 'ok') return unavailable(result.reason, result.runId);

  const suggestions: ValidatedSuggestion[] = validateRanking(items, result.output, counts);
  if (suggestions.length === 0) return unavailable('no_valid_suggestions', result.runId);
  const done = await finish(db, {
    claim: claimed,
    result: { status: 'ready', aiRunId: result.runId, suggestions },
  });
  return done ? 'ready' : 'superseded';
}
