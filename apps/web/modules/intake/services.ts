import 'server-only';
import {
  healthFormVisit,
  insertConsentRecords,
  ownIntakeResponse,
  saveIntakeResponse,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  canOpen,
  consentStatements,
  healthFormOpen,
  nextScreen,
  parseConsent,
  parseScreen,
  pruneAnswers,
  resumeAt,
  visibleScreens,
  type ConsentSignature,
  type ConsentStatementKey,
  type HealthFormAnswer,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { asPatient } from '../access/patient-db';
import { patientService } from '../access/service';
import { verifyPatientLink } from '../patient-links/services';
import { signatureStore, type SignatureStore } from './signature-store';
import { formFor } from './visit';

/**
 * Saving the health form after each screen (INT-04, Frontend Specification §7: "progress saved
 * after every screen; leaving and returning resumes in place"). The link is checked first, then
 * one patient transaction: the visit must be on, the screen shown and reachable, every shown
 * field answered; answers a change has hidden are dropped. A saved form keeps its version.
 *
 * The consent screen (INT-06) records consent records instead of answers: every statement
 * agreed and signed opens the questions; a decline is recorded and blocks the form with "Please
 * speak to reception" until the patient changes their mind.
 */
export type SaveScreenResult =
  | { status: 'saved'; next: string }
  | { status: 'invalid'; errors: Record<string, string> }
  /** A Part A statement declined (INT-06): the form waits for reception. */
  | { status: 'declined' }
  /** Not this screen yet: carry on where the form stands. */
  | { status: 'elsewhere'; resume: string }
  /** The visit is not on (INT-03). */
  | { status: 'closed' }
  /** The link is not a working health form link; its page says why. */
  | { status: 'link' };

type Posted = Record<string, string | string[]>;

const saveScreenSchema = z.object({
  screen: z.string().min(1).max(40),
  posted: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

/** Where the form stands for a post: open, and the screen it may save. */
async function standing(tx: Parameters<Parameters<typeof asPatient>[1]>[0], key: string) {
  const visit = await healthFormVisit(tx);
  if (!visit || !healthFormOpen(visit.status)) return { status: 'closed' as const };
  const saved = await ownIntakeResponse(tx);
  const form = formFor(saved?.formVersion);
  const answers = saved?.answers ?? {};
  const done = saved?.doneScreens ?? [];
  const screen = visibleScreens(form, answers).find((s) => s.key === key);
  if (!screen || !canOpen(form, answers, done, key)) {
    return { status: 'elsewhere' as const, resume: resumeAt(form, answers, done) };
  }
  return { status: 'open' as const, visit, form, answers, done, screen };
}

const saveScreen = patientService({
  input: saveScreenSchema,
  run: async (tx, { screen: key, posted }, link): Promise<SaveScreenResult> => {
    const found = await standing(tx, key);
    if (found.status !== 'open') return found;
    const { visit, form, answers, done, screen } = found;
    const parsed = parseScreen(screen, answers, posted);
    if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
    const here = new Set(screen.fields.map((field) => field.key));
    const kept: Record<string, HealthFormAnswer> = Object.fromEntries(
      Object.entries(answers).filter(([field]) => !here.has(field)),
    );
    const next = pruneAnswers(form, { ...kept, ...parsed.answers });
    const shown = new Set(visibleScreens(form, next).map((s) => s.key));
    await saveIntakeResponse(tx, {
      appointmentId: visit.appointmentId,
      patientId: link.patientId,
      patientLinkId: link.id,
      formVersion: form.version,
      answers: next,
      doneScreens: [...new Set([...done, key])].filter((sent) => shown.has(sent)),
    });
    return { status: 'saved', next: nextScreen(form, next, key) };
  },
});

const recordConsentSchema = z.object({
  screen: z.string().min(1).max(40),
  decisions: z.record(z.string(), z.boolean()),
  signature: z
    .union([
      z.object({ kind: z.literal('drawn'), file: z.string().min(1) }),
      z.object({ kind: z.literal('typed'), name: z.string().min(2).max(100) }),
    ])
    .optional(),
});

/**
 * Records the consent decisions, as the patient, in one transaction: a decline records the
 * declined statements (unsigned) and blocks; all agreed records every statement with the
 * signature and marks the consent screen done.
 */
const recordConsent = patientService({
  input: recordConsentSchema,
  run: async (tx, { screen: key, decisions, signature }, link): Promise<SaveScreenResult> => {
    const found = await standing(tx, key);
    if (found.status !== 'open') return found;
    const { visit, form, answers, done } = found;
    const declined = Object.entries(decisions).filter(([, accepted]) => !accepted);
    const base = {
      patientId: link.patientId,
      appointmentId: visit.appointmentId,
      patientLinkId: link.id,
      stage: 'A' as const,
      signer: 'patient' as const,
    };
    const statement = (statementKey: string) => ({
      statementKey,
      statementVersion: consentStatements[statementKey as ConsentStatementKey].version,
    });
    if (declined.length > 0) {
      await insertConsentRecords(
        tx,
        declined.map(([statementKey]) => ({
          ...base,
          ...statement(statementKey),
          accepted: false,
        })),
      );
      return { status: 'declined' };
    }
    if (!signature) return { status: 'invalid', errors: {} };
    await insertConsentRecords(
      tx,
      Object.keys(decisions).map((statementKey) => ({
        ...base,
        ...statement(statementKey),
        accepted: true,
        signatureKind: signature.kind,
        signatureFile: signature.kind === 'drawn' ? signature.file : null,
        typedName: signature.kind === 'typed' ? signature.name : null,
      })),
    );
    await saveIntakeResponse(tx, {
      appointmentId: visit.appointmentId,
      patientId: link.patientId,
      patientLinkId: link.id,
      formVersion: form.version,
      answers: { ...answers },
      doneScreens: [...new Set([...done, key])],
    });
    return { status: 'saved', next: nextScreen(form, answers, key) };
  },
});

/** The consent screen: read the decisions, store a drawn signature, then record (INT-06). */
async function saveConsentScreen(
  link: PatientLinkAccess,
  key: string,
  statements: readonly string[],
  posted: Posted,
  ip: string | undefined,
  store: SignatureStore,
): Promise<SaveScreenResult> {
  const parsed = parseConsent(statements, posted);
  if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
  const drawn: ConsentSignature | undefined = parsed.signature;
  // A drawn signature is stored first, outside the transaction, and removed if recording fails.
  const file = drawn?.kind === 'drawn' ? `${link.patientId}/${crypto.randomUUID()}.png` : undefined;
  if (file && drawn?.kind === 'drawn') await store.put(file, drawn.png, 'image/png');
  try {
    const result = await recordConsent(
      link,
      {
        screen: key,
        decisions: parsed.decisions,
        signature:
          drawn?.kind === 'typed'
            ? { kind: 'typed', name: drawn.name }
            : file
              ? { kind: 'drawn', file }
              : undefined,
      },
      ip,
    );
    if (file && result.status !== 'saved') await store.remove([file]);
    return result;
  } catch (error) {
    if (file) await store.remove([file]);
    throw error;
  }
}

/** Saves one screen of the health form behind `token`, as posted. */
export async function saveHealthFormScreen(
  token: string,
  screen: string,
  posted: Posted,
  ip?: string,
  store: SignatureStore = signatureStore(),
): Promise<SaveScreenResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'health_form') return { status: 'link' };
  const { link } = opened;
  const found = await asPatient(link, (tx) => standing(tx, screen), ip);
  if (found.status !== 'open') return found;
  if (found.screen.consent) {
    return saveConsentScreen(link, screen, found.screen.consent.statements, posted, ip, store);
  }
  return saveScreen(link, { screen, posted }, ip);
}
