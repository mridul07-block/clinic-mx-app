/**
 * Consent (INT-06, Blueprint Module 3, TAD `consent_record`): statements are versioned data, each
 * recorded with a tick, the time, its version and the e-signature; declining a mandatory one
 * blocks the related workflow and alerts reception. Part A comes with the health form; Part B
 * (after the consultation) comes with the plan of care.
 */

export const consentStages = ['A', 'B'] as const;
export type ConsentStage = (typeof consentStages)[number];

export const consentSigners = ['patient', 'guardian'] as const;
export type ConsentSigner = (typeof consentSigners)[number];

/** How a consent was signed: drawn on the pad, or a typed full name when the pad cannot run. */
export const signatureKinds = ['drawn', 'typed'] as const;
export type SignatureKind = (typeof signatureKinds)[number];

export interface ConsentStatement {
  key: string;
  stage: ConsentStage;
  version: number;
  /** Word for word as the client gave it. */
  text: string;
  source: string;
}

/**
 * Part A, pre-consultation consent, word for word from the Blueprint (Module 3). A published
 * statement never changes: new wording is a new version (a test pins these).
 */
export const consentStatements = {
  'part_a.screening': {
    key: 'part_a.screening',
    stage: 'A',
    version: 1,
    text: 'I consent to the pre-consultation screening, including questions about my symptoms, medical history, injury, pain, and functional limitations. I understand that this screening helps identify potential red flags and determine the suitability of physiotherapy consultation. I agree to provide accurate information and understand that further medical evaluation may be recommended if necessary.',
    source: 'Blueprint Module 3, Part A (pre-consultation consent)',
  },
  'part_a.contact': {
    key: 'part_a.contact',
    stage: 'A',
    version: 1,
    text: 'I consent to the collection and storage of my mobile number and authorise the clinic to contact me via phone calls, SMS and WhatsApp regarding appointments, consultation reminders, and treatment-related communication.',
    source: 'Blueprint Module 3, Part A (pre-consultation consent)',
  },
} as const satisfies Record<string, ConsentStatement>;

export type ConsentStatementKey = keyof typeof consentStatements;

export const partAStatements: readonly ConsentStatementKey[] = [
  'part_a.screening',
  'part_a.contact',
];

/** The most a drawn signature may be, as a PNG; a technical ceiling, not a business rule. */
export const signatureMaxBytes = 200_000;

const pngDataUrl = 'data:image/png;base64,';

export const CHOOSE_ONE = 'Choose I agree or I do not agree.';
export const SIGN_HERE = 'Please sign in the box.';
export const TYPE_NAME = 'Type your full name to sign.';

export type ConsentSignature = { kind: 'drawn'; png: Uint8Array } | { kind: 'typed'; name: string };

export type ParsedConsent =
  | {
      ok: true;
      decisions: Record<string, boolean>;
      /** Present when every statement is accepted. */
      signature?: ConsentSignature;
    }
  | { ok: false; errors: Record<string, string> };

function base64Bytes(base64: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return undefined;
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Reads a consent screen as posted: "agree" or "decline" for each statement (named by its key),
 * then, when all are agreed, `signature` (a PNG data URL from the pad) or `typedName`. A decline
 * needs no signature: it is recorded as declined and blocks the form.
 */
export function parseConsent(
  statements: readonly string[],
  posted: Readonly<Record<string, string | readonly string[] | undefined>>,
): ParsedConsent {
  const one = (key: string) => {
    const raw = posted[key];
    return (typeof raw === 'string' ? raw : raw?.[0])?.trim() ?? '';
  };
  const errors: Record<string, string> = {};
  const decisions: Record<string, boolean> = {};
  for (const key of statements) {
    const answer = one(key);
    if (answer === 'agree') decisions[key] = true;
    else if (answer === 'decline') decisions[key] = false;
    else errors[key] = CHOOSE_ONE;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!Object.values(decisions).every(Boolean)) return { ok: true, decisions };

  const drawn = one('signature');
  if (drawn) {
    const png = drawn.startsWith(pngDataUrl)
      ? base64Bytes(drawn.slice(pngDataUrl.length))
      : undefined;
    const isPng =
      png !== undefined && png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e;
    if (!isPng || png.length > signatureMaxBytes)
      return { ok: false, errors: { signature: SIGN_HERE } };
    return { ok: true, decisions, signature: { kind: 'drawn', png } };
  }
  const typed = one('typedName').replace(/\s+/g, ' ');
  if (typed.length >= 2 && typed.length <= 100) {
    return { ok: true, decisions, signature: { kind: 'typed', name: typed } };
  }
  return {
    ok: false,
    errors: { signature: 'typedName' in posted ? TYPE_NAME : SIGN_HERE },
  };
}

/** A consent record as read back: what was decided, and when. */
export interface ConsentDecision {
  statementKey: string;
  accepted: boolean;
  createdAt: Date;
}

/**
 * The latest decision for each statement (records are never changed; a change of mind adds new
 * ones). Declined when any statement's latest decision is a decline.
 */
export function latestConsent(records: readonly ConsentDecision[]): {
  latest: Record<string, boolean>;
  declined: boolean;
} {
  const latest: Record<string, { accepted: boolean; at: number }> = {};
  for (const record of records) {
    const at = record.createdAt.getTime();
    const seen = latest[record.statementKey];
    if (!seen || at >= seen.at) latest[record.statementKey] = { accepted: record.accepted, at };
  }
  const decided = Object.fromEntries(
    Object.entries(latest).map(([key, value]) => [key, value.accepted]),
  );
  return { latest: decided, declined: Object.values(decided).some((accepted) => !accepted) };
}
