import {
  activityTags,
  knowledgeRegions,
  readAge,
  readOnset,
  readSex,
  redFlagTier,
  subregionName,
  synonymsOf,
  tagsIn,
  type ActivityTag,
  type KnowledgeRegion,
  type Onset,
  type RedFlagTier,
  type SexPredominance,
} from '@clinic-mx/schemas';
import { mapColumns, typedKeys, type ColumnKey } from './columns';
import type { Workbook } from './workbook';

/**
 * Turns the workbooks' rows into the knowledge base (SET-05): one listing per row, read into the
 * fields the shortlist filters on, and one condition per stable ID. IDs come from the committed ID
 * file (`condition-ids.json`, `region|name as written` to ID). A row the file does not know stops
 * the import unless IDs are being assigned; then a row whose name, without brackets, matches a
 * condition already named in another workbook joins it (decision 22 October 2026: same-name pairs
 * are merged), and any other row gets the next ID of its workbook. Readings that fail stop the
 * import too, so nothing unread reaches the shortlist.
 */

export interface Listing {
  conditionId: string;
  region: KnowledgeRegion;
  rowNumber: number;
  name: string;
  subregion: string;
  ageMin: number | null;
  ageMax: number | null;
  ageText: string | null;
  /** False when the age was more than a plain range; the report lists these. */
  agePlain: boolean;
  onsets: Onset[];
  onsetText: string | null;
  sex: SexPredominance | null;
  sexText: string | null;
  activityTags: ActivityTag[];
  activityText: string | null;
  redFlagTier: RedFlagTier;
  redFlagText: string | null;
  riskClass: string | null;
  symptoms: string | null;
  discriminatingQuestion: string | null;
  testsImaging: string | null;
  biomechanicalCause: string | null;
  details: Record<string, { label: string; text: string }>;
}

export interface Condition {
  conditionId: string;
  /** The name in the workbook whose prefix the ID carries. */
  name: string;
  synonyms: string[];
  homeRegion: KnowledgeRegion;
}

export type ConditionIds = Record<string, string>;

export interface BuiltKnowledge {
  conditions: Condition[];
  listings: Listing[];
  /** The ID file after this build, with any IDs assigned. */
  ids: ConditionIds;
  /** Rows given a new ID in this build. */
  assigned: { key: string; conditionId: string }[];
  /** ID file entries no row matched: renamed or removed rows. */
  unmatched: { key: string; conditionId: string }[];
}

/** One problem per cell or row that stopped the import. */
export class KnowledgeImportError extends Error {
  override name = 'KnowledgeImportError';
  constructor(readonly problems: string[]) {
    super(`The knowledge base was not imported:\n- ${problems.join('\n- ')}`);
  }
}

export const listingKey = (region: KnowledgeRegion, name: string) => `${region}|${name}`;

/** A name compared for same-name merging: lower case, no brackets, letters and digits only. */
export const baseName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const prefixRegion = new Map<string, KnowledgeRegion>(
  Object.entries(knowledgeRegions).map(([region, { prefix }]) => [
    prefix,
    region as KnowledgeRegion,
  ]),
);

export function buildKnowledge(
  workbooks: Workbook[],
  idFile: ConditionIds,
  { assign = false }: { assign?: boolean } = {},
): BuiltKnowledge {
  const problems: string[] = [];
  const ids: ConditionIds = { ...idFile };
  const assigned: BuiltKnowledge['assigned'] = [];
  const listings: Listing[] = [];
  const seenKeys = new Set<string>();

  const next = new Map<string, number>();
  for (const id of Object.values(ids)) {
    const [prefix = '', number = '0'] = id.split('-');
    next.set(prefix, Math.max(next.get(prefix) ?? 0, Number(number)));
  }
  // Same-name merging joins a condition named in another workbook, never one in the same.
  const idForBaseName = new Map<string, { conditionId: string; region: string }>();
  for (const [key, conditionId] of Object.entries(ids)) {
    const region = key.slice(0, key.indexOf('|'));
    idForBaseName.set(baseName(key.slice(key.indexOf('|') + 1)), { conditionId, region });
  }

  for (const workbook of workbooks) {
    let columns;
    try {
      columns = mapColumns(workbook.region, workbook.header);
    } catch (error) {
      problems.push((error as Error).message);
      continue;
    }
    const where = (row: number) => `${workbook.fileName}, row ${row}`;
    for (const { rowNumber, cells } of workbook.rows) {
      const cell = (key: ColumnKey) => {
        const index = columns.keys.indexOf(key);
        return index < 0 ? '' : (cells[index] ?? '');
      };
      const orNull = (key: ColumnKey) => cell(key) || null;
      const name = cell('name');
      if (!name) {
        problems.push(`${where(rowNumber)}: no condition name`);
        continue;
      }
      const key = listingKey(workbook.region, name);
      if (seenKeys.has(key)) {
        problems.push(`${where(rowNumber)}: "${name}" is listed twice in this workbook`);
        continue;
      }
      seenKeys.add(key);

      let conditionId = ids[key];
      if (!conditionId && assign) {
        const prefix = knowledgeRegions[workbook.region].prefix;
        const named = idForBaseName.get(baseName(name));
        if (named && named.region !== workbook.region) conditionId = named.conditionId;
        else {
          const number = (next.get(prefix) ?? 0) + 1;
          next.set(prefix, number);
          conditionId = `${prefix}-${String(number).padStart(3, '0')}`;
        }
        ids[key] = conditionId;
        if (!named) idForBaseName.set(baseName(name), { conditionId, region: workbook.region });
        assigned.push({ key, conditionId });
      }
      if (!conditionId) {
        problems.push(
          `${where(rowNumber)}: "${name}" has no condition ID (renamed or new? see docs/runbooks/knowledge-base.md)`,
        );
        continue;
      }

      const bone = workbook.region === 'bone_stress';
      const age = bone ? null : readAge(cell('age'));
      const onset = bone ? null : readOnset(cell('onset'));
      const sex = bone ? null : readSex(cell('sex'));
      const tier = bone ? 'not_stated' : redFlagTier(cell('red_flag'));
      if (!bone) {
        if (!age) problems.push(`${where(rowNumber)}: age "${cell('age')}" cannot be read`);
        if (!onset) problems.push(`${where(rowNumber)}: onset "${cell('onset')}" cannot be read`);
        if (!sex) problems.push(`${where(rowNumber)}: sex "${cell('sex')}" cannot be read`);
      }
      if (!tier) {
        problems.push(`${where(rowNumber)}: red flag status "${cell('red_flag')}" cannot be read`);
      }
      if (!bone && (!age || !onset || !sex)) continue;
      if (!tier) continue;

      const activityText = [cell('activity'), cell('athlete_profile')].filter(Boolean).join('\n');
      const found = new Set<ActivityTag>(tagsIn(activityText));
      if (sex?.athlete) found.add('athlete');
      const details: Listing['details'] = {};
      columns.keys.forEach((columnKey, index) => {
        const text = cells[index] ?? '';
        if (!typedKeys.has(columnKey) && text) {
          details[columnKey] = { label: columns.labels[index] ?? columnKey, text };
        }
      });

      listings.push({
        conditionId,
        region: workbook.region,
        rowNumber,
        name,
        subregion: subregionName(cell('subregion')),
        ageMin: age?.min ?? null,
        ageMax: age?.max ?? null,
        ageText: orNull('age'),
        agePlain: age?.plain ?? true,
        onsets: onset?.onsets ?? [],
        onsetText: orNull('onset'),
        sex: sex?.sex ?? null,
        sexText: orNull('sex'),
        activityTags: activityTags.filter((tag) => found.has(tag)),
        activityText: orNull('activity'),
        redFlagTier: tier,
        redFlagText: orNull('red_flag'),
        riskClass: orNull('risk_class'),
        symptoms: orNull('symptoms'),
        discriminatingQuestion: orNull('question'),
        testsImaging: orNull('tests_imaging'),
        biomechanicalCause: orNull('biomechanical_cause'),
        details,
      });
    }
  }

  const perRegion = new Map<string, string>();
  for (const listing of listings) {
    const key = `${listing.region}|${listing.conditionId}`;
    const other = perRegion.get(key);
    if (other) {
      problems.push(
        `${listing.region}: "${other}" and "${listing.name}" share ${listing.conditionId} in one workbook`,
      );
    }
    perRegion.set(key, listing.name);
  }
  if (problems.length > 0) throw new KnowledgeImportError(problems);

  const conditions = [...new Set(listings.map((l) => l.conditionId))].sort().map((conditionId) => {
    const own = listings.filter((l) => l.conditionId === conditionId);
    const homeRegion = prefixRegion.get(conditionId.slice(0, 3)) as KnowledgeRegion;
    const home = own.find((l) => l.region === homeRegion) ?? own[0];
    if (!home) throw new Error(`No listing for ${conditionId}.`);
    return {
      conditionId,
      name: home.name,
      synonyms: [...new Set(own.flatMap((l) => synonymsOf(l.name)))],
      homeRegion,
    };
  });
  const unmatched = Object.entries(ids)
    .filter(([key]) => !seenKeys.has(key))
    .map(([key, conditionId]) => ({ key, conditionId }));
  return { conditions, listings, ids: sortIds(ids), assigned, unmatched };
}

/** The ID file in a stable order: by ID, then by key, so merged rows sit together. */
export function sortIds(ids: ConditionIds): ConditionIds {
  return Object.fromEntries(
    Object.entries(ids).sort(([ka, a], [kb, b]) => a.localeCompare(b) || ka.localeCompare(kb)),
  );
}
