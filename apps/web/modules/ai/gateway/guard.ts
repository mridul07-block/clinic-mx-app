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

export function outboundAllowed(
  texts: readonly string[],
  forbidden: readonly string[] = [],
): boolean {
  const names = forbidden
    .flatMap((name) => name.toLowerCase().split(/[^\p{L}]+/u))
    .filter((word) => word.length >= 2);
  return texts.every((text) => {
    if (identifiers.some((pattern) => pattern.test(text)) || longNumber(text)) return false;
    const words = new Set(text.toLowerCase().split(/[^\p{L}]+/u));
    return !names.some((word) => words.has(word));
  });
}
