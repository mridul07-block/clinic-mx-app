import { formatIndianPhone } from './centres';
import { answerText, type HealthFormAnswer, type HealthFormAnswers } from './health-form';
import type { Action } from './permissions';
import {
  subjectiveAnswered,
  subjectiveField,
  subjectiveValue,
  type SubjectiveFieldKey,
} from './subjective';

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

/**
 * How often, as the consultation summary prints it (ALT-06): "2 sessions a week for 6 weeks";
 * a part not set is left out, and nothing when neither is.
 */
export function summaryFrequency(sessionsPerWeek: number | null, weeks: number | null): string {
  const sessions =
    sessionsPerWeek === null
      ? ''
      : `${String(sessionsPerWeek)} ${sessionsPerWeek === 1 ? 'session' : 'sessions'} a week`;
  const length = weeks === null ? '' : `${String(weeks)} ${weeks === 1 ? 'week' : 'weeks'}`;
  if (sessions && length) return `${sessions} for ${length}`;
  return sessions || (length ? `For ${length}` : '');
}

/** The complaint as Subjective holds it, in the order the summary prints it (ALT-06). */
const complaintKeys = [
  'complaint',
  'onset',
  'how_started',
  'duration',
  'pain_now',
  'pain_activity',
  'aggravating',
  'easing',
] as const satisfies readonly SubjectiveFieldKey[];

/**
 * The summary's "Primary complaints" rows (ALT-06): each answer as the clinician confirmed it, or
 * as the patient gave it; the duration with its unit; answers left empty are left out.
 */
export function summaryComplaintRows(
  confirmed: Readonly<Partial<Record<SubjectiveFieldKey, HealthFormAnswer>>>,
  answers: HealthFormAnswers,
): [string, string][] {
  const text = (key: SubjectiveFieldKey): string => {
    const value = subjectiveValue(key, confirmed, answers);
    return value !== undefined && subjectiveAnswered(value)
      ? answerText(subjectiveField(key), value)
      : '';
  };
  return complaintKeys.flatMap((key): [string, string][] => {
    const value =
      key === 'duration' && text(key)
        ? [text(key), text('duration_unit').toLowerCase()].join(' ').trim()
        : text(key);
    return value ? [[subjectiveField(key).label, value]] : [];
  });
}
