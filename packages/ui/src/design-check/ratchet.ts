import type { Problem } from './problems';

/**
 * Patterns the front end redesign (UIX) replaces with the component kit and the Page widths.
 * legacy.json holds how many are left; the count may only fall, so work between the redesign
 * tickets cannot add more. When a ticket removes some, it lowers the number in legacy.json in
 * the same commit; at zero the pattern becomes a ban (UIX-26).
 */
export const legacyPatterns = {
  /** A native select; the kit's Select replaces it (UIX-08). */
  'raw-select': /<select\b/g,
  /** A native date input; the kit's DatePicker replaces it (UIX-10). */
  'raw-date-input': /\btype="date"/g,
  /** A page capped at the 400 px sign in width on a desktop; Page widths replace it (UIX-11). */
  'phone-width-page': /(?<![\w-])max-w-signin(?![\w-])/g,
} as const;

export type LegacyName = keyof typeof legacyPatterns;
export type LegacyCounts = Record<LegacyName, number>;

/** Only screen code counts: tests and end to end specs may name the patterns. */
export const countsTowardsRatchet = (file: string) =>
  /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file) && !file.includes('/e2e/');

export function emptyCounts(): LegacyCounts {
  return { 'raw-select': 0, 'raw-date-input': 0, 'phone-width-page': 0 };
}

/** Adds one file's matches (comments already blanked) to `counts`. */
export function addCounts(counts: LegacyCounts, text: string): void {
  for (const name of Object.keys(legacyPatterns) as LegacyName[]) {
    counts[name] += [...text.matchAll(legacyPatterns[name])].length;
  }
}

/** A count above its limit is new legacy; one below means legacy.json must come down. */
export function checkRatchet(
  counts: LegacyCounts,
  limits: Partial<Record<string, unknown>>,
  file: string,
): Problem[] {
  const problems: Problem[] = [];
  for (const name of Object.keys(legacyPatterns) as LegacyName[]) {
    const limit = limits[name];
    const count = counts[name];
    if (typeof limit !== 'number') {
      problems.push({ file, line: 1, rule: 'ratchet', message: `${name} has no limit` });
    } else if (count > limit) {
      problems.push({
        file,
        line: 1,
        rule: 'ratchet',
        message: `${name}: ${String(count)} found, at most ${String(limit)}; use the component kit or a Page width instead`,
      });
    } else if (count < limit) {
      problems.push({
        file,
        line: 1,
        rule: 'ratchet',
        message: `${name}: ${String(count)} left, lower its limit from ${String(limit)} to ${String(count)}`,
      });
    }
  }
  return problems;
}
