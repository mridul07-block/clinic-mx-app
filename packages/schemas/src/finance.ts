/**
 * Finance's dashboards (DSH-04, Frontend Specification sections 6 and 8): collections, unpaid
 * bills, packages and revenue, with CSV exports of their tables. What is pure about them lives
 * here. Recommended defaults chosen under the user's standing approval, 28 October 2026
 * (docs/runbooks/finance-dashboards.md).
 */

export const financeTabs = ['collections', 'unpaid', 'packages', 'revenue'] as const;

export type FinanceTab = (typeof financeTabs)[number];

export const financeTabLabels: Record<FinanceTab, string> = {
  collections: 'Collections',
  unpaid: 'Unpaid',
  packages: 'Packages',
  revenue: 'Revenue',
};

/** The tables Finance can download as CSV. */
export const financeExports = ['collections', 'unpaid', 'revenue'] as const;

export type FinanceExport = (typeof financeExports)[number];

/** Finance's screens whose data no ticket has built yet. */
export const financeComing = {
  unpaid: 'Pay as you go balances and the flag above 3 unpaid sessions come with BIL-10.',
  revenue: 'Refunds and credits come with BIL-11.',
} as const;

/** A calendar month, "2026-10". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The month `count` months after `month` (before, when negative). */
export function addMonths(month: string, count: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + count;
  return `${String(Math.floor(index / 12))}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The `count` months ending with `last`, oldest first. */
export function monthsEnding(last: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(last, index - count + 1));
}

/** "Oct", or "Oct 2025" when asked for the year. */
export function monthLabel(month: string, withYear = false): string {
  const label = new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  return label;
}

/**
 * One CSV cell: quoted when it holds a comma, quote or line break, and with a leading apostrophe
 * when it starts like a spreadsheet formula (=, +, -, @, tab), so opening the file never runs one.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A CSV file from a header and rows, with Windows line endings for spreadsheets. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Paise as rupees with two decimals for a CSV, "1500.00": no symbol, no grouping. */
export function csvRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}
