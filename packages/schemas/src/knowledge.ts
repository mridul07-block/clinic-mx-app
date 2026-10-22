/**
 * Reading the knowledge base workbooks (SET-05, TAD section 4 "Knowledge base tables"). Each
 * Master Matrix row is a condition as one region's workbook describes it; these functions turn its
 * free text into the fields the diagnosis shortlist filters on (TAD section 6: region, age, sex,
 * onset). The text itself is always kept word for word beside the reading. Decisions (user,
 * 22 October 2026): the red flag tier follows the Red Flag Status wording; activity tags come from
 * a fixed vocabulary matched by keywords; nothing here judges clinical meaning.
 */

/**
 * The nine workbooks, one region or tissue group each, in their file order. The prefix starts the
 * stable condition IDs of the conditions a workbook is home to (`SHO-001`).
 */
export const knowledgeRegions = {
  shoulder: { label: 'Shoulder', prefix: 'SHO', file: 1 },
  elbow: { label: 'Elbow', prefix: 'ELB', file: 2 },
  forearm_wrist: { label: 'Forearm and wrist', prefix: 'WRI', file: 3 },
  hip: { label: 'Hip and groin', prefix: 'HIP', file: 4 },
  knee: { label: 'Knee', prefix: 'KNE', file: 5 },
  foot_ankle: { label: 'Foot and ankle', prefix: 'ANK', file: 6 },
  cervical: { label: 'Cervical spine', prefix: 'CER', file: 7 },
  lumbar_sij: { label: 'Lumbar spine and SIJ', prefix: 'LUM', file: 8 },
  bone_stress: { label: 'Bone stress, cartilage and meniscus', prefix: 'BSC', file: 9 },
} as const;

export type KnowledgeRegion = keyof typeof knowledgeRegions;
export const knowledgeRegionKeys = Object.keys(knowledgeRegions) as [
  KnowledgeRegion,
  ...KnowledgeRegion[],
];

/** A stable condition ID: a workbook prefix and three digits, never reused. */
export const conditionIdPattern = /^[A-Z]{3}-\d{3}$/;

/** A knowledge base version is a draft until the Super Admin approves it (SET-06). */
export const knowledgeVersionStatuses = ['draft', 'approved'] as const;

/**
 * How strongly a condition is a red flag, from its Red Flag Status wording: "No", "Screen: …",
 * "YES if/for …" (only in certain cases) or "YES …". The Bone Stress workbook has no such column.
 */
export const redFlagTiers = ['none', 'screen', 'conditional', 'red_flag', 'not_stated'] as const;
export type RedFlagTier = (typeof redFlagTiers)[number];

export const redFlagTierLabels: Record<RedFlagTier, string> = {
  none: 'None',
  screen: 'Screen',
  conditional: 'Conditional',
  red_flag: 'Red flag',
  not_stated: 'Not stated',
};

/** The tier a Red Flag Status reads as; undefined when the wording is none of the four. */
export function redFlagTier(text: string): Exclude<RedFlagTier, 'not_stated'> | undefined {
  const t = text.trim();
  if (/^no\b/i.test(t)) return 'none';
  if (/^screen\b/i.test(t)) return 'screen';
  if (/^yes\s+(if|for)\b/i.test(t)) return 'conditional';
  if (/^yes\b/i.test(t)) return 'red_flag';
  return undefined;
}

/** An age range in years, either end open; both open means any age. */
export interface AgeReading {
  min: number | null;
  max: number | null;
  /** False when the text was more than a plain "20-50" or "50+", so the report lists it. */
  plain: boolean;
}

const plainAge = /^(\d+)\s*-\s*(\d+)$|^(\d+)\+$/;

/**
 * Reads an age column: "20-50", "50+", "Under 45" (up to 44) and "Any …". Alternatives such as
 * "20-40 (athletes) / 70+ (insufficiency)" read as the range covering both, and "… (also young …)"
 * as any age, so the shortlist never leaves a condition out on age. Undefined when unreadable.
 */
export function readAge(text: string): AgeReading | undefined {
  const t = text.trim();
  if (/^any\b/i.test(t)) return { min: null, max: null, plain: false };
  const parts = t.split('/').map((part) => part.trim());
  const ranges: [number | null, number | null][] = [];
  for (const part of parts) {
    if (/\balso\b/i.test(part)) return { min: null, max: null, plain: false };
    const range = /^(\d+)\s*-\s*(\d+)/.exec(part);
    const over = /^(\d+)\+/.exec(part);
    const under = /^under\s+(\d+)/i.exec(part);
    if (range) ranges.push([Number(range[1]), Number(range[2])]);
    else if (over) ranges.push([Number(over[1]), null]);
    else if (under) ranges.push([null, Number(under[1]) - 1]);
    else return undefined;
  }
  if (ranges.some(([min, max]) => min !== null && max !== null && max < min)) return undefined;
  const mins = ranges.map(([min]) => min);
  const maxes = ranges.map(([, max]) => max);
  return {
    min: mins.includes(null) ? null : Math.min(...(mins as number[])),
    max: maxes.includes(null) ? null : Math.max(...(maxes as number[])),
    plain: parts.length === 1 && plainAge.test(t),
  };
}

/** How a problem starts: Sudden, Slow (gradual), Recurrent or Subacute. */
export const onsets = ['sudden', 'gradual', 'recurrent', 'subacute'] as const;
export type Onset = (typeof onsets)[number];

const onsetWords: Record<string, Onset> = {
  sudden: 'sudden',
  slow: 'gradual',
  recurrent: 'recurrent',
  subacute: 'subacute',
};

/**
 * Reads an onset column: "Slow", "Sudden", "Sudden/Slow", "Slow after surgery". Each part before
 * a slash is one onset; words after "after" are kept as the note. Undefined when unreadable.
 */
export function readOnset(text: string): { onsets: Onset[]; note: string | null } | undefined {
  const found = new Set<Onset>();
  let note: string | null = null;
  for (const part of text.split('/')) {
    const [word = '', ...rest] = part.trim().split(/\s+/);
    const onset = onsetWords[word.toLowerCase()];
    if (!onset) return undefined;
    found.add(onset);
    if (rest.length > 0) note = rest.join(' ');
  }
  return { onsets: onsets.filter((o) => found.has(o)), note };
}

/** Which sex a condition is more common in; "equal" when neither. */
export const sexPredominances = ['male', 'female', 'equal'] as const;
export type SexPredominance = (typeof sexPredominances)[number];

/** Reads "Male", "Female", "Equal", "Male athletes"; undefined when unreadable. */
export function readSex(text: string): { sex: SexPredominance; athlete: boolean } | undefined {
  const [word = '', ...rest] = text.trim().toLowerCase().split(/\s+/);
  const sex = sexPredominances.find((s) => s === word);
  const athlete = rest.join(' ');
  if (!sex || !['', 'athlete', 'athletes'].includes(athlete)) return undefined;
  return { sex, athlete: athlete !== '' };
}

/**
 * The activity tag vocabulary: each tag and the words in the activity text that give it. Kept here
 * as data for the client to adjust (decision 22 October 2026); the import report lists the
 * activity text that matched no tag.
 */
export const activityTagVocabulary = {
  athlete: { label: 'Athlete or sport', words: /\b(athletes?|sports?|sporting|competitive)\b/i },
  overhead: { label: 'Overhead work or sport', words: /\b(overhead|swimm\w*|painters?)\b/i },
  throwing: {
    label: 'Throwing',
    words: /\b(throw\w*|pitch(ing|ers?)|javelin|baseball|cricket\w*|bowl(ing|ers?))\b/i,
  },
  racquet: { label: 'Racquet sport', words: /\b(racquet|tennis|badminton|squash)\b/i },
  running: { label: 'Running', words: /\b(runn\w*|sprint\w*|jogg\w*|marathon\w*)\b/i },
  jumping: { label: 'Jumping and landing', words: /\b(jump\w*|landing|basketball|volleyball)\b/i },
  field_court_sport: {
    label: 'Field and court sport',
    words: /\b(football\w*|soccer|hockey|court|field|cutting|pivot\w*|kicking)\b/i,
  },
  contact_sport: {
    label: 'Contact sport',
    words: /\b(contact|collision|rugby|tackl\w*|martial)\b/i,
  },
  gymnastics_dance: { label: 'Gymnastics and dance', words: /\b(gymnast\w*|danc\w*|ballet)\b/i },
  weightlifting: {
    label: 'Weightlifting and gym',
    words: /\b(weightlift\w*|lifters?|gym|crossfit|powerlift\w*)\b/i,
  },
  cycling: { label: 'Cycling', words: /\b(cycl(ist|ists|ing))\b/i },
  climbing: { label: 'Climbing', words: /\bclimb\w*/i },
  golf: { label: 'Golf', words: /\bgolf\w*/i },
  military: { label: 'Military training', words: /\b(military|recruits?)\b/i },
  desk_work: {
    label: 'Desk and device work',
    words: /\b(desk|keyboard|computer|device|office|typing)\b/i,
  },
  manual_work: {
    label: 'Manual work and lifting',
    words: /\b(manual|labou?r\w*|construction|tools?|lifting)\b/i,
  },
  squatting_kneeling: {
    label: 'Squatting, kneeling and floor sitting',
    words: /\b(squat\w*|kneel\w*|floor sitting|cross-legged)\b/i,
  },
  driving: { label: 'Driving', words: /\b(driv(er|ers|ing))\b/i },
  sedentary: { label: 'Sedentary', words: /\bsedentary\b/i },
  older_adult: {
    label: 'Older adult',
    words: /\b(older|elderly|post-?menopausal|over [5-9]\d)\b/i,
  },
  child_adolescent: {
    label: 'Child or adolescent',
    words:
      /\b(child\w*|adolescen\w*|paediatric|pediatric|skeletally immature|growth spurt|teen\w*)\b/i,
  },
  trauma_fall: {
    label: 'Trauma or fall',
    words:
      /\b(falls?|trauma\w*|motor vehicle|outstretched|high-energy|accident\w*|fractures?|whiplash)\b/i,
  },
  post_surgical: {
    label: 'After surgery',
    words:
      /\b(surgery|surgical|post-?operative|arthroplasty|fusion|laminectomy|laminoplasty|microdiscectomy|decompression)\b/i,
  },
  pregnancy_postpartum: {
    label: 'Pregnancy or postpartum',
    words: /\b(pregnan\w*|post-?partum|delivery)\b/i,
  },
  hypermobility: { label: 'Hypermobility', words: /\bhypermobil\w*/i },
} as const satisfies Record<string, { label: string; words: RegExp }>;

export type ActivityTag = keyof typeof activityTagVocabulary;
export const activityTags = Object.keys(activityTagVocabulary) as ActivityTag[];

/** The tags whose words appear in a text, in vocabulary order. */
export function tagsIn(text: string): ActivityTag[] {
  return activityTags.filter((tag) => activityTagVocabulary[tag].words.test(text));
}

/**
 * Other names a condition goes by, from its name's brackets: "Frozen Shoulder (Adhesive
 * Capsulitis)" gives "Adhesive Capsulitis"; "(now: RCRSP)" gives "RCRSP".
 */
export function synonymsOf(name: string): string[] {
  return [...name.matchAll(/\(([^)]+)\)/g)]
    .map((match) => (match[1] ?? '').replace(/^now:\s*/i, '').trim())
    .filter((synonym) => synonym !== '');
}

/** A Region column value, spaced and spelled one way: "Pediatric" reads as "Paediatric". */
export function subregionName(text: string): string {
  return text
    .trim()
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .replace(/\bPediatric\b/g, 'Paediatric');
}
