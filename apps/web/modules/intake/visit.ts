import 'server-only';
import {
  healthFormVisit,
  ownConsentDecisions,
  ownIntakeResponse,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  currentHealthFormVersion,
  firstName,
  formatIstDateTime,
  healthFormOpen,
  healthForms,
  latestConsent,
  resumeAt,
  type HealthFormAnswer,
  type HealthFormDefinition,
} from '@clinic-mx/schemas';
import { asPatient } from '../access/patient-db';

/**
 * What the health form shows (INT-03, INT-04, user decisions 23 October 2026): the first name and
 * the visit, nothing else about the patient, and the form as saved so far, with where to carry
 * on. Closed unless the visit is on (Checked in or In consultation), so a cancelled, rescheduled,
 * missed or finished visit, or a check in undone, closes the link; checking in again opens it.
 */
export type HealthFormWelcome =
  | {
      open: true;
      firstName: string;
      when: string;
      centreName: string;
      physioName: string;
      form: HealthFormDefinition;
      answers: Record<string, HealthFormAnswer>;
      doneScreens: string[];
      /** The screen a returning patient carries on at, or the end. */
      resume: string;
      /** A screen has been saved: Continue rather than Start. */
      started: boolean;
      /** A Part A statement's latest decision is a decline (INT-06): the form waits. */
      consentDeclined: boolean;
    }
  | { open: false };

/** The form version a saved form belongs to, or the current one for a new form. */
export function formFor(version: string | undefined): HealthFormDefinition {
  const form = healthForms[version ?? currentHealthFormVersion];
  if (!form) throw new Error(`Health form version ${version ?? ''} is not kept.`);
  return form;
}

/** The visit and form of an opened health form link, read as its patient under row level security. */
export async function loadHealthFormVisit(
  link: PatientLinkAccess,
  ip?: string,
): Promise<HealthFormWelcome> {
  const { visit, saved, decisions } = await asPatient(
    link,
    async (tx) => ({
      visit: await healthFormVisit(tx),
      saved: await ownIntakeResponse(tx),
      decisions: await ownConsentDecisions(tx),
    }),
    ip,
  );
  if (!visit || !healthFormOpen(visit.status)) return { open: false };
  const form = formFor(saved?.formVersion);
  const answers = saved?.answers ?? {};
  const doneScreens = saved?.doneScreens ?? [];
  return {
    open: true,
    firstName: firstName(visit.patientName),
    when: formatIstDateTime(visit.startsAt),
    centreName: visit.centreName,
    physioName: visit.physioName,
    form,
    answers,
    doneScreens,
    resume: resumeAt(form, answers, doneScreens),
    started: saved !== undefined || decisions.length > 0,
    consentDeclined: latestConsent(decisions).declined,
  };
}
