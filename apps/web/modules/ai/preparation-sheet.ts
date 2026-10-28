import 'server-only';
import type { Db } from '@clinic-mx/db';
import { aiSheetPass } from './gate';

/**
 * The AI preparation sheet job (INT-10 queues it when a health form is submitted). It checks the
 * AI gate first (AI-09): while the sheet is off it does nothing, and the episode never gets a
 * sheet (no backfill once switched on). While on, the sheet is made by AI-01 to AI-03, which
 * take the pass; until then nothing more happens. Safe to run twice.
 */
export async function runPreparationSheet(
  db: Db,
  // The episode the sheet is for, used by AI-02 and AI-03.
  _episodeId: string,
): Promise<'off' | 'waiting_for_ai_03'> {
  const pass = await aiSheetPass(db);
  if (!pass) return 'off';
  // AI-01 to AI-03: build the candidates and the sheet for the episode with `pass`.
  return 'waiting_for_ai_03';
}
