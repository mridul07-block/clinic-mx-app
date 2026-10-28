import 'server-only';
import type { Db } from '@clinic-mx/db';
import { buildCandidates } from './candidates';
import { aiSheetPass } from './gate';

/**
 * The AI preparation sheet job (INT-10 queues it when a health form is submitted). It checks the
 * AI gate first (AI-09): while the sheet is off it does nothing, and the episode never gets a
 * sheet (no backfill once switched on). While on, it builds the shortlist (AI-02); AI-01 and
 * AI-03 then rank it with the model and store the sheet. Safe to run twice: nothing is stored yet.
 */
export async function runPreparationSheet(
  db: Db,
  episodeId: string,
): Promise<'off' | 'waiting_for_ai_03'> {
  const pass = await aiSheetPass(db);
  if (!pass) return 'off';
  // AI-01 and AI-03: send the shortlist and the case to the model, validate and store the sheet.
  await buildCandidates(db, pass, episodeId);
  return 'waiting_for_ai_03';
}
