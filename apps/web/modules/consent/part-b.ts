import 'server-only';
import {
  episodeRecord,
  findKioskDevice,
  insertConsentRecords,
  kioskDevices,
  liveConsentLink,
  ownGuardians,
  ownPatient,
  partBForEpisode,
  partBForLink,
  sendLinkToKiosk,
  type PartBContext,
  type PatientLinkAccess,
  type StaffMember,
} from '@clinic-mx/db';
import {
  guardianRelationshipLabels,
  istDate,
  minorStatus,
  parsePartB,
  parseSigner,
  partBGate,
  partBStatements,
  partBStatementsFor,
  partBStatus,
  partBText,
  partBToAsk,
  type ConsentSignature,
  type MinorStatus,
  type PartBFills,
  type PartBStatement,
  type PartBStatementKey,
  type PartBStatus,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { assertMay } from '../access/guard';
import { asPatient } from '../access/patient-db';
import { patientService, staffService, type ServiceTransaction } from '../access/service';
import { asStaff } from '../access/staff-db';
import type { SignatureStore } from '../intake/signature-store';
import {
  PatientLinkError,
  completePatientLink,
  issuePatientLink,
  patientLinkPath,
  verifyPatientLink,
  type IssuedLink,
} from '../patient-links/services';
import { getSetting } from '../settings/settings';

/**
 * Part B consent (BIL-03; PRD J4.4 and J4.5; Blueprint Module 3, Part B;
 * docs/runbooks/consent.md). After the consultation the desk shows the episode's consent QR (or
 * opens it on the tablet); the patient, or their guardian, reads the general terms, the package
 * terms when they chose a package, and one card per planned modality, agrees or declines each, and
 * signs what they agree. What was agreed is not asked again; what was declined is, on a new link.
 * Recommended defaults chosen under the user's standing approval, 30 October 2026 (DECISION
 * BIL-03).
 */

/** A statement as the consent page shows it. */
export interface PartBCard {
  key: string;
  version: number;
  /** What it is about: "General terms", "Package terms" or the modality's name. */
  title: string;
  text: string;
  awaitingWording: boolean;
}

/** Who signs (INT-07): under the adult age, a guardian on file. */
export interface PartBSigning {
  status: MinorStatus;
  adultAge: number;
  guardians: { id: string; label: string }[];
}

export type PartBPage =
  | { open: true; firstName: string; cards: PartBCard[]; signing: PartBSigning }
  | { open: false; reason: 'done' | 'no_plan' };

const groupTitles = { general: 'General terms', package: 'Package terms' } as const;

/** What the episode's Part B asks: its statements, and the plan statement's fills. */
function asked(context: PartBContext): { statements: PartBStatement[]; fills: PartBFills } {
  return {
    statements: partBStatementsFor({
      package: context.package,
      modalities: context.modalities.map((modality) => modality.key),
    }),
    fills: {
      diagnosis: context.diagnosis ?? 'not recorded',
      modalities: context.modalities.map((modality) => modality.name),
    },
  };
}

function cardOf(statement: PartBStatement, context: PartBContext, fills: PartBFills): PartBCard {
  const modality = context.modalities.find((each) => each.key === statement.modality);
  return {
    key: statement.key,
    version: statement.version,
    title:
      statement.group === 'modality'
        ? (modality?.name ?? 'Treatment')
        : groupTitles[statement.group],
    text: partBText(statement, fills),
    awaitingWording: statement.awaitingWording === true,
  };
}

/** The consent page of an opened consent link, read as its patient. */
export async function loadPartB(link: PatientLinkAccess, ip?: string): Promise<PartBPage> {
  const adultAge = await getSetting('patients.adult_age_years');
  const { context, patient, guardians } = await asPatient(
    link,
    async (tx) => ({
      context: await partBForLink(tx),
      patient: await ownPatient(tx),
      guardians: await ownGuardians(tx),
    }),
    ip,
  );
  if (!context?.planned || !patient) return { open: false, reason: 'no_plan' };
  const { statements, fills } = asked(context);
  const toAsk = partBToAsk(statements, context.latest);
  if (toAsk.length === 0) return { open: false, reason: 'done' };
  return {
    open: true,
    firstName: patient.name.split(/\s+/)[0] ?? patient.name,
    cards: toAsk.map((statement) => cardOf(statement, context, fills)),
    signing: {
      status: minorStatus(patient.dateOfBirth, adultAge, istDate(new Date())),
      adultAge,
      guardians: guardians.map((guardian) => ({
        id: guardian.id,
        label: `${guardian.name}, ${guardianRelationshipLabels[guardian.relationship]}`,
      })),
    },
  };
}

const recordPartBSchema = z.object({
  decisions: z.record(z.string(), z.boolean()),
  signer: z.union([
    z.object({ signer: z.literal('patient') }),
    z.object({ signer: z.literal('guardian'), guardianId: z.guid() }),
  ]),
  signature: z
    .union([
      z.object({ kind: z.literal('drawn'), file: z.string().min(1) }),
      z.object({ kind: z.literal('typed'), name: z.string().min(2).max(100) }),
    ])
    .optional(),
});

export type PartBResult =
  | { status: 'saved'; declined: string[] }
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'guardian_needed' }
  | { status: 'stale' }
  | { status: 'link' };

/**
 * Records the decisions as the patient, in one transaction: each statement asked, agreed (signed)
 * or declined (unsigned), with its version, its modality, and for the plan statement the words
 * shown; then the link is used. Asked again what the page did not show: stale.
 */
const recordPartB = patientService({
  input: recordPartBSchema,
  run: async (tx, { decisions, signer, signature }, link): Promise<PartBResult> => {
    const context = await partBForLink(tx);
    if (!context?.planned) return { status: 'link' };
    const { statements, fills } = asked(context);
    const toAsk = partBToAsk(statements, context.latest);
    const keys = toAsk.map((statement) => statement.key).sort();
    if (JSON.stringify(keys) !== JSON.stringify(Object.keys(decisions).sort())) {
      return { status: 'stale' };
    }
    const agreed = Object.values(decisions).some(Boolean);
    if (agreed && !signature) return { status: 'invalid', errors: {} };
    await insertConsentRecords(
      tx,
      toAsk.map((statement) => {
        const accepted = decisions[statement.key] === true;
        return {
          patientId: link.patientId,
          episodeId: context.episodeId,
          patientLinkId: link.id,
          stage: 'B' as const,
          statementKey: statement.key,
          statementVersion: partBStatements[statement.key as PartBStatementKey].version,
          modality: statement.modality ?? null,
          shownText: statement.key === 'part_b.plan' ? partBText(statement, fills) : null,
          accepted,
          signer: signer.signer,
          guardianId: signer.signer === 'guardian' ? signer.guardianId : null,
          signatureKind: accepted && signature ? signature.kind : null,
          signatureFile: accepted && signature?.kind === 'drawn' ? signature.file : null,
          typedName: accepted && signature?.kind === 'typed' ? signature.name : null,
        };
      }),
    );
    await completePatientLink(tx, link);
    return {
      status: 'saved',
      declined: Object.entries(decisions)
        .filter(([, accepted]) => !accepted)
        .map(([key]) => key),
    };
  },
});

/**
 * "Done" on the consent page: who signs (INT-07), each decision, the signature for what is
 * agreed; a drawn signature is stored first, outside the transaction, and removed unless saved.
 */
export async function savePartB(
  token: string,
  posted: Readonly<Record<string, string | readonly string[] | undefined>>,
  options: { ip?: string; store: SignatureStore },
): Promise<PartBResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'consent') return { status: 'link' };
  const page = await loadPartB(opened.link, options.ip);
  if (!page.open) return { status: 'link' };
  const signer = parseSigner(
    {
      status: page.signing.status,
      guardianIds: page.signing.guardians.map((guardian) => guardian.id),
    },
    posted,
  );
  if (!signer.ok && signer.guardianNeeded) return { status: 'guardian_needed' };
  const parsed = parsePartB(
    page.cards.map((card) => card.key),
    posted,
  );
  if (!parsed.ok || !signer.ok) {
    return {
      status: 'invalid',
      errors: { ...(signer.ok ? {} : signer.errors), ...(parsed.ok ? {} : parsed.errors) },
    };
  }
  const drawn: ConsentSignature | undefined = parsed.signature;
  const file =
    drawn?.kind === 'drawn' ? `${opened.link.patientId}/${crypto.randomUUID()}.png` : undefined;
  if (file && drawn?.kind === 'drawn') await options.store.put(file, drawn.png, 'image/png');
  try {
    const result = await recordPartB(
      opened.link,
      {
        decisions: parsed.decisions,
        signer:
          signer.signer === 'guardian'
            ? { signer: 'guardian', guardianId: signer.guardianId }
            : { signer: 'patient' },
        signature:
          drawn?.kind === 'typed'
            ? { kind: 'typed', name: drawn.name }
            : file
              ? { kind: 'drawn', file }
              : undefined,
      },
      options.ip,
    );
    if (file && result.status !== 'saved') await options.store.remove([file]);
    return result;
  } catch (error) {
    if (file) await options.store.remove([file]);
    throw error;
  }
}

/** Where an episode's Part B stands, for the desk and the session gate (BIL-12). */
export interface PartBView {
  planned: boolean;
  package: boolean;
  status: PartBStatus;
  gate: { met: boolean; message: string };
  /** The modalities asked, by name, with each one's latest decision (null: not yet). */
  modalities: { key: string; name: string; accepted: boolean | null }[];
}

/** The view of an episode's Part B from what the database read. */
export function partBView(context: PartBContext): PartBView {
  const { statements } = asked(context);
  const status = partBStatus(statements, context.latest);
  return {
    planned: context.planned,
    package: context.package,
    status,
    gate: context.planned
      ? partBGate(status, { package: context.package })
      : { met: false, message: 'Part B consent follows the signed plan.' },
    modalities: context.modalities.map((modality) => {
      const statement = statements.find((each) => each.modality === modality.key);
      const decided = statement ? context.latest[statement.key] : undefined;
      return { ...modality, accepted: decided ?? null };
    }),
  };
}

/** An episode's Part B for the plan and payment sheet; undefined when not at the person's centre. */
export async function partBForSheet(
  staff: StaffMember,
  episodeId: string,
): Promise<PartBView | undefined> {
  assertMay(staff, 'check_in.manage');
  const context = await asStaff(staff, (tx) => partBForEpisode(tx, episodeId));
  return context ? partBView(context) : undefined;
}

const episodeInput = z.object({ episodeId: z.guid({ error: 'That episode was not found.' }) });
const episodeCentre = async (input: z.output<typeof episodeInput>, tx: ServiceTransaction) => {
  const found = await episodeRecord(tx, input.episodeId);
  if (!found) throw new PatientLinkError('That episode was not found.');
  return { centreId: found.centreId };
};

/** The episode's open consent link, or a new one, once there is something to ask. */
async function consentLink(tx: ServiceTransaction, episodeId: string): Promise<IssuedLink> {
  const context = await partBForEpisode(tx, episodeId);
  const found = await episodeRecord(tx, episodeId);
  if (!context || !found) throw new PatientLinkError('That episode was not found.');
  if (!context.planned) throw new PatientLinkError('Part B consent follows the signed plan.');
  const { statements } = asked(context);
  if (partBToAsk(statements, context.latest).length === 0) {
    throw new PatientLinkError('Part B consent is complete. Nothing to ask.');
  }
  const live = await liveConsentLink(tx, episodeId);
  if (live) {
    const path = patientLinkPath({ id: live.id, purpose: 'consent', expiresAt: live.expiresAt });
    if (!path) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
    return { linkId: live.id, path, expiresAt: live.expiresAt };
  }
  return issuePatientLink(tx, { patientId: found.patientId, episodeId, purpose: 'consent' });
}

/** Show the Part B consent QR: the episode's working consent link, or a new one; audited. */
export const showPartBConsent = staffService({
  action: 'check_in.manage',
  input: episodeInput,
  target: episodeCentre,
  run: (tx, input): Promise<IssuedLink> => consentLink(tx, input.episodeId),
});

/**
 * Open on tablet (PRD J4.4, the tablet as backup): the episode's consent link goes to a working
 * kiosk tablet at the episode's centre. The tablet's name, for the message.
 */
export const openPartBOnTablet = staffService({
  action: 'check_in.manage',
  input: episodeInput.extend({ kioskId: z.guid({ error: 'Choose a tablet.' }) }),
  target: episodeCentre,
  run: async (tx, input): Promise<{ tabletName: string }> => {
    const link = await consentLink(tx, input.episodeId);
    const found = await episodeRecord(tx, input.episodeId);
    const kiosk = await findKioskDevice(tx, input.kioskId);
    if (!kiosk || kiosk.centreId !== found?.centreId) {
      throw new PatientLinkError('That tablet is not at this centre.');
    }
    if (kiosk.stoppedAt || !(await sendLinkToKiosk(tx, kiosk.id, link.linkId))) {
      throw new PatientLinkError('That tablet is no longer a kiosk.');
    }
    return { tabletName: kiosk.name };
  },
});

/** The working kiosk tablets at the episode's centre, for Open on tablet. */
export async function tabletsForEpisode(
  staff: StaffMember,
  episodeId: string,
): Promise<{ id: string; name: string }[]> {
  assertMay(staff, 'check_in.manage');
  return asStaff(staff, async (tx) => {
    const found = await episodeRecord(tx, episodeId);
    if (!found) return [];
    return (await kioskDevices(tx))
      .filter((device) => device.centreId === found.centreId && !device.stoppedAt)
      .map(({ id, name }) => ({ id, name }));
  });
}
