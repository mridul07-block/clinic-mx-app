import 'server-only';
import { episodeCandidateInput, knowledgeListings, type DbOrTransaction } from '@clinic-mx/db';
import {
  candidateCase,
  istDate,
  shortlistCandidates,
  type CandidateCase,
  type Shortlist,
} from '@clinic-mx/schemas';
import { getSetting } from '../settings/settings';
import type { AiSheetPass } from './gate';

/**
 * The preparation sheet's shortlist for an episode (AI-02): its health form's case filtered over
 * the knowledge base version the AI gate was switched on for, never another. Takes the gate's pass,
 * so it runs only while the sheet is on (AI-09). Nothing is stored here: AI-03 stores the
 * shortlist with the model's ranking (`ai_run`), and the recheck reuses it (AI-04).
 */
export async function buildCandidates(
  db: DbOrTransaction,
  pass: AiSheetPass,
  episodeId: string,
  now = new Date(),
): Promise<{ kbVersionId: string; case: CandidateCase; shortlist: Shortlist } | null> {
  const input = await episodeCandidateInput(db, episodeId);
  if (!input) return null;
  const c = candidateCase(input.answers, input, istDate(now));
  const shortlist = shortlistCandidates(await knowledgeListings(db, pass.kbVersionId), c, {
    min: await getSetting('ai.candidates_min'),
    max: await getSetting('ai.candidates_max'),
    mustRuleOutTiers: await getSetting('ai.must_rule_out_tiers'),
  });
  return { kbVersionId: pass.kbVersionId, case: c, shortlist };
}
