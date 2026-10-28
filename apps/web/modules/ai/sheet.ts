import 'server-only';
import {
  canDisposeSheet,
  episodeRecord,
  openRedFlagAlerts,
  patientRecord,
  setDisposition,
  sheetForEpisode,
  sheetListings,
  suggestionTarget,
  type PreparationSheet,
  type RedFlagAlertEntry,
  type SheetListing,
  type StaffMember,
} from '@clinic-mx/db';
import { aiDispositionSchema, can } from '@clinic-mx/schemas';
import { settingsDb } from '../../lib/db';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { aiSheetPass } from './gate';

/**
 * Reading the AI preparation sheet and keeping or dismissing its suggestions (AI-03; PRD section
 * 6: "The physio keeps or dismisses each suggestion; nothing enters the record until the physio
 * confirms it"). Consultants (Consultant tick) read a sheet at a centre they see, while the AI gate
 * is on; the visit's consultant keeps or dismisses, until a consultation on the episode is signed.
 * Row level security holds the same. A disposition never writes into the record.
 */

/** A refusal to show the consultant as it is. */
export class AiSheetError extends Error {
  override name = 'AiSheetError';
}

export const recordDisposition = staffService({
  action: 'ai_prep.use',
  input: aiDispositionSchema,
  target: async (input, tx) => {
    const found = await suggestionTarget(tx, input.suggestionId);
    if (!found) throw new AiSheetError('That suggestion was not found.');
    return { centreId: found.centreId };
  },
  run: async (tx, input, actor) => {
    if (!(await aiSheetPass(settingsDb()))) {
      throw new AiSheetError('The AI preparation sheet is switched off.');
    }
    const found = await suggestionTarget(tx, input.suggestionId);
    if (!found || !(await canDisposeSheet(tx, found.sheetId))) {
      throw new AiSheetError(
        'Only the consultant of the visit keeps or dismisses suggestions, until the consultation is signed.',
      );
    }
    if ((await setDisposition(tx, input.suggestionId, input.disposition, actor.id)) === 0) {
      throw new AiSheetError('The sheet changed meanwhile. Reload and try again.');
    }
  },
});

export interface PreparationSheetView {
  sheet: PreparationSheet;
  patientName: string;
  bodyRegion: string | null;
  /** The knowledge base's own words for every row on the sheet, by `listingKey` (condition, region, row). */
  listings: Record<string, SheetListing>;
  alerts: RedFlagAlertEntry[];
  canDispose: boolean;
}

/** The sheet for a consultant; null while the AI gate is off or before a sheet is made. */
export async function loadPreparationSheet(
  actor: StaffMember,
  episodeId: string,
): Promise<PreparationSheetView | null> {
  if (!can(actor, 'ai_prep.use')) throw new NotAllowedError();
  if (!(await aiSheetPass(settingsDb()))) return null;
  return asStaff(actor, async (tx) => {
    const sheet = await sheetForEpisode(tx, episodeId);
    const episode = await episodeRecord(tx, episodeId);
    if (!sheet || !episode) return null;
    const rechecked = sheet.recheck?.suggestions ?? [];
    const ids = [
      ...sheet.suggestions.map((s) => s.conditionId),
      ...rechecked.map((s) => s.conditionId),
      ...sheet.shortlist.items.filter((i) => i.mustRuleOut).map((i) => i.conditionId),
    ];
    const rows = await sheetListings(tx, sheet.kbVersionId, ids);
    const listings: Record<string, SheetListing> = {};
    for (const row of rows) {
      const wanted = [...sheet.suggestions, ...rechecked, ...sheet.shortlist.items].some(
        (s) =>
          s.conditionId === row.conditionId &&
          s.region === row.region &&
          s.rowNumber === row.rowNumber,
      );
      if (wanted) listings[`${row.conditionId}:${row.region}:${String(row.rowNumber)}`] = row;
    }
    return {
      sheet,
      patientName: (await patientRecord(tx, episode.patientId))?.name ?? '',
      bodyRegion: episode.bodyRegion,
      listings,
      alerts: (await openRedFlagAlerts(tx)).filter((alert) => alert.episodeId === episodeId),
      canDispose: !actor.support && (await canDisposeSheet(tx, sheet.id)),
    };
  });
}

/** The key a row's words are kept under in `listings`. */
export const listingKey = (row: { conditionId: string; region: string; rowNumber: number }) =>
  `${row.conditionId}:${row.region}:${String(row.rowNumber)}`;
