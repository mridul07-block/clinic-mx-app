import { aiSimilarCaseSchema, type AiSimilarCase } from './ai-gateway';
import { activityLabels, zoneLabels } from './ai-sheet';
import { suggestStage, type AssessmentSettings } from './assessment';
import type { CandidateCase } from './candidates';

/**
 * Similar confirmed cases (AI-05; TAD section 7 step 4: "fetch 3 to 5 past episodes with similar
 * answers whose diagnosis was confirmed at review or discharge (no identifiers)"; PRD section 6:
 * "From month one, 3 to 5 similar confirmed past cases (no identifiers) are shown to the model and
 * the physio"). Pure and deterministic, in the manner of the candidate filter (AI-02): code
 * chooses them by what the health forms state, nothing is weighted, and only structured fields go
 * out. Recommended defaults chosen under the user's standing approval, 29 October 2026 (DECISION
 * AI-05 in docs/PROGRESS.md; docs/runbooks/ai-similar-cases.md).
 */

/** A past episode that may be similar: its case from its own latest submitted form. */
export interface SimilarCandidate {
  /** Only to tell episodes apart here; never sent, shown or stored. */
  episodeId: string;
  patientId: string;
  case: CandidateCase;
  /** The confirmed condition and its name in the knowledge base. */
  conditionId: string;
  conditionName: string;
  confirmedAt: Date;
}

export interface SimilarSettings {
  /** `ai.similar_cases_min`: fewer than this many, and none are shown or sent. */
  min: number;
  /** `ai.similar_cases_max` */
  max: number;
  /** Whether a case may leave (the identifier guard); refused ones are skipped before the cut. */
  allowed?: (c: AiSimilarCase) => boolean;
  /** The Assessment's own stage thresholds (`assessment.acute_weeks_below`, `_chronic_weeks_above`). */
  stage: Pick<AssessmentSettings, 'acuteWeeksBelow' | 'chronicWeeksAbove'>;
}

const shared = (a: readonly string[], b: readonly string[]) =>
  a.filter((value) => b.includes(value)).length;

/** The activities that say something about a case: not "Not active" and not "Other". */
const activitiesOf = (c: CandidateCase) =>
  c.activities.filter((a) => a !== 'not_active' && a !== 'other');

const stageOf = (c: CandidateCase, settings: SimilarSettings['stage']) =>
  suggestStage(c.durationWeeks ?? undefined, settings);

/**
 * The similar confirmed cases for a case (DECISION AI-05):
 * - Only past episodes of the same body region, of other patients, other than this episode.
 * - Ordered by what the forms state, each step breaking the last's ties: no onset mismatch (both
 *   stated and different); no other stage band from the duration (the Assessment's own thresholds);
 *   more pain zones shared; sex not the other one; nearer age; more activities shared; most
 *   recently confirmed. An unknown onset, stage, sex or activity counts as neither like nor
 *   unlike; an unknown age comes after every known one.
 * - Cases `allowed` refuses are skipped for the next ones. At most `max`; fewer than `min` and
 *   there are none, so a thin pool never speaks for a case.
 * Each case carries only its structured fields, and its condition's number on this shortlist.
 */
export function similarCases(
  current: { case: CandidateCase; patientId: string; episodeId: string },
  pool: readonly SimilarCandidate[],
  shortlist: readonly { conditionId: string }[],
  settings: SimilarSettings,
): AiSimilarCase[] {
  const c = current.case;
  if (!c.region) return [];
  const stage = stageOf(c, settings.stage);
  const scored = pool
    .filter(
      (p) =>
        p.case.region === c.region &&
        p.patientId !== current.patientId &&
        p.episodeId !== current.episodeId,
    )
    .map((p) => ({
      p,
      onsetMismatch: c.onset !== null && p.case.onset !== null && c.onset !== p.case.onset ? 1 : 0,
      stageMismatch: (() => {
        const theirs = stageOf(p.case, settings.stage);
        return stage !== undefined && theirs !== undefined && theirs !== stage ? 1 : 0;
      })(),
      zones: shared(c.painZones, p.case.painZones),
      sexAgainst:
        c.sex !== null &&
        c.sex !== 'other' &&
        p.case.sex !== null &&
        p.case.sex !== 'other' &&
        c.sex !== p.case.sex
          ? 1
          : 0,
      ageGap:
        c.age !== null && p.case.age !== null ? Math.abs(c.age - p.case.age) : Number.MAX_VALUE,
      activities: shared(activitiesOf(c), activitiesOf(p.case)),
    }));
  const ordered = scored.toSorted(
    (a, b) =>
      a.onsetMismatch - b.onsetMismatch ||
      a.stageMismatch - b.stageMismatch ||
      b.zones - a.zones ||
      a.sexAgainst - b.sexAgainst ||
      a.ageGap - b.ageGap ||
      b.activities - a.activities ||
      b.p.confirmedAt.getTime() - a.p.confirmedAt.getTime() ||
      a.p.episodeId.localeCompare(b.p.episodeId),
  );
  const cases = ordered.map(({ p }) => {
    const index = shortlist.findIndex((row) => row.conditionId === p.conditionId);
    const age = p.case.age !== null && p.case.age >= 0 && p.case.age <= 120 ? p.case.age : null;
    const weeks =
      p.case.durationWeeks !== null && p.case.durationWeeks <= 5200 ? p.case.durationWeeks : null;
    return aiSimilarCaseSchema.parse({
      age,
      sex: p.case.sex,
      region: p.case.region,
      symptoms: zoneLabels(p.case.painZones),
      durationWeeks: weeks === null ? null : Math.round(weeks * 10) / 10,
      sport: activityLabels(p.case.activities),
      confirmed: p.conditionName.slice(0, 200),
      n: index === -1 ? null : index + 1,
    });
  });
  const allowed = settings.allowed ? cases.filter(settings.allowed) : cases;
  return allowed.length < settings.min ? [] : allowed.slice(0, settings.max);
}
