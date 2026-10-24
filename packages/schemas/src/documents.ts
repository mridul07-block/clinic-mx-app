import { formatIndianPhone } from './centres';
import type { Action } from './permissions';

/**
 * Generated documents (ALT-05, TAD section 9, Frontend Specification section 11): A4 PDFs on the
 * centre's Movementology letterhead, rendered on the server from signed records and stored as a
 * `document` row per version; regenerating never overwrites. The four kinds are TAD section 9's;
 * each is built by its own ticket (ALT-06, ALT-07, BIL-09, OUT-11).
 */
export const documentKinds = [
  'consultation_summary',
  'invoice_receipt',
  'referral_letter',
  'discharge_report',
] as const;

export type DocumentKind = (typeof documentKinds)[number];

export const documentKindLabels: Record<DocumentKind, string> = {
  consultation_summary: 'Consultation summary',
  invoice_receipt: 'Invoice and receipt',
  referral_letter: 'Referral letter',
  discharge_report: 'Discharge report',
};

/**
 * Who opens a kind (PRD section 2): clinical documents need `clinical.read`, at any centre like
 * the signed records they come from; the invoice needs `bills.view_amounts` at its centre.
 * Row level security on `document` checks the same.
 */
export const documentKindAccess: Record<DocumentKind, Action> = {
  consultation_summary: 'clinical.read',
  invoice_receipt: 'bills.view_amounts',
  referral_letter: 'clinical.read',
  discharge_report: 'clinical.read',
};

/** Clinical kinds are read at any centre; the rest only at their own (can's centre check). */
export function documentReadAtAnyCentre(kind: DocumentKind): boolean {
  return documentKindAccess[kind] === 'clinical.read';
}

/** The file name a document opens with, for example `consultation-summary-v2.pdf`. */
export function documentFileName(kind: DocumentKind, version: number): string {
  return `${[kind.replace(/_/g, '-'), `v${version}`].join('-')}.pdf`;
}

/** What `documentSeries` needs of a stored version. */
export interface DocumentVersionEntry {
  kind: DocumentKind;
  sourceId: string;
  version: number;
  createdAt: Date;
}

/**
 * A document's versions together, as the patient record lists them: one entry per document
 * (kind and source), its newest version first and the earlier ones after it, the most recently
 * generated document first.
 */
export function documentSeries<T extends DocumentVersionEntry>(
  entries: readonly T[],
): { latest: T; earlier: T[] }[] {
  const series = new Map<string, T[]>();
  for (const entry of entries) {
    const key = [entry.kind, entry.sourceId].join(':');
    series.set(key, [...(series.get(key) ?? []), entry]);
  }
  return [...series.values()]
    .map((versions) => {
      const [latest, ...earlier] = [...versions].sort((a, b) => b.version - a.version);
      return { latest: latest as T, earlier };
    })
    .sort((a, b) => b.latest.createdAt.getTime() - a.latest.createdAt.getTime());
}

/** The clinic's name, printed on every letterhead and footer (Frontend Specification 11). */
export const CLINIC_NAME = 'Movementology Clinics';

export interface LetterheadCentre {
  name: string;
  address: string | null;
  phone: string | null;
}

/**
 * The lines at the top right of the letterhead (user decision, 25 October 2026: the centre's own,
 * read live from its settings): the clinic, the centre, its address and phone. A centre without
 * an address or phone yet simply leaves that line out.
 */
export function letterheadLines(centre: LetterheadCentre): string[] {
  return [
    CLINIC_NAME,
    centre.name,
    ...(centre.address ? [centre.address] : []),
    ...(centre.phone ? [formatIndianPhone(centre.phone)] : []),
  ];
}
