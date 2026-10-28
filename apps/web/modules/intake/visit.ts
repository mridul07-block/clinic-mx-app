import 'server-only';
import {
  healthFormCarrySource,
  healthFormVisit,
  ownConsentDecisions,
  ownGuardians,
  ownIntakeResponse,
  ownReports,
  type DbOrTransaction,
  type HealthFormVisit,
  type IntakeResponse,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import {
  HEALTH_FORM_CHANGES,
  carriedDetails,
  carriedFieldKeys,
  currentHealthFormVersion,
  detailsReviewDue,
  detailsShown,
  firstName,
  formatIstDate,
  formatIstDateTime,
  guardianRelationshipLabels,
  healthFormOpen,
  istDate,
  minorStatus,
  healthForms,
  latestConsent,
  resumeAt,
  type HealthFormAnswer,
  type HealthFormAnswers,
  type HealthFormDefinition,
  type MinorStatus,
} from '@clinic-mx/schemas';
import { asPatient } from '../access/patient-db';
import { getSetting } from '../settings/settings';

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
      /** Who signs Part A (INT-07): under the adult age a guardian on file; unknown asks. */
      signing: {
        status: MinorStatus;
        adultAge: number;
        guardians: { id: string; label: string }[];
      };
      /**
       * About you starts from the record (INT-05), and a returning patient's screens from the
       * details carried over (INT-08): by field, until the screen is sent.
       */
      prefill: Record<string, HealthFormAnswer>;
      /** A returning patient (INT-08): the details carried over, and their answer so far. */
      returning: {
        submittedOn: string;
        details: ReturnType<typeof detailsShown>;
        /** The fields with a carried answer. */
        carriedKeys: string[];
        detailsChanged: boolean | null;
      } | null;
      /** Report photos added on this form (INT-05). */
      reports: number;
    }
  | { open: false };

/** The form version a saved form belongs to, or the current one for a new form. */
export function formFor(version: string | undefined): HealthFormDefinition {
  const form = healthForms[version ?? currentHealthFormVersion];
  if (!form) throw new Error(`Health form version ${version ?? ''} is not kept.`);
  return form;
}

/** What is on the patient record for About you (INT-05), by field. */
function onFile(visit: HealthFormVisit): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      date_of_birth: visit.dateOfBirth,
      sex: visit.sex,
      occupation: visit.occupation,
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  );
}

/** A returning patient's form (INT-08): the earlier form, the details it carries, the answer. */
export interface ReturningForm {
  sourceId: string;
  submittedAt: Date;
  details: Record<string, HealthFormAnswer>;
  detailsChanged: boolean | null;
}

/**
 * Whether the page's patient is returning (INT-08), read as the patient: their latest submitted
 * form for another visit within `intake.carry_over_months` (or the one already reviewed) gives
 * details to carry over. Null for a first form, or when the earlier one gives nothing.
 */
export async function returningForm(
  tx: DbOrTransaction,
  form: HealthFormDefinition,
  saved: IntakeResponse | undefined,
  visit: HealthFormVisit,
): Promise<ReturningForm | null> {
  const months = await getSetting('intake.carry_over_months');
  const source = await healthFormCarrySource(tx, carriedFieldKeys, months, saved?.carriedFromId);
  if (!source) return null;
  const details = carriedDetails(form, source.answers, onFile(visit), {
    today: istDate(new Date()),
  });
  if (Object.keys(details).length === 0) return null;
  return {
    sourceId: source.id,
    submittedAt: source.submittedAt,
    details,
    detailsChanged: saved?.detailsChanged ?? null,
  };
}

/** Where the form carries on: "Has anything changed?" while due (INT-08), else the screens. */
export function resumeFor(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  done: readonly string[],
  returning: ReturningForm | null,
): string {
  return returning && detailsReviewDue(form, returning.detailsChanged, done)
    ? HEALTH_FORM_CHANGES
    : resumeAt(form, answers, done);
}

/** The visit and form of an opened health form link, read as its patient under row level security. */
export async function loadHealthFormVisit(
  link: PatientLinkAccess,
  ip?: string,
): Promise<HealthFormWelcome> {
  const adultAge = await getSetting('patients.adult_age_years');
  const { visit, saved, decisions, guardians, reports, returning } = await asPatient(
    link,
    async (tx) => {
      const visit = await healthFormVisit(tx);
      const saved = await ownIntakeResponse(tx);
      return {
        visit,
        saved,
        decisions: await ownConsentDecisions(tx),
        guardians: await ownGuardians(tx),
        reports: await ownReports(tx),
        returning:
          visit && healthFormOpen(visit.status)
            ? await returningForm(tx, formFor(saved?.formVersion), saved, visit)
            : null,
      };
    },
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
    resume: resumeFor(form, answers, doneScreens, returning),
    // A form started by the desk in assisted mode (INT-09) has no screen yet: Start.
    started: doneScreens.length > 0 || decisions.length > 0,
    consentDeclined: latestConsent(decisions).declined,
    signing: {
      status: minorStatus(visit.dateOfBirth, adultAge, istDate(new Date())),
      adultAge,
      guardians: guardians.map((guardian) => ({
        id: guardian.id,
        label: `${guardian.name}, ${guardianRelationshipLabels[guardian.relationship]}`,
      })),
    },
    prefill: { ...returning?.details, ...onFile(visit) },
    returning: returning && {
      submittedOn: formatIstDate(istDate(returning.submittedAt)),
      details: detailsShown(form, returning.details),
      carriedKeys: Object.keys(returning.details),
      detailsChanged: returning.detailsChanged,
    },
    reports: reports.length,
  };
}
