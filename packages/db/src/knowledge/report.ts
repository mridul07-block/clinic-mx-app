import {
  activityTagVocabulary,
  activityTags,
  knowledgeRegions,
  precautionLabels,
  redFlagTierLabels,
  redFlagTiers,
  redFlagTriageLabels,
  screeningRegionLabels,
  triggerText,
  type KnowledgeRegion,
  type ReadinessRule,
  type RedFlagTriage,
} from '@clinic-mx/schemas';
import { baseName, type BuiltKnowledge, type Listing } from './build';
import { mapColumns } from './columns';
import type { BuiltCategories } from './categories';
import type { BuiltObjective } from './objective';
import type { BuiltPlanCatalog } from './plan-catalog';
import type { RedFlags } from './red-flags';
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
  /** The red flag rules file (SET-10), part of the version's source. */
  rulesFile: { name: string; sha256: string };
  redFlagRules: {
    key: string;
    name: string;
    where: string;
    triage: RedFlagTriage;
    raisedWhen: string;
    action: string;
    source: string;
    signedOff: boolean;
  }[];
  /** Per workbook region: presentations and screening notes from its Red Flags sheet. */
  redFlagPresentations: Record<string, { presentations: number; notes: number }>;
  /** CLN-05: per workbook region, measures by kind and special tests; what was not a measure. */
  objective: {
    regions: Record<string, Record<string, number>>;
    skipped: { region: KnowledgeRegion; rowNumber: number; text: string; why: 'section' | 'row' }[];
  };
  /** OUT-08: each region's readiness criteria, in the workbook's order. */
  readiness: {
    region: KnowledgeRegion;
    rowNumber: number;
    text: string;
    judged: string;
  }[];
  /** OUT-04 with SET-09: each region's phases with their exit criteria, word for word. */
  phases: {
    region: KnowledgeRegion;
    number: number;
    name: string;
    criteria: string[];
    painLimit: string[];
  }[];
  /** CLN-06: the client's diagnosis categories file and how many conditions it maps. */
  categories: {
    file: { name: string; sha256: string };
    names: string[];
    mapped: number;
  };
  /** CLN-07: the plan catalog file, its modalities' precaution links and its questionnaires. */
  planCatalog: {
    file: { name: string; sha256: string };
    modalities: { name: string; precautions: string[]; signedOff: boolean }[];
    questionnaires: { name: string; regions: string; useFor: string }[];
  };
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

/** How a readiness criterion is judged, as the report words it. */
function judgedBy(rule: ReadinessRule, fromVerdict: boolean): string {
  const how =
    rule.kind === 'measure'
      ? 'The measure’s rule'
      : rule.kind === 'target'
        ? `Reaches ${String(rule.target)}`
        : rule.kind === 'mcid'
          ? `Improves by ${String(rule.mcid)} (MCID)`
          : rule.kind === 'none_positive'
            ? 'Consultant: none positive'
            : 'Consultant: yes';
  return fromVerdict ? `${how}; from the overall verdict` : how;
}

export function buildReport(
  workbooks: Workbook[],
  built: BuiltKnowledge,
  redFlags: RedFlags,
  objective: BuiltObjective,
  categories: BuiltCategories,
  planCatalog: BuiltPlanCatalog,
): ImportReport {
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
    rulesFile: redFlags.rulesFile,
    redFlagRules: redFlags.rules.map((rule) => ({
      key: rule.key,
      name: rule.name,
      where:
        rule.regions.length === 0
          ? 'Everywhere'
          : rule.regions.map((r) => screeningRegionLabels[r]).join(', '),
      triage: rule.triage,
      raisedWhen: triggerText(rule.trigger),
      action: rule.action,
      source: rule.source,
      signedOff: rule.signedOff,
    })),
    redFlagPresentations: Object.fromEntries(
      workbooks.map((w) => {
        const own = redFlags.presentations.filter((p) => p.region === w.region);
        return [
          w.region,
          {
            presentations: own.filter((p) => p.kind === 'presentation').length,
            notes: own.filter((p) => p.kind === 'screening_note').length,
          },
        ];
      }),
    ),
    objective: {
      regions: Object.fromEntries(
        workbooks.map((w) => [
          w.region,
          {
            ...count(
              objective.measures.filter((m) => m.region === w.region),
              (m) => m.kind,
            ),
            tests: objective.specialTests.filter((t) => t.region === w.region).length,
          },
        ]),
      ),
      skipped: objective.skipped,
    },
    readiness: objective.readiness.map((c) => ({
      region: c.region,
      rowNumber: c.rowNumber,
      text: c.text,
      judged: judgedBy(c.rule, c.fromVerdict),
    })),
    phases: objective.phases.map((phase) => {
      const lines = objective.phaseCriteria.filter(
        (c) => c.region === phase.region && c.phase === phase.number,
      );
      return {
        region: phase.region,
        number: phase.number,
        name: phase.name,
        criteria: lines.map((c) => c.text),
        painLimit: lines.filter((c) => c.namesPainLimit).map((c) => c.text),
      };
    }),
    categories: {
      file: categories.file,
      names: categories.categories.map((category) => category.name),
      mapped: Object.keys(categories.mapping).length,
    },
    planCatalog: {
      file: planCatalog.file,
      modalities: planCatalog.modalities.map((m) => ({
        name: m.name,
        precautions: m.precautions.map(
          (p) => `${precautionLabels[p.precaution] ?? p.precaution} (${p.source})`,
        ),
        signedOff: m.signedOff,
      })),
      questionnaires: planCatalog.questionnaires.map((q) => ({
        name: q.name,
        regions:
          q.regions.length === 0
            ? 'Any region'
            : q.regions.map((r) => knowledgeRegions[r].label).join(', '),
        useFor: q.useFor,
      })),
    },
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
    '## Red flag rules (SET-10)',
    `${report.redFlagRules.length} rules from \`packages/db/src/knowledge/${report.rulesFile.name}\` ` +
      `(SHA-256 ${report.rulesFile.sha256.slice(0, 12)}); ` +
      `${report.redFlagRules.filter((r) => !r.signedOff).length} await clinical sign-off. ` +
      'Drafted from the Red Flag Screening Framework; the health form submit runs them over the ' +
      'screening answers (`docs/runbooks/red-flags.md`). Thresholds are settings: ' +
      '`screening.weight_loss_kg`, `screening.weight_loss_months`, `screening.morning_stiffness_minutes`.',
    table(
      ['Rule', 'Where', 'Triage', 'Raised when', 'Action', 'Source', 'Signed off'],
      report.redFlagRules.map((r) => [
        `${r.name} (\`${r.key}\`)`,
        r.where,
        redFlagTriageLabels[r.triage],
        r.raisedWhen,
        r.action,
        r.source,
        r.signedOff ? 'Yes' : 'Awaiting clinical sign-off',
      ]),
    ),
    '### Red flag presentations from the workbooks',
    'Each Red Flags sheet, word for word: reference for the clinician screening checklist and the ' +
      'tier choice in consultation; never run automatically.',
    table(
      ['Workbook', 'Presentations', 'Screening notes'],
      Object.entries(report.redFlagPresentations).map(([region, n]) => [
        knowledgeRegions[region as KnowledgeRegion].label,
        String(n.presentations),
        String(n.notes),
      ]),
    ),
    '## Objective measures and special tests (CLN-05)',
    'Each Progress Tracker section with a recognised header gives measures: LSI (involved and ' +
      'uninvolved, Pass at the workbook target), deficit (range, banded), against a reference ' +
      '(normal or target), a marker (one value and its direction) or a 0 to 3 grade. Each Special ' +
      'Tests row gives a test (`docs/runbooks/knowledge-base.md`).',
    table(
      ['Workbook', 'LSI', 'Deficit', 'Reference', 'Marker', 'Grade', 'Special tests'],
      Object.entries(report.objective.regions).map(([region, n]) => [
        knowledgeRegions[region as KnowledgeRegion].label,
        ...['lsi', 'deficit', 'reference', 'marker', 'grade', 'tests'].map((k) =>
          String(n[k] ?? 0),
        ),
      ]),
    ),
    '### Not read as measures',
    'Yes or no screens, ratios, readiness summaries and worded checks; they belong with clearance ' +
      'and review.',
    table(
      ['Workbook', 'Row', 'What', 'Text'],
      report.objective.skipped.map((s) => [
        knowledgeRegions[s.region].label,
        String(s.rowNumber),
        s.why === 'section' ? 'Section' : 'Row',
        s.text,
      ]),
    ),
    '## Readiness criteria (OUT-08)',
    'Each Progress Tracker readiness section, one criterion per line: each measure a count line ' +
      'names (judged by its own rule, or its target or MCID column), each yes or no line, and the ' +
      'yes or no rows only the overall verdict names (`docs/runbooks/knowledge-base.md`).',
    table(
      ['Workbook', 'Row', 'Criterion', 'Judged by'],
      report.readiness.map((c) => [
        knowledgeRegions[c.region].label,
        String(c.rowNumber),
        c.text,
        c.judged,
      ]),
    ),
    '## Phased programmes (OUT-04)',
    'Each Phased Programme sheet, one phase per "Phase n" row; its Exit Criteria split on ";" into ' +
      'the lines the treating physio marks. A line naming acceptable pain shows the latest session ' +
      'pain beside it (decision 4). The Bone Stress workbook has no phased programme.',
    table(
      ['Workbook', 'Phase', 'Exit criteria', 'Pain hint on'],
      report.phases.map((p) => [
        knowledgeRegions[p.region].label,
        `${String(p.number)}: ${p.name}`,
        p.criteria.join('; '),
        p.painLimit.length > 0 ? p.painLimit.join('; ') : 'None',
      ]),
    ),
    '## Diagnosis categories (CLN-06)',
    `${report.categories.names.length} categories from ` +
      `\`packages/db/src/knowledge/${report.categories.file.name}\` ` +
      `(SHA-256 ${report.categories.file.sha256.slice(0, 12)}), the client's "Physiotherapeutic ` +
      `diagnosis" list word for word; ${report.categories.mapped} of ${report.totals.conditions} ` +
      'conditions mapped to one (the client’s mapping arrives with SET-12; until then the ' +
      'clinician picks the category in Assessment).',
    report.categories.names.map((name) => `- ${cell(name)}`).join('\n'),
    '## Plan catalog (CLN-07)',
    `${report.planCatalog.modalities.length} modalities and ${report.planCatalog.questionnaires.length} ` +
      `questionnaires from \`packages/db/src/knowledge/${report.planCatalog.file.name}\` ` +
      `(SHA-256 ${report.planCatalog.file.sha256.slice(0, 12)}). A modality warns in the plan when ` +
      'the patient has a precaution it lists; the links are drafted from the Blueprint’s Part B ' +
      'statements and the Consultation SOP v2 §12.3 and await clinical sign-off ' +
      '(`docs/runbooks/consultation.md`).',
    table(
      ['Modality', 'Warns about', 'Signed off'],
      report.planCatalog.modalities.map((m) => [
        m.name,
        m.precautions.length > 0 ? m.precautions.join('; ') : 'Nothing',
        m.signedOff ? 'Yes' : 'Awaiting clinical sign-off',
      ]),
    ),
    table(
      ['Questionnaire', 'For', 'Use for'],
      report.planCatalog.questionnaires.map((q) => [q.name, q.regions, q.useFor]),
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
