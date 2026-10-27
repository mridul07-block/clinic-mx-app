import { measureResult, type KnowledgeMeasure, type MeasureEntry } from './objective';
import type { PainReading } from './sessions';

/**
 * The Progress tab (OUT-03, PRD J5.8, Frontend Specification "Progress tab"; user decisions 27
 * October 2026): the current episode's pain during activity over its visits, and a bullet graph
 * per strength or hop LSI against its pass with the baseline marked. Worked out here without I/O;
 * the charts draw these. Questionnaire lines join with OUT-02, the week strip with PAT-01 and the
 * phase stepper with OUT-04.
 */

/** One visit's pain, 0 to 10; null when not recorded. */
export interface PainPoint {
  label: string;
  at: Date;
  activity: number | null;
  /** At rest in a session; "pain now" at the consultation. */
  rest: number | null;
  after: number | null;
}

const painValue = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10 ? value : null;

/** The consultation first, then each signed session in order. */
export function painPoints(
  consultation: { at: Date; now: unknown; activity: unknown } | undefined,
  sessions: readonly { number: number; at: Date; pain: Record<PainReading, number | null> }[],
): PainPoint[] {
  const points: PainPoint[] = [];
  if (consultation) {
    points.push({
      label: 'Consultation',
      at: consultation.at,
      activity: painValue(consultation.activity),
      rest: painValue(consultation.now),
      after: null,
    });
  }
  for (const session of [...sessions].sort((a, b) => a.number - b.number)) {
    points.push({
      label: `Session ${String(session.number)}`,
      at: session.at,
      activity: session.pain.activity,
      rest: session.pain.rest,
      after: session.pain.after,
    });
  }
  return points;
}

const lowerFirst = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);

/** "Pain during activity 6 at the consultation, 2 at session 5."; null without two values. */
export function painSentence(points: readonly PainPoint[]): string | null {
  const recorded = points.filter((point) => point.activity !== null);
  const first = recorded[0];
  const last = recorded.at(-1);
  if (!first || !last) return null;
  const at = (point: PainPoint) =>
    `${String(point.activity)} at ${point.label === 'Consultation' ? 'the consultation' : lowerFirst(point.label)}`;
  return first === last
    ? `Pain during activity ${at(first)}.`
    : `Pain during activity ${at(first)}, ${at(last)}.`;
}

/** A taking of a measure: its entry, when, and where (as the reader words it). */
export interface Taking {
  entry: MeasureEntry;
  at: Date;
  from: string;
}

export interface LsiBullet {
  key: string;
  name: string;
  section: string;
  /** The newest LSI, as a fraction (0.95 is 95%). */
  latest: number;
  /** The first LSI in the episode; null when there was only one taking. */
  baseline: number | null;
  /** The measure's pass, as a fraction. */
  passAt: number;
  passes: boolean;
  /** Where and when the newest was taken. */
  from: string;
  at: Date;
}

/** One bullet per LSI measure with an LSI in the episode, in the catalog's order. */
export function lsiBullets(
  measures: readonly KnowledgeMeasure[],
  takings: ReadonlyMap<string, { latest: Taking; first: Taking }>,
): LsiBullet[] {
  return measures.flatMap((measure): LsiBullet[] => {
    if (measure.rule.kind !== 'lsi') return [];
    const found = takings.get(measure.key);
    if (!found) return [];
    const latest = measureResult(measure, found.latest.entry);
    if (latest.lsi === undefined) return [];
    const first =
      found.first.at.getTime() === found.latest.at.getTime()
        ? undefined
        : measureResult(measure, found.first.entry).lsi;
    return [
      {
        key: measure.key,
        name: measure.name,
        section: measure.section,
        latest: latest.lsi,
        baseline: first ?? null,
        passAt: measure.rule.passAt,
        passes: latest.status === 'pass',
        from: found.latest.from,
        at: found.latest.at,
      },
    ];
  });
}
