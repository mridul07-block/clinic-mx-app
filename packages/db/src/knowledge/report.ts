import {
  activityTagVocabulary,
  activityTags,
  knowledgeRegions,
  redFlagTierLabels,
  redFlagTiers,
  type KnowledgeRegion,
} from '@clinic-mx/schemas';
import { baseName, type BuiltKnowledge, type Listing } from './build';
import { mapColumns } from './columns';
import type { Workbook } from './workbook';

/**
 * The import report (SET-05): what was imported and what a clinician should check, for the
 * client's knowledge base clean up (OPS-02) and the Super Admin's approval (SET-06). Built only
 * from the workbooks and the build, so the same files give the same report.
 */

interface Named {
  conditionId: string;
  region: KnowledgeRegion;
  name: string;
}

export interface ImportReport {
  files: {
    region: KnowledgeRegion;
    fileName: string;
    sha256: string;
    title: string;
    rows: number;
    /** The count the sheet's title states, when it states one. */
    titleCount: number | null;
  }[];
  totals: { listings: number; conditions: number; merged: number };
  merged: { conditionId: string; listings: { region: KnowledgeRegion; name: string }[] }[];
  lookAlikes: { similarity: number; a: Named; b: Named }[];
  copiedText: { column: string; text: string; listings: Named[] }[];
  ages: (Named & { text: string; min: number | null; max: number | null })[];
  onsetNotes: (Named & { text: string })[];
  redFlagTiers: Record<string, number>;
  conditional: (Named & { text: string })[];
  riskClasses: Record<string, number>;
  tags: Record<string, number>;
  untagged: (Named & { text: string })[];
  synonyms: { conditionId: string; name: string; synonyms: string[] }[];
  columns: Record<string, { label: string; key: string }[]>;
  assigned: number;
  unmatched: { key: string; conditionId: string }[];
  gaps: string[];
}

const named = (l: Listing): Named => ({
  conditionId: l.conditionId,
  region: l.region,
  name: l.name,
});

const stopWords = new Set([
  'the',
  'of',
  'and',
  'a',
  'at',
  'in',
  'to',
  'or',
  'with',
  'syndrome',
  'pain',
  'injury',
  'tear',
  'acute',
  'chronic',
]);
const words = (name: string) =>
  new Set(
    baseName(name)
      .split(' ')
      .filter((word) => word && !stopWords.has(word)),
  );

/** Share of distinct words two names have in common (Jaccard), ignoring filler words. */
export function nameSimilarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  const shared = [...x].filter((word) => y.has(word)).length;
  const all = x.size + y.size - shared;
  return all === 0 ? 0 : shared / all;
}

/** Names at least this similar, in different workbooks and not merged, are listed to confirm. */
export const LOOK_ALIKE_SIMILARITY = 0.5;
/** Identical text at least this long under two different conditions is listed as copied. */
export const COPIED_TEXT_LENGTH = 80;

const count = <T>(items: T[], key: (item: T) => string) => {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
};

export function buildReport(workbooks: Workbook[], built: BuiltKnowledge): ImportReport {
  const { listings, conditions } = built;
  const byCondition = new Map<string, Listing[]>();
  for (const listing of listings) {
    byCondition.set(listing.conditionId, [
      ...(byCondition.get(listing.conditionId) ?? []),
      listing,
    ]);
  }
  const merged = conditions
    .filter((c) => (byCondition.get(c.conditionId)?.length ?? 0) > 1)
    .map((c) => ({
      conditionId: c.conditionId,
      listings: (byCondition.get(c.conditionId) ?? []).map((l) => ({
        region: l.region,
        name: l.name,
      })),
    }));

  const lookAlikes: ImportReport['lookAlikes'] = [];
  listings.forEach((a, i) => {
    for (const b of listings.slice(i + 1)) {
      if (a.region === b.region || a.conditionId === b.conditionId) continue;
      const similarity = nameSimilarity(a.name, b.name);
      if (similarity >= LOOK_ALIKE_SIMILARITY) {
        lookAlikes.push({
          similarity: Math.round(similarity * 100) / 100,
          a: named(a),
          b: named(b),
        });
      }
    }
  });
  lookAlikes.sort(
    (x, y) => y.similarity - x.similarity || x.a.conditionId.localeCompare(y.a.conditionId),
  );

  const texts = new Map<string, { column: string; text: string; listings: Named[] }>();
  for (const listing of listings) {
    const fields: [string, string | null][] = [
      ['Symptoms', listing.symptoms],
      ['Discriminating question', listing.discriminatingQuestion],
      ['Tests and imaging', listing.testsImaging],
      ['Biomechanical cause', listing.biomechanicalCause],
      ['Red flag status', listing.redFlagText],
      ...Object.values(listing.details).map(({ label, text }) => [label, text] as [string, string]),
    ];
    for (const [column, text] of fields) {
      if (!text || text.length < COPIED_TEXT_LENGTH) continue;
      const entry = texts.get(text) ?? { column, text, listings: [] };
      entry.listings.push(named(listing));
      texts.set(text, entry);
    }
  }
  const copiedText = [...texts.values()]
    .filter((entry) => new Set(entry.listings.map((l) => l.conditionId)).size > 1)
    .sort(
      (x, y) =>
        (x.listings[0]?.conditionId ?? '').localeCompare(y.listings[0]?.conditionId ?? '') ||
        x.column.localeCompare(y.column),
    );

  const tagCounts = Object.fromEntries(
    activityTags.map((tag) => [tag, listings.filter((l) => l.activityTags.includes(tag)).length]),
  );
  const tierCounts = Object.fromEntries(
    redFlagTiers.map((tier) => [tier, listings.filter((l) => l.redFlagTier === tier).length]),
  );

  return {
    files: workbooks.map((w) => {
      const stated = /(\d+)\s+[A-Z&,' ]*CONDITIONS/i.exec(w.title);
      return {
        region: w.region,
        fileName: w.fileName,
        sha256: w.sha256,
        title: w.title,
        rows: w.rows.length,
        titleCount: stated ? Number(stated[1]) : null,
      };
    }),
    totals: { listings: listings.length, conditions: conditions.length, merged: merged.length },
    merged,
    lookAlikes,
    copiedText,
    ages: listings
      .filter((l) => !l.agePlain)
      .map((l) => ({ ...named(l), text: l.ageText ?? '', min: l.ageMin, max: l.ageMax })),
    onsetNotes: listings
      .filter((l) => l.onsetText && /\s/.test(l.onsetText.replace(/\s*\/\s*/g, '/')))
      .map((l) => ({ ...named(l), text: l.onsetText ?? '' })),
    redFlagTiers: tierCounts,
    conditional: listings
      .filter((l) => l.redFlagTier === 'conditional')
      .map((l) => ({ ...named(l), text: l.redFlagText ?? '' })),
    riskClasses: count(
      listings.filter((l) => l.riskClass),
      (l) => l.riskClass ?? '',
    ),
    tags: tagCounts,
    untagged: listings
      .filter((l) => l.activityTags.length === 0)
      .map((l) => ({ ...named(l), text: l.activityText ?? '' })),
    synonyms: conditions
      .filter((c) => c.synonyms.length > 0)
      .map((c) => ({ conditionId: c.conditionId, name: c.name, synonyms: c.synonyms })),
    columns: Object.fromEntries(
      workbooks.map((w) => {
        const map = mapColumns(w.region, w.header);
        return [w.region, map.labels.map((label, i) => ({ label, key: map.keys[i] as string }))];
      }),
    ),
    assigned: built.assigned.length,
    unmatched: built.unmatched,
    gaps: [
      'Thoracic spine: no workbook yet; its conditions are missing (client clean up, OPS-02).',
    ],
  };
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const where = (n: Named) =>
  `${n.conditionId} ${cell(n.name)} (${knowledgeRegions[n.region].label})`;
const table = (head: string[], rows: string[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
const range = (min: number | null, max: number | null) =>
  min === null && max === null ? 'any age' : `${min ?? 'any'} to ${max ?? 'any'}`;

/** The report as Markdown, committed at `docs/knowledge-base/import-report.md`. */
export function reportMarkdown(report: ImportReport): string {
  const sections: string[] = [
    '# Knowledge base import report',
    'Generated by `pnpm kb:import` (SET-05) from the nine workbooks in `docs/Joint wise AI Training/`; ' +
      'do not edit by hand. How the import reads each column, and how to act on this report: ' +
      '`docs/runbooks/knowledge-base.md`.',
    `**${report.totals.listings} workbook rows, ${report.totals.conditions} conditions** ` +
      `(${report.totals.merged} conditions are described in two workbooks and share one ID).`,
    '## Workbooks',
    table(
      ['Workbook', 'Rows imported', 'Title says', 'SHA-256 (first 12)'],
      report.files.map((f) => [
        f.fileName,
        String(f.rows),
        f.titleCount === null
          ? 'no count (title blank or without one)'
          : f.titleCount === f.rows
            ? String(f.titleCount)
            : `${f.titleCount} (differs: check the sheet)`,
        f.sha256.slice(0, 12),
      ]),
    ),
    '## Gaps',
    report.gaps.map((gap) => `- ${gap}`).join('\n'),
    '## Merged: one condition, two workbooks',
    'Same name in two workbooks (brackets ignored). Each workbook keeps its own text as a listing ' +
      'under the shared ID.',
    table(
      ['ID', 'Listings'],
      report.merged.map((m) => [
        m.conditionId,
        m.listings.map((l) => `${l.name} (${knowledgeRegions[l.region].label})`).join('; '),
      ]),
    ),
    '## Look-alikes to confirm (not merged)',
    `Names at least ${LOOK_ALIKE_SIMILARITY * 100}% alike in different workbooks. Many are different ` +
      'conditions (septic arthritis of different joints); a clinician decides. To merge a pair, ' +
      'give both rows the same ID in `packages/db/src/knowledge/condition-ids.json`.',
    table(
      ['Alike', 'First', 'Second'],
      report.lookAlikes.map((p) => [`${Math.round(p.similarity * 100)}%`, where(p.a), where(p.b)]),
    ),
    '## Copied text',
    `Identical text of ${COPIED_TEXT_LENGTH} characters or more under different conditions: ` +
      'possibly copied by mistake (OPS-02), or rightly shared.',
    table(
      ['Column', 'Text starts', 'Where'],
      report.copiedText.map((c) => [
        c.column,
        `${c.text.slice(0, 70)}…`,
        c.listings.map(where).join('; '),
      ]),
    ),
    '## Red flag tiers',
    'From the Red Flag Status wording: "No" none, "Screen: …" screen, "YES if/for …" conditional, ' +
      '"YES …" red flag. The Bone Stress workbook has no such column (not stated); its Risk Class ' +
      'is kept separately.',
    table(
      ['Tier', 'Rows'],
      redFlagTiers.map((tier) => [redFlagTierLabels[tier], String(report.redFlagTiers[tier] ?? 0)]),
    ),
    '### Conditional red flags',
    table(
      ['Condition', 'Red flag status'],
      report.conditional.map((c) => [where(c), c.text]),
    ),
    '### Bone Stress risk classes',
    table(
      ['Risk class', 'Rows'],
      Object.entries(report.riskClasses)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([riskClass, n]) => [riskClass, String(n)]),
    ),
    '## Ages read as more than a plain range',
    'Read so the shortlist never leaves a condition out: alternatives become the range covering ' +
      'both; "also …" and "Any …" become any age; "Under 45" is up to 44.',
    table(
      ['Condition', 'Workbook says', 'Read as'],
      report.ages.map((a) => [where(a), a.text, range(a.min, a.max)]),
    ),
    '## Onsets with a note',
    table(
      ['Condition', 'Workbook says'],
      report.onsetNotes.map((o) => [where(o), o.text]),
    ),
    '## Activity tags',
    'Matched by keywords from the vocabulary in `packages/schemas/src/knowledge.ts`.',
    table(
      ['Tag', 'Rows'],
      activityTags.map((tag) => [activityTagVocabulary[tag].label, String(report.tags[tag] ?? 0)]),
    ),
    '### Rows with no activity tag',
    table(
      ['Condition', 'Activity text'],
      report.untagged.map((u) => [where(u), u.text]),
    ),
    '## Synonyms (from the names’ brackets)',
    table(
      ['ID', 'Condition', 'Synonyms'],
      report.synonyms.map((s) => [s.conditionId, s.name, s.synonyms.join('; ')]),
    ),
    '## Columns read',
    ...Object.entries(report.columns).map(
      ([region, columns]) =>
        `**${knowledgeRegions[region as KnowledgeRegion].label}:** ` +
        columns.map((c) => `${cell(c.label)} → \`${c.key}\``).join(' · '),
    ),
    '## Condition IDs',
    `${report.assigned} new IDs assigned in this run; ` +
      (report.unmatched.length === 0
        ? 'every ID in the file matched a row.'
        : `${report.unmatched.length} IDs in the file matched no row (renamed or removed):`),
  ];
  if (report.unmatched.length > 0) {
    sections.push(
      table(
        ['ID', 'Row in the ID file'],
        report.unmatched.map((u) => [u.conditionId, u.key]),
      ),
    );
  }
  return `${sections.join('\n\n')}\n`;
}
