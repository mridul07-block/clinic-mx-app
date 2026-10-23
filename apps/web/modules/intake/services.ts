import 'server-only';
import {
  enqueueIntakeSubmitted,
  healthFormVisit,
  insertConsentRecords,
  insertPatientReport,
  ownGuardians,
  ownIntakeResponse,
  saveIntakeResponse,
  submitIntakeResponse,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  HEALTH_FORM_END,
  canOpen,
  consentStatements,
  reportContentTypes,
  reportExtensions,
  healthFormOpen,
  istDate,
  minorStatus,
  nextScreen,
  parseConsent,
  parseScreen,
  parseSigner,
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
import { checkReportFiles, ReportError } from '../front-desk/report-files';
import { reportStore, type ReportStore } from '../front-desk/report-store';
import { completePatientLink, verifyPatientLink } from '../patient-links/services';
import { processIntakeSubmission } from './pipeline';
import { getSetting } from '../settings/settings';
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
 *
 * History (INT-05) may carry report photos: checked, stored in the private `reports` bucket,
 * then recorded as the patient's reports in the same transaction as the screen, and removed
 * again if that fails. Check and submit submits the form once and completes its link.
 */
export type SaveScreenResult =
  | { status: 'saved'; next: string }
  | { status: 'invalid'; errors: Record<string, string> }
  /** A Part A statement declined (INT-06): the form waits for reception. */
  | { status: 'declined' }
  /** Under the adult age with no guardian on file (INT-07): reception adds one first. */
  | { status: 'guardian_needed' }
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
  /** Report photos already stored, to record with the screen (INT-05). */
  reports: z
    .array(
      z.object({
        id: z.guid(),
        filePath: z.string().min(1),
        contentType: z.enum(reportContentTypes),
        sizeBytes: z.int().positive(),
      }),
    )
    .default([]),
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
  run: async (tx, { screen: key, posted, reports }, link): Promise<SaveScreenResult> => {
    const found = await standing(tx, key);
    if (found.status !== 'open') return found;
    const { visit, form, answers, done, screen } = found;
    const parsed = parseScreen(screen, answers, posted, { today: istDate(new Date()) });
    if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
    if (reports.length > 0 && !screen.reports) return { status: 'invalid', errors: {} };
    for (const report of reports) {
      await insertPatientReport(tx, {
        ...report,
        patientId: link.patientId,
        appointmentId: visit.appointmentId,
        patientLinkId: link.id,
      });
    }
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

/**
 * Records the consent decisions, as the patient, in one transaction: a decline records the
 * declined statements (unsigned) and blocks; all agreed records every statement with the
 * signature and marks the consent screen done.
 */
const recordConsent = patientService({
  input: recordConsentSchema,
  run: async (
    tx,
    { screen: key, decisions, signer, signature },
    link,
  ): Promise<SaveScreenResult> => {
    const found = await standing(tx, key);
    if (found.status !== 'open') return found;
    const { visit, form, answers, done } = found;
    const declined = Object.entries(decisions).filter(([, accepted]) => !accepted);
    const base = {
      patientId: link.patientId,
      appointmentId: visit.appointmentId,
      patientLinkId: link.id,
      stage: 'A' as const,
      // The patient, or for a patient under the adult age the guardian on file who signs (INT-07).
      signer: signer.signer,
      guardianId: signer.signer === 'guardian' ? signer.guardianId : null,
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

/**
 * The consent screen: read the decisions and who signs (INT-07: a guardian on file for a patient
 * under the adult age), store a drawn signature, then record (INT-06).
 */
async function saveConsentScreen(
  link: PatientLinkAccess,
  key: string,
  statements: readonly string[],
  signing: Parameters<typeof parseSigner>[0],
  posted: Posted,
  ip: string | undefined,
  store: SignatureStore,
): Promise<SaveScreenResult> {
  const signer = parseSigner(signing, posted);
  if (!signer.ok && signer.guardianNeeded) return { status: 'guardian_needed' };
  const parsed = parseConsent(statements, posted);
  if (!parsed.ok || !signer.ok) {
    return {
      status: 'invalid',
      errors: { ...(signer.ok ? {} : signer.errors), ...(parsed.ok ? {} : parsed.errors) },
    };
  }
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
      ip,
    );
    if (file && result.status !== 'saved') await store.remove([file]);
    return result;
  } catch (error) {
    if (file) await store.remove([file]);
    throw error;
  }
}

/** What saving a screen may carry besides the answers, and where files go. */
export interface SaveScreenOptions {
  ip?: string;
  /** Report photos posted on History (INT-05). */
  files?: readonly File[];
  signatures?: SignatureStore;
  reports?: ReportStore;
}

/**
 * The screen with its report photos (INT-05): checked, stored first, outside the transaction,
 * and removed again unless the screen is saved.
 */
async function saveWithReports(
  link: PatientLinkAccess,
  key: string,
  posted: Posted,
  files: readonly File[],
  ip: string | undefined,
  store: ReportStore,
): Promise<SaveScreenResult> {
  let checked;
  try {
    checked = await checkReportFiles(files, await getSetting('reports.max_file_mb'));
  } catch (error) {
    if (error instanceof ReportError)
      return { status: 'invalid', errors: { reports: error.message } };
    throw error;
  }
  const reports: z.input<typeof saveScreenSchema>['reports'] = [];
  try {
    for (const file of checked) {
      const id = crypto.randomUUID();
      const filePath = `${link.patientId}/${id}.${reportExtensions[file.contentType]}`;
      await store.put(filePath, file.bytes, file.contentType);
      reports.push({
        id,
        filePath,
        contentType: file.contentType,
        sizeBytes: file.bytes.byteLength,
      });
    }
    const result = await saveScreen(link, { screen: key, posted, reports }, ip);
    if (result.status !== 'saved') await store.remove(reports.map((r) => r.filePath));
    return result;
  } catch (error) {
    await store.remove(reports.map((r) => r.filePath));
    throw error;
  }
}

/** Saves one screen of the health form behind `token`, as posted. */
export async function saveHealthFormScreen(
  token: string,
  screen: string,
  posted: Posted,
  { ip, files = [], signatures = signatureStore(), reports }: SaveScreenOptions = {},
): Promise<SaveScreenResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'health_form') return { status: 'link' };
  const { link } = opened;
  const adultAge = await getSetting('patients.adult_age_years');
  const found = await asPatient(
    link,
    async (tx) => ({ ...(await standing(tx, screen)), guardians: await ownGuardians(tx) }),
    ip,
  );
  if (found.status !== 'open')
    return found.status === 'elsewhere'
      ? { status: 'elsewhere', resume: found.resume }
      : { status: 'closed' };
  if (found.screen.consent) {
    const signing = {
      status: minorStatus(found.visit.dateOfBirth, adultAge, istDate(new Date())),
      guardianIds: found.guardians.map((guardian) => guardian.id),
    };
    return saveConsentScreen(
      link,
      screen,
      found.screen.consent.statements,
      signing,
      posted,
      ip,
      signatures,
    );
  }
  if (found.screen.reports && files.some((file) => file.size > 0)) {
    return saveWithReports(link, screen, posted, files, ip, reports ?? reportStore());
  }
  return saveScreen(link, { screen, posted }, ip);
}

export type SubmitResult =
  | { status: 'submitted' }
  /** Submitted by this request: the pipeline runs next (INT-10). */
  | { status: 'submitted_now'; appointmentId: string }
  /** Answers still needed: carry on where the form stands. */
  | { status: 'elsewhere'; resume: string }
  | { status: 'closed' }
  | { status: 'link' };

/**
 * Check and submit (INT-05): once every shown screen is complete, the form's submit time is now
 * and its single use link is completed, in one patient transaction. The answers then stay as
 * they are. The same transaction queues the submit pipeline (INT-10), so a submitted form always
 * gets its episode, alerts, precautions and notifications: the pipeline runs straight after, and
 * the job runs it again if that failed.
 */
const submit = patientService({
  input: z.object({}),
  run: async (tx, _input, link): Promise<SubmitResult> => {
    const visit = await healthFormVisit(tx);
    if (!visit || !healthFormOpen(visit.status)) return { status: 'closed' };
    const saved = await ownIntakeResponse(tx);
    if (saved?.submittedAt) return { status: 'submitted' };
    const form = formFor(saved?.formVersion);
    const answers = saved?.answers ?? {};
    const done = saved?.doneScreens ?? [];
    if (!saved || !canOpen(form, answers, done, HEALTH_FORM_END)) {
      return { status: 'elsewhere', resume: resumeAt(form, answers, done) };
    }
    await submitIntakeResponse(tx);
    await completePatientLink(tx, link);
    await enqueueIntakeSubmitted(tx, visit.appointmentId);
    return { status: 'submitted_now', appointmentId: visit.appointmentId };
  },
});

/** Submits the health form behind `token`; a link already used is a form already submitted. */
export async function submitHealthForm(token: string, ip?: string): Promise<SubmitResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status === 'used' && opened.purpose === 'health_form') return { status: 'submitted' };
  if (opened.status !== 'valid' || opened.link.purpose !== 'health_form') return { status: 'link' };
  const result = await submit(opened.link, {}, ip);
  if (result.status !== 'submitted_now') return result;
  try {
    await processIntakeSubmission(result.appointmentId);
  } catch {
    // The submit stands: the `intake.submitted` job it queued runs the pipeline again within a
    // minute, and after five failures it becomes a task for the Super Admin.
  }
  return { status: 'submitted' };
}
