/**
 * The last check before anything leaves for a model (AI-01; rule 11: no names, phone numbers or
 * IDs to any AI model). The task's input schema already allows only the TAD's fields; this scans
 * every text value actually sent, as written (not as JSON, where a line break would join words),
 * for anything that looks like an identifier, and for the patient's own name words when the
 * caller passes them. Any hit and nothing is sent.
 */
const identifiers: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
  // OP numbers (SCH-01: the centre's code, a dash, 5 digits) and appointment IDs (SCH-04: MVH-…).
  /\b[A-Z]{2,5}-\d{3,}\b/,
];

/** Runs of digits with spaces or dashes between them (linear: no nested repeats). */
const digitRuns = /\+?\d[\d\s-]*\d/g;

/** Phone numbers and other long numbers: 7 or more digits in one run. */
function longNumber(text: string): boolean {
  return (text.match(digitRuns) ?? []).some((run) => run.replace(/\D/g, '').length >= 7);
}

/** Every text and number in a value, as written. */
export function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (value && typeof value === 'object') return Object.values(value).flatMap(textsOf);
  return [];
}

/** What an identifier is replaced with before a patient's own text is sent (WA-11). */
export const REMOVED = '[removed]';

function nameWords(forbidden: readonly string[]): string[] {
  return forbidden
    .flatMap((name) => name.toLowerCase().split(/[^\p{L}]+/u))
    .filter((word) => word.length >= 2);
}

/**
 * A patient's own words with everything this guard looks for replaced (WA-11: a typed WhatsApp
 * message): IDs, emails, phone and other long numbers, and the name words given. Whatever is
 * left still passes `outboundAllowed` before it is sent.
 */
export function redactIdentifiers(text: string, forbidden: readonly string[] = []): string {
  const names = new Set(nameWords(forbidden));
  // Splitting on a pattern cuts at every match, global or not.
  let redacted = identifiers.reduce(
    (current, pattern) => current.split(pattern).join(REMOVED),
    text,
  );
  redacted = redacted.replace(digitRuns, (run) =>
    run.replace(/\D/g, '').length >= 7 ? REMOVED : run,
  );
  return names.size === 0
    ? redacted
    : redacted.replace(/\p{L}+/gu, (word) => (names.has(word.toLowerCase()) ? REMOVED : word));
}

export function outboundAllowed(
  texts: readonly string[],
  forbidden: readonly string[] = [],
): boolean {
  const names = nameWords(forbidden);
  return texts.every((text) => {
    if (identifiers.some((pattern) => pattern.test(text)) || longNumber(text)) return false;
    const words = new Set(text.toLowerCase().split(/[^\p{L}]+/u));
    return !names.some((word) => words.has(word));
  });
}
