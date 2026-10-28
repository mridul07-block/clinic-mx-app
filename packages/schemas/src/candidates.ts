import { durationWeeks } from './assessment';
import type { HealthFormAnswers } from './health-form';
import { intakeAge } from './intake-submit';
import type { KnowledgeRegion, Onset, RedFlagTier, SexPredominance } from './knowledge';
import { knowledgeRegionOfScreening } from './objective';
import { patientSexes, type PatientSex } from './patients';
import { screeningRegions, type ScreeningRegion } from './red-flags';

/**
 * The preparation sheet's candidate filter and must rule out (AI-02; PRD section 6 "How the
 * preparation sheet works" steps 1 and 2: "Code filters the 354 knowledge base rows to about 15 to
 * 25 candidates by region, age, sex, onset and duration" and "Matching high risk rows go to "Must
 * rule out" by rule, whatever the model says"; TAD section 6 steps 2 and 3). Pure and
 * deterministic: code filters, the model only ranks (AI-03). Recommended defaults chosen under the
 * user's standing approval, 28 October 2026 (DECISION AI-02 in docs/PROGRESS.md;
 * docs/runbooks/ai-candidates.md). It reads only what the workbooks state; nothing is weighted.
 */

/** The case the shortlist is for: no names, phone numbers or IDs (rule 11). */
export interface CandidateCase {
  region: ScreeningRegion | null;
  age: number | null;
  sex: PatientSex | null;
  onset: 'gradual' | 'sudden' | null;
  /** Carried for the ranker (TAD: the model gets duration); not matched, DECISION AI-02. */
  durationWeeks: number | null;
  /** Carried for the ranker (TAD: the model gets sport); not matched, DECISION AI-02. */
  activities: string[];
  /** The body chart zones marked, only to name gaps. */
  painZones: string[];
}

/** What the filter reads of a knowledge base listing (one workbook row). */
export interface CandidateListing {
  conditionId: string;
  region: KnowledgeRegion;
  rowNumber: number;
  ageMin: number | null;
  ageMax: number | null;
  /** The age column as written: some state the age at onset ("Under 45 at onset"). */
  ageText: string | null;
  onsets: readonly Onset[];
  sex: SexPredominance | null;
  redFlagTier: RedFlagTier;
}

export interface CandidateSettings {
  /** `ai.candidates_min` */
  min: number;
  /** `ai.candidates_max` */
  max: number;
  /** `ai.must_rule_out_tiers` */
  mustRuleOutTiers: readonly RedFlagTier[];
}

export type Fit = 'match' | 'unknown' | 'mismatch';
export type SexFit = 'match' | 'neutral' | 'against';

export interface ShortlistItem {
  conditionId: string;
  region: KnowledgeRegion;
  rowNumber: number;
  fit: { age: Fit; onset: Fit; sex: SexFit };
  /** Chosen by the filter: one of the 15 to 25. */
  filtered: boolean;
  /** A matching high risk row, always on the shortlist whatever the ranking. */
  mustRuleOut: boolean;
}

/** What the shortlist cannot cover for this case. */
export type ShortlistGap = 'no_thoracic_workbook';

export interface Shortlist {
  status: 'ok' | 'no_region';
  knowledgeRegion: KnowledgeRegion | null;
  /** Must rule out first, in workbook row order; then the filtered rows in filter order. */
  items: ShortlistItem[];
  /** How many rows the filter chose (between the settings' bounds, or the whole region). */
  candidateCount: number;
  gaps: ShortlistGap[];
}

const isOnset = (value: unknown): value is 'gradual' | 'sudden' =>
  value === 'gradual' || value === 'sudden';

/**
 * The case from the health form: the region, the form's date of birth and sex (else what is on
 * file), the onset, the duration and the activities. Older forms that never asked read as unknown.
 */
export function candidateCase(
  answers: HealthFormAnswers,
  onFile: {
    dateOfBirth: string | null;
    sex: PatientSex | null;
    bodyRegion: ScreeningRegion | null;
  },
  today: string,
): CandidateCase {
  const region = screeningRegions.find((r) => r === answers.region) ?? onFile.bodyRegion;
  const sex = patientSexes.find((s) => s === answers.sex) ?? onFile.sex;
  const zones = answers.pain_site;
  const activities = answers.activities;
  return {
    region,
    age: intakeAge(answers, onFile.dateOfBirth, today),
    sex,
    onset: isOnset(answers.onset) ? answers.onset : null,
    durationWeeks: durationWeeks(answers.duration, answers.duration_unit) ?? null,
    activities: Array.isArray(activities) ? activities.filter((a) => typeof a === 'string') : [],
    painZones: Array.isArray(zones) ? zones.filter((z) => typeof z === 'string') : [],
  };
}

const WEEKS_PER_YEAR = 365.25 / 7;

/**
 * Age, inclusive. A row whose age column states the age at onset ("Under 45 at onset", "10-20
 * (onset)") is checked against the age the problem started at, from the duration: any whole age
 * the duration allows counts, so it is never narrower than the text. Without a duration it says
 * nothing either way.
 */
function ageFit(listing: CandidateListing, c: CandidateCase): Fit {
  if (c.age === null || (listing.ageMin === null && listing.ageMax === null)) return 'unknown';
  let youngest = c.age;
  let oldest = c.age;
  if (listing.ageText && /\bonset\b/i.test(listing.ageText)) {
    if (c.durationWeeks === null) return 'unknown';
    const years = c.durationWeeks / WEEKS_PER_YEAR;
    youngest = c.age - Math.ceil(years);
    oldest = c.age - Math.floor(years);
  }
  const above = listing.ageMin === null || oldest >= listing.ageMin;
  const below = listing.ageMax === null || youngest <= listing.ageMax;
  return above && below ? 'match' : 'mismatch';
}

/**
 * Onset: a mismatch only when the row states gradual or sudden and not the patient's; a row with
 * no onset, or only recurrent or subacute, says nothing either way (DECISION AI-02).
 */
function onsetFit(listing: CandidateListing, onset: 'gradual' | 'sudden' | null): Fit {
  const stated = listing.onsets.filter(isOnset);
  if (onset === null || stated.length === 0) return 'unknown';
  return stated.includes(onset) ? 'match' : 'mismatch';
}

/** Sex is a predominance: it orders rows and never excludes one. */
function sexFit(listing: CandidateListing, sex: PatientSex | null): SexFit {
  if (sex === null || sex === 'other' || listing.sex === null || listing.sex === 'equal') {
    return 'neutral';
  }
  return listing.sex === sex ? 'match' : 'against';
}

export function listingFit(listing: CandidateListing, c: CandidateCase): ShortlistItem['fit'] {
  return {
    age: ageFit(listing, c),
    onset: onsetFit(listing, c.onset),
    sex: sexFit(listing, c.sex),
  };
}

/**
 * The shortlist (DECISION AI-02):
 * - Region is the only hard filter: the workbook of the patient's region. Subregion, duration and
 *   activity wait for the client; Bone Stress has no region and is never chosen.
 * - Within the region, rows are ordered by what the workbooks state: an age mismatch last, then an
 *   onset mismatch, then the other sex's predominance, then more stated matches first, then the
 *   workbook's own row order.
 * - The filter takes the rows with no age or onset mismatch, kept between `min` and `max`: more
 *   are cut in that order; fewer are filled from the next rows, which show their mismatches.
 * - Must rule out: every row of the region whose red flag tier is in `mustRuleOutTiers` and whose
 *   age range admits the patient (all of them when the age is unknown), outside the count, never
 *   cut. Onset and sex never narrow it.
 */
export function shortlistCandidates(
  listings: readonly CandidateListing[],
  c: CandidateCase,
  settings: CandidateSettings,
): Shortlist {
  const gaps: ShortlistGap[] = c.painZones.includes('upper_back') ? ['no_thoracic_workbook'] : [];
  if (!c.region) {
    return { status: 'no_region', knowledgeRegion: null, items: [], candidateCount: 0, gaps };
  }
  const region = knowledgeRegionOfScreening[c.region];
  const rows = listings
    .filter((listing) => listing.region === region)
    .map((listing) => ({ listing, fit: listingFit(listing, c) }));

  const matches = (fit: ShortlistItem['fit']) =>
    [fit.age === 'match', fit.onset === 'match', fit.sex === 'match'].filter(Boolean).length;
  const ordered = rows.toSorted(
    (a, b) =>
      Number(a.fit.age === 'mismatch') - Number(b.fit.age === 'mismatch') ||
      Number(a.fit.onset === 'mismatch') - Number(b.fit.onset === 'mismatch') ||
      Number(a.fit.sex === 'against') - Number(b.fit.sex === 'against') ||
      matches(b.fit) - matches(a.fit) ||
      a.listing.rowNumber - b.listing.rowNumber,
  );
  const strict = ordered.filter((r) => r.fit.age !== 'mismatch' && r.fit.onset !== 'mismatch');
  const low = Math.min(settings.min, settings.max);
  const count = Math.min(ordered.length, Math.max(low, Math.min(strict.length, settings.max)));
  const chosen = new Set(ordered.slice(0, count).map((r) => r.listing));

  const mustRuleOut = rows
    .filter(
      (r) => settings.mustRuleOutTiers.includes(r.listing.redFlagTier) && r.fit.age !== 'mismatch',
    )
    .toSorted((a, b) => a.listing.rowNumber - b.listing.rowNumber);
  const flagged = new Set(mustRuleOut.map((r) => r.listing));

  const item = (r: (typeof rows)[number]): ShortlistItem => ({
    conditionId: r.listing.conditionId,
    region: r.listing.region,
    rowNumber: r.listing.rowNumber,
    fit: r.fit,
    filtered: chosen.has(r.listing),
    mustRuleOut: flagged.has(r.listing),
  });
  return {
    status: 'ok',
    knowledgeRegion: region,
    items: [
      ...mustRuleOut.map(item),
      ...ordered
        .slice(0, count)
        .filter((r) => !flagged.has(r.listing))
        .map(item),
    ],
    candidateCount: count,
    gaps,
  };
}
