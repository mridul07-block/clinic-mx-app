import 'server-only';
import {
  clearanceAckForEpisode,
  clearanceAckForLink,
  clearanceToAcknowledge,
  episodeRecord,
  insertConsentRecords,
  liveEpisodeLink,
  ownGuardians,
  ownPatient,
  type AcknowledgedClearanceRecord,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  acknowledgedClearances,
  clearanceAcknowledgementTitle,
  clearanceSectionTitles,
  clearanceSections,
  clearanceStatementKey,
  clearanceTick,
  guardianRelationshipLabels,
  istDate,
  minorStatus,
  parseClearanceAcknowledgement,
  parseSigner,
  type AcknowledgedClearance,
  type ClearanceSection,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { asPatient } from '../access/patient-db';
import { patientService, staffService, type ServiceTransaction } from '../access/service';
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
import type { PartBSigning } from './part-b';

/**
 * The patient's clearance acknowledgement (OUT-09; PRD J6.5; SOP 14.2; Frontend Specification
 * "Clearance acknowledgement"; docs/runbooks/sessions.md). After signing Return to training or
 * Return to sport the consultant shows the episode's clearance QR; the patient, or their guardian,
 * reads the plan, the warning signs to stop and the residual risk the consultant wrote, ticks each
 * and signs. Recommended defaults chosen under the user's standing approval, 30 October 2026
 * (DECISION OUT-09): the ticks' words are a placeholder until the clinic gives its own.
 */

/** A section as the patient's page shows it. */
export interface ClearanceSectionCard {
  section: ClearanceSection;
  title: string;
  text: string;
}

export type ClearancePage =
  | {
      open: true;
      firstName: string;
      status: AcknowledgedClearance;
      title: string;
      sections: ClearanceSectionCard[];
      tick: string;
      signing: PartBSigning;
    }
  | { open: false; reason: 'done' | 'none' };

function sectionsOf(record: AcknowledgedClearanceRecord): ClearanceSectionCard[] {
  const texts: Record<ClearanceSection, string> = {
    plan: record.plan,
    warning_signs: record.warningSigns,
    residual_risk: record.residualRisk,
  };
  return clearanceSections.map((section) => ({
    section,
    title: clearanceSectionTitles[section],
    text: texts[section],
  }));
}

/** The acknowledgement page of an opened clearance link, read as its patient. */
export async function loadClearanceAcknowledgement(
  link: PatientLinkAccess,
  ip?: string,
): Promise<ClearancePage> {
  const adultAge = await getSetting('patients.adult_age_years');
  const { found, patient, guardians } = await asPatient(
    link,
    async (tx) => ({
      found: await clearanceAckForLink(tx),
      patient: await ownPatient(tx),
      guardians: await ownGuardians(tx),
    }),
    ip,
  );
  if (!found || !patient || found.clearances.length === 0) return { open: false, reason: 'none' };
  const asked = clearanceToAcknowledge(found);
  if (!asked) return { open: false, reason: 'done' };
  return {
    open: true,
    firstName: patient.name.split(/\s+/)[0] ?? patient.name,
    status: asked.status,
    title: clearanceAcknowledgementTitle(asked.status),
    sections: sectionsOf(asked),
    tick: clearanceTick.text,
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

const recordSchema = z.object({
  /** The clearance the page showed. */
  status: z.enum(acknowledgedClearances),
  signer: z.union([
    z.object({ signer: z.literal('patient') }),
    z.object({ signer: z.literal('guardian'), guardianId: z.guid() }),
  ]),
  signature: z.union([
    z.object({ kind: z.literal('drawn'), file: z.string().min(1) }),
    z.object({ kind: z.literal('typed'), name: z.string().min(2).max(100) }),
  ]),
});

export type ClearanceResult =
  | { status: 'saved' }
  /** The clearance asked now is not the one the page showed: the page shows the new one. */
  | { status: 'newer' }
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'guardian_needed' }
  | { status: 'link' };

/**
 * Records the acknowledgement as the patient, in one transaction: each section, ticked and signed,
 * with the words it showed and the tick's version; then the link is used. A newer clearance
 * signed since the page was shown: 'newer', and the page shows it with a note.
 */
const recordClearanceAcknowledgement = patientService({
  input: recordSchema,
  run: async (tx, { status, signer, signature }, link): Promise<ClearanceResult> => {
    const found = await clearanceAckForLink(tx);
    const asked = found ? clearanceToAcknowledge(found) : undefined;
    if (!found) return { status: 'link' };
    if (asked?.status !== status) return { status: asked ? 'newer' : 'link' };
    await insertConsentRecords(
      tx,
      sectionsOf(asked).map((card) => ({
        patientId: link.patientId,
        episodeId: found.episodeId,
        patientLinkId: link.id,
        stage: 'C' as const,
        statementKey: clearanceStatementKey(status, card.section),
        statementVersion: clearanceTick.version,
        shownText: card.text,
        accepted: true,
        signer: signer.signer,
        guardianId: signer.signer === 'guardian' ? signer.guardianId : null,
        signatureKind: signature.kind,
        signatureFile: signature.kind === 'drawn' ? signature.file : null,
        typedName: signature.kind === 'typed' ? signature.name : null,
      })),
    );
    await completePatientLink(tx, link);
    return { status: 'saved' };
  },
});

/**
 * "Done" on the acknowledgement page: who signs (INT-07), each section ticked, the signature; a
 * drawn signature is stored first, outside the transaction, and removed unless saved.
 */
export async function saveClearanceAcknowledgement(
  token: string,
  posted: Readonly<Record<string, string | readonly string[] | undefined>>,
  options: { ip?: string; store: SignatureStore },
): Promise<ClearanceResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'clearance') return { status: 'link' };
  const page = await loadClearanceAcknowledgement(opened.link, options.ip);
  if (!page.open) return { status: 'link' };
  if (posted.status !== page.status) return { status: 'newer' };
  const signer = parseSigner(
    {
      status: page.signing.status,
      guardianIds: page.signing.guardians.map((guardian) => guardian.id),
    },
    posted,
  );
  if (!signer.ok && signer.guardianNeeded) return { status: 'guardian_needed' };
  const parsed = parseClearanceAcknowledgement(posted);
  if (!parsed.ok || !signer.ok) {
    return {
      status: 'invalid',
      errors: { ...(signer.ok ? {} : signer.errors), ...(parsed.ok ? {} : parsed.errors) },
    };
  }
  const drawn = parsed.signature;
  const file =
    drawn.kind === 'drawn' ? `${opened.link.patientId}/${crypto.randomUUID()}.png` : undefined;
  if (file && drawn.kind === 'drawn') await options.store.put(file, drawn.png, 'image/png');
  try {
    const result = await recordClearanceAcknowledgement(
      opened.link,
      {
        status: page.status,
        signer:
          signer.signer === 'guardian'
            ? { signer: 'guardian', guardianId: signer.guardianId }
            : { signer: 'patient' },
        signature:
          drawn.kind === 'typed'
            ? { kind: 'typed', name: drawn.name }
            : { kind: 'drawn', file: file ?? '' },
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

const episodeInput = z.object({ episodeId: z.guid({ error: 'That episode was not found.' }) });

/**
 * Show the clearance QR (OUT-09) on Review and discharge: the episode's working clearance link,
 * or a new one, once a signed Return to training or Return to sport waits for the patient;
 * audited.
 */
export const showClearanceAcknowledgement = staffService({
  action: 'consultant_records.sign',
  input: episodeInput,
  target: async (input, tx: ServiceTransaction) => {
    const found = await episodeRecord(tx, input.episodeId);
    if (!found) throw new PatientLinkError('That episode was not found.');
    return { centreId: found.centreId };
  },
  run: async (tx, input): Promise<IssuedLink> => {
    const found = await clearanceAckForEpisode(tx, input.episodeId);
    const episode = await episodeRecord(tx, input.episodeId);
    if (!found || !episode) throw new PatientLinkError('That episode was not found.');
    if (!clearanceToAcknowledge(found)) {
      throw new PatientLinkError('Nothing waits for the patient to acknowledge.');
    }
    const live = await liveEpisodeLink(tx, input.episodeId, 'clearance');
    if (live) {
      const path = patientLinkPath({
        id: live.id,
        purpose: 'clearance',
        expiresAt: live.expiresAt,
      });
      if (!path) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
      return { linkId: live.id, path, expiresAt: live.expiresAt };
    }
    return issuePatientLink(tx, {
      patientId: episode.patientId,
      episodeId: input.episodeId,
      purpose: 'clearance',
    });
  },
});
