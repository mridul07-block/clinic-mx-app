import 'server-only';
import {
  answerText,
  lsiPercent,
  measureResult,
  measureStatusLabels,
  specialTestResultLabels,
  subjectiveAnswered,
  subjectiveField,
  subjectiveValue,
  type ConsultationSections,
  type HealthFormAnswers,
  type KnowledgeMeasure,
  type KnowledgeSpecialTest,
  type MeasureEntry,
} from '@clinic-mx/schemas';
import { Fields, Mono, Paragraph, Section, Table } from './letterhead';

/**
 * What the patient documents print from the clinical record, worded once (ALT-06, ALT-07): the
 * consultation summary and the referral letter build their sections from these blocks.
 */

export type Block =
  | { kind: 'fields'; rows: [string, string][] }
  | { kind: 'table'; columns: { label: string; align?: 'end' }[]; rows: string[][] }
  | { kind: 'lines'; lines: string[] };

export interface DocumentSection {
  heading: string;
  blocks: Block[];
}

/** Builds a document's sections; a section with nothing in it is left out. */
export function sectionList() {
  const out: DocumentSection[] = [];
  const add = (heading: string, ...blocks: Block[]) => {
    const kept = blocks.filter((block) =>
      block.kind === 'lines' ? block.lines.length > 0 : block.rows.length > 0,
    );
    if (kept.length > 0) out.push({ heading, blocks: kept });
  };
  return { out, add };
}

const number = (value: number) => String(Math.round(value * 10) / 10);

/** What was measured, as recorded: both sides, or the one value, with the unit. */
function recorded(measure: KnowledgeMeasure, entry: MeasureEntry): string {
  const unit = measure.unit ? ` ${measure.unit}` : '';
  if (entry.involved !== undefined || entry.uninvolved !== undefined) {
    return [
      entry.involved === undefined ? '' : `Involved ${number(entry.involved)}${unit}`,
      entry.uninvolved === undefined ? '' : `uninvolved ${number(entry.uninvolved)}${unit}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  return entry.value === undefined ? '' : `${number(entry.value)}${unit}`;
}

/** The workbook's result, as the Objective shows it: LSI or deficit, and its status in words. */
function result(measure: KnowledgeMeasure, entry: MeasureEntry): string {
  const found = measureResult(measure, entry);
  return [
    found.lsi === undefined ? '' : `LSI ${lsiPercent(found.lsi)}`,
    found.deficit === undefined ? '' : `Deficit ${number(found.deficit)} ${measure.unit}`.trim(),
    found.status ? measureStatusLabels[found.status] : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The examination: each measure recorded with the workbook's result and status, and each special
 * test with a result and its interpretation (Not tested is left out).
 */
export function examinationBlocks(
  objective: ConsultationSections['objective'],
  catalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] },
): Block[] {
  const measures = Object.entries(objective.measures).flatMap(([key, entry]) => {
    const measure = catalog.measures.find((m) => m.key === key);
    const shown = measure ? recorded(measure, entry) : '';
    return measure && shown ? [[measure.name, shown, result(measure, entry)]] : [];
  });
  const tests = objective.tests.flatMap((test) => {
    const known = catalog.specialTests.find((t) => t.key === test.key);
    return known && test.result && test.result !== 'not_tested'
      ? [[known.test, specialTestResultLabels[test.result], test.interpretation.trim()]]
      : [];
  });
  return [
    {
      kind: 'table',
      columns: [{ label: 'Measure' }, { label: 'Recorded' }, { label: 'Result' }],
      rows: measures,
    },
    {
      kind: 'table',
      columns: [{ label: 'Special test' }, { label: 'Result' }, { label: 'Interpretation' }],
      rows: tests,
    },
  ];
}

/** The investigations the patient reported (or the clinician confirmed), when there are any. */
export function investigationLines(
  confirmed: ConsultationSections['subjective']['confirmed'],
  answers: HealthFormAnswers,
): string[] {
  const value = subjectiveValue('investigations', confirmed, answers);
  return value !== undefined && subjectiveAnswered(value)
    ? [answerText(subjectiveField('investigations'), value)]
    : [];
}

/** A document's sections on the page; an OP number prints in Plex Mono. */
export function SectionsBody({ sections }: { sections: DocumentSection[] }) {
  return sections.map((section) => (
    <Section key={section.heading} heading={section.heading}>
      {section.blocks.map((block, index) => {
        const key = [section.heading, index].join('-');
        if (block.kind === 'lines') {
          return block.lines.map((line) => (
            <Paragraph key={[key, line].join('-')}>{line}</Paragraph>
          ));
        }
        if (block.kind === 'table') {
          return <Table key={key} columns={block.columns} rows={block.rows} />;
        }
        return (
          <Fields
            key={key}
            rows={block.rows.map(([label, value]) => [
              label,
              label === 'OP number' ? <Mono key={label}>{value}</Mono> : value,
            ])}
          />
        );
      })}
    </Section>
  ));
}
