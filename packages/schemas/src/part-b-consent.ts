import { parseConsent, parseSignature, type ConsentStatement, type ParsedConsent } from './consent';

/**
 * Part B, pre-treatment consent (BIL-03; PRD J4.4 and J4.5; Blueprint Module 3, Part B): after the
 * consultation, before the first session. General terms for every patient; package terms only
 * with a package; one card per modality in the signed plan of care. Each statement is recorded
 * with a tick, its version, the time and the e-signature (`consent_record`, stage B).
 * Recommended defaults chosen under the user's standing approval, 30 October 2026 (DECISION
 * BIL-03; docs/runbooks/consent.md).
 *
 * The wording is the Blueprint's, word for word, and a published statement never changes: new
 * wording is a new version (a test pins these). Dry needling and the Zero Gravity Treadmill have
 * no wording yet (PRD decision 21): their cards say so until the clinic sends it.
 */

/** A Part B statement: general, a package term, or one modality's. */
export interface PartBStatement extends ConsentStatement {
  stage: 'B';
  group: 'general' | 'package' | 'modality';
  /** For a modality's card, its knowledge base key. */
  modality?: string;
  /** True while the clinic's wording is awaited (DECISION #21). */
  awaitingWording?: boolean;
}

/** What the general plan statement names, filled from the consultation and the plan. */
export interface PartBFills {
  diagnosis: string;
  modalities: readonly string[];
}

const blueprint = 'Blueprint Module 3, Part B (pre-treatment consent)';
const awaited = (name: string) =>
  `The clinic’s consent wording for ${name} is awaited. Your physiotherapist will explain this treatment before it is used.`;

export const partBStatements = {
  'part_b.plan': {
    key: 'part_b.plan',
    stage: 'B',
    group: 'general',
    version: 1,
    text: 'I understand the diagnosis {diagnosis} and the treatment plan explained to me, including exercise, the recovery process, and the physiotherapy interventions and modalities proposed to me {modalities}.',
    source: `${blueprint}, general terms ([auto-filled from the consultation record], [auto-listed from the plan of care])`,
  },
  'part_b.right_to_decline': {
    key: 'part_b.right_to_decline',
    stage: 'B',
    group: 'general',
    version: 1,
    text: 'I retain the right to decline any part or all of the treatment offered at any time.',
    source: `${blueprint}, general terms`,
  },
  'part_b.package_validity': {
    key: 'part_b.package_validity',
    stage: 'B',
    group: 'package',
    version: 1,
    text: 'I understand that the package purchased is valid only for a period of three months from the date of payment.',
    source: `${blueprint}, general terms (a package term, PRD J4.4)`,
  },
  'part_b.package_reschedule': {
    key: 'part_b.package_reschedule',
    stage: 'B',
    group: 'package',
    version: 1,
    text: 'I understand that rescheduling is allowed only once for every 10 booked sessions, and that rescheduling is not permitted for sessions on the Zero Gravity Treadmill.',
    source: `${blueprint}, general terms (a package term, PRD J4.4)`,
  },
  'part_b.package_refund': {
    key: 'part_b.package_refund',
    stage: 'B',
    group: 'package',
    version: 1,
    text: 'I understand that treatment packages are covered by a no-questions-asked refund policy.',
    source: `${blueprint}, general terms (a package term, PRD J4.4)`,
  },
  'part_b.modality.electrotherapy': {
    key: 'part_b.modality.electrotherapy',
    stage: 'B',
    group: 'modality',
    modality: 'electrotherapy',
    version: 1,
    text: 'I understand that electrotherapy may include therapeutic ultrasound, IFT, TENS, electrical muscle stimulation, and combination therapy to help manage pain, improve muscle function, and support rehabilitation. Possible side effects include temporary skin irritation, redness, discomfort, or symptom aggravation. I have disclosed relevant medical conditions, implanted electronic devices, pregnancy status where applicable, and any altered sensation to my physiotherapist. I understand that treatment outcomes are not guaranteed and voluntarily consent to the treatment.',
    source: `${blueprint}, Electrotherapy (US, IFT, TENS, EMS, combination)`,
  },
  'part_b.modality.radial_shockwave': {
    key: 'part_b.modality.radial_shockwave',
    stage: 'B',
    group: 'modality',
    modality: 'radial_shockwave',
    version: 1,
    text: 'I understand that Radial Shockwave Therapy uses acoustic pressure waves to help reduce pain and improve function in selected musculoskeletal conditions. Possible side effects include temporary pain, redness, swelling, bruising, and temporary worsening of symptoms. I have disclosed relevant medical conditions, medications, and bleeding disorders to my physiotherapist. I understand that treatment outcomes are not guaranteed and voluntarily consent to this treatment.',
    source: `${blueprint}, Radial Shockwave (RSW)`,
  },
  'part_b.modality.focused_shockwave': {
    key: 'part_b.modality.focused_shockwave',
    stage: 'B',
    group: 'modality',
    modality: 'focused_shockwave',
    version: 1,
    text: 'I understand that Focused Shockwave Therapy may help reduce pain and promote tissue healing in selected musculoskeletal conditions. I have been informed of possible side effects, including temporary pain, redness, swelling, bruising, and temporary worsening of symptoms. I have disclosed relevant medical conditions and medications to my physiotherapist. I have had the opportunity to ask questions and understand that treatment outcomes are not guaranteed. I voluntarily consent to this treatment.',
    source: `${blueprint}, Focused Shockwave (FSW)`,
  },
  'part_b.modality.pemf': {
    key: 'part_b.modality.pemf',
    stage: 'B',
    group: 'modality',
    modality: 'pemf',
    version: 1,
    text: 'I understand that PEMF therapy uses pulsed electromagnetic fields and may help reduce pain and support rehabilitation in selected musculoskeletal conditions. I have been informed of possible temporary discomfort and the need for precautions in certain conditions. I have disclosed relevant medical conditions, pregnancy status where applicable, and implanted electronic devices (e.g., pacemakers) to my physiotherapist. I understand that treatment outcomes are not guaranteed and voluntarily consent to this treatment.',
    source: `${blueprint}, PEMF`,
  },
  'part_b.modality.spinal_traction': {
    key: 'part_b.modality.spinal_traction',
    stage: 'B',
    group: 'modality',
    modality: 'spinal_traction',
    version: 1,
    text: 'I understand that spinal traction therapy applies a controlled pulling force to the spine and may help relieve pain and symptoms in selected spinal conditions. Possible side effects include temporary pain, muscle soreness, stiffness, or worsening of symptoms. I have disclosed relevant medical conditions, previous spinal surgery, osteoporosis, and other significant health concerns to my physiotherapist. I understand that treatment outcomes are not guaranteed and voluntarily consent to this treatment.',
    source: `${blueprint}, Spinal DSO traction`,
  },
  'part_b.modality.laser': {
    key: 'part_b.modality.laser',
    stage: 'B',
    group: 'modality',
    modality: 'laser',
    version: 1,
    text: 'I understand that therapeutic laser uses light energy to help manage pain and support recovery in selected musculoskeletal conditions. Possible side effects include temporary discomfort, redness, or skin irritation. I confirm that I have disclosed relevant medical conditions and medications. I understand that protective eyewear is required and the laser must not be directed into the eyes. I understand that treatment outcomes are not guaranteed and voluntarily consent to this treatment.',
    source: `${blueprint}, Laser`,
  },
  // DECISION #21: the clinic sends the Dry needling and Zero Gravity Treadmill wording; until then
  // their cards say it is awaited, and agreeing records consent to that placeholder (version 0).
  'part_b.modality.dry_needling': {
    key: 'part_b.modality.dry_needling',
    stage: 'B',
    group: 'modality',
    modality: 'dry_needling',
    version: 0,
    text: awaited('Dry needling'),
    source: 'Placeholder: PRD decision 21 (wording from the client)',
    awaitingWording: true,
  },
  'part_b.modality.zero_gravity_treadmill': {
    key: 'part_b.modality.zero_gravity_treadmill',
    stage: 'B',
    group: 'modality',
    modality: 'zero_gravity_treadmill',
    version: 0,
    text: awaited('the Zero Gravity Treadmill'),
    source: 'Placeholder: PRD decision 21 (wording from the client)',
    awaitingWording: true,
  },
} as const satisfies Record<string, PartBStatement>;

export type PartBStatementKey = keyof typeof partBStatements;

const all = Object.values(partBStatements) as PartBStatement[];

/** The statement for a modality's card, or undefined for a modality with no card. */
export function modalityStatement(modality: string): PartBStatement | undefined {
  return all.find((statement) => statement.modality === modality);
}

/**
 * The statements a patient is asked (PRD J4.4): the general terms always; the package terms only
 * when they chose a package; one card per modality in their signed plan, in the plan's order.
 */
export function partBStatementsFor(plan: {
  package: boolean;
  modalities: readonly string[];
}): PartBStatement[] {
  return [
    ...all.filter((statement) => statement.group === 'general'),
    ...(plan.package ? all.filter((statement) => statement.group === 'package') : []),
    ...plan.modalities.flatMap((modality) => {
      const statement = modalityStatement(modality);
      return statement ? [statement] : [];
    }),
  ];
}

/** A statement's words as the patient reads them, the plan statement filled in. */
export function partBText(statement: PartBStatement, fills: PartBFills): string {
  if (statement.key !== 'part_b.plan') return statement.text;
  const modalities = fills.modalities.length ? `(${fills.modalities.join(', ')})` : '';
  return statement.text
    .replace('{diagnosis}', `(${fills.diagnosis})`)
    .replace(' {modalities}', modalities ? ` ${modalities}` : '');
}

/**
 * Reads Part B as posted: "agree" or "decline" for each statement. Declining is allowed; when any
 * is agreed, the form is signed, drawn on the pad or a typed full name (a decline is recorded
 * unsigned).
 */
export function parsePartB(
  statements: readonly string[],
  posted: Readonly<Record<string, string | readonly string[] | undefined>>,
): ParsedConsent {
  const parsed = parseConsent(statements, posted);
  if (!parsed.ok || parsed.signature || !Object.values(parsed.decisions).some(Boolean)) {
    return parsed;
  }
  const signed = parseSignature(posted);
  if (!signed.ok) return { ok: false, errors: { signature: signed.error } };
  return { ok: true, decisions: parsed.decisions, signature: signed.signature };
}

/** Where a patient's Part B stands, from the latest decision on each statement asked. */
export interface PartBStatus {
  /** Every statement asked has a decision. */
  complete: boolean;
  /** A general term declined: no treatment (PRD J4.5). */
  generalDeclined: boolean;
  /** A package term declined: no package (PRD J4.5). */
  packageDeclined: boolean;
  /** Modalities declined: only these are left out (PRD J4.5). */
  modalitiesDeclined: string[];
  /** Statements asked with no decision yet. */
  missing: string[];
}

/** The status from the statements asked and the latest decision on each (key to accepted). */
export function partBStatus(
  asked: readonly PartBStatement[],
  latest: Readonly<Record<string, boolean>>,
): PartBStatus {
  const missing = asked.filter((statement) => !(statement.key in latest)).map((s) => s.key);
  const declined = asked.filter((statement) => latest[statement.key] === false);
  return {
    complete: missing.length === 0,
    generalDeclined: declined.some((statement) => statement.group === 'general'),
    packageDeclined: declined.some((statement) => statement.group === 'package'),
    modalitiesDeclined: declined.flatMap((statement) =>
      statement.modality ? [statement.modality] : [],
    ),
    missing,
  };
}

/**
 * Whether Part B lets treatment start (BIL-12; PRD J4.5 and J4.9), and why not: every statement
 * decided, no general term declined, and with a package no package term declined.
 */
export function partBGate(
  status: PartBStatus,
  plan: { package: boolean },
): { met: boolean; message: string } {
  if (status.generalDeclined) {
    return { met: false, message: 'Part B consent: a general term was declined. No treatment.' };
  }
  if (plan.package && status.packageDeclined) {
    return {
      met: false,
      message: 'Part B consent: a package term was declined. Record another choice, or ask again.',
    };
  }
  if (!status.complete) return { met: false, message: 'Part B consent is needed.' };
  return { met: true, message: 'Part B consent complete' };
}

/**
 * The statements a link asks now: those asked with no decision yet, or declined (the desk can ask
 * again); one agreed is not asked again.
 */
export function partBToAsk(
  asked: readonly PartBStatement[],
  latest: Readonly<Record<string, boolean>>,
): PartBStatement[] {
  return asked.filter((statement) => latest[statement.key] !== true);
}
