import { AI_FINDINGS_MAX, AI_TEXT_MAX } from './ai-gateway';
import {
  lsiPercent,
  measureResult,
  measureStatusLabels,
  specialTestResultLabels,
  type KnowledgeMeasure,
  type KnowledgeSpecialTest,
  type MeasureEntry,
  type MeasureStatus,
  type SpecialTestEntry,
} from './objective';

/**
 * "Recheck with findings" (AI-04; PRD J3.5: "reranks the AI suggestions on demand"; TAD section 7:
 * steps 5 to 7 again "with the examination results, only when tapped"). What the model is sent of
 * the examination: the special tests found Positive or Negative and the measures with a result,
 * each named in the knowledge base's own words with the workbook's own status. Never the
 * clinician's free text (interpretations, notes), which could name someone, and never the
 * Assessment, which is the clinician's own conclusion. Recommended defaults chosen under the
 * user's standing approval, 29 October 2026 (DECISION AI-04 in docs/PROGRESS.md).
 */

/** Positive tests first, then measures not passed, negative tests, passed measures, the rest. */
const NOT_PASSED: readonly MeasureStatus[] = ['not_yet', 'mild', 'restricted'];

const round = (n: number) => String(Math.round(n * 10) / 10);
const clip = (text: string) => text.slice(0, AI_TEXT_MAX);

function measureLine(measure: KnowledgeMeasure, entry: MeasureEntry): string | null {
  const result = measureResult(measure, entry);
  const unit = measure.unit ? ` ${measure.unit}` : '';
  const status = result.status ? ` (${measureStatusLabels[result.status]})` : '';
  if (result.lsi !== undefined) return `${measure.name}: LSI ${lsiPercent(result.lsi)}${status}`;
  if (result.deficit !== undefined) {
    return `${measure.name}: deficit ${round(result.deficit)}${unit}${status}`;
  }
  if (entry.value !== undefined) return `${measure.name}: ${round(entry.value)}${unit}${status}`;
  if (entry.involved !== undefined && entry.uninvolved !== undefined) {
    return `${measure.name}: involved ${round(entry.involved)}${unit}, uninvolved ${round(entry.uninvolved)}${unit}`;
  }
  return null;
}

/** The examination findings a recheck sends, in a fixed order, within the gateway's limits. */
export function recheckFindings(
  objective: {
    measures: Readonly<Record<string, MeasureEntry>>;
    tests: readonly SpecialTestEntry[];
  },
  catalog: { measures: readonly KnowledgeMeasure[]; specialTests: readonly KnowledgeSpecialTest[] },
): string[] {
  const testName = new Map(catalog.specialTests.map((t) => [t.key, t.test]));
  const tests = (result: 'positive' | 'negative') =>
    objective.tests.flatMap((t) => {
      const name = testName.get(t.key);
      return t.result === result && name ? [`${name}: ${specialTestResultLabels[result]}`] : [];
    });
  const measures = catalog.measures.flatMap((measure) => {
    const entry = objective.measures[measure.key];
    const line = entry ? measureLine(measure, entry) : null;
    return line ? [{ line, status: measureResult(measure, entry).status }] : [];
  });
  const notPassed = measures.filter((m) => m.status && NOT_PASSED.includes(m.status));
  const passed = measures.filter((m) => m.status && !NOT_PASSED.includes(m.status));
  const unrated = measures.filter((m) => !m.status);
  return [
    ...tests('positive'),
    ...notPassed.map((m) => m.line),
    ...tests('negative'),
    ...passed.map((m) => m.line),
    ...unrated.map((m) => m.line),
  ]
    .map(clip)
    .slice(0, AI_FINDINGS_MAX);
}
