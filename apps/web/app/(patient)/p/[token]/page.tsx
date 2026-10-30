import {
  HEALTH_FORM_CHANGES,
  HEALTH_FORM_END,
  canOpen,
  consentStatements,
  patientLinkDefinitions,
  postedAnswer,
  previousScreen,
  screenLayout,
  stepOf,
  visibleOptions,
  visibleScreens,
  type HealthFormAnswer,
  type HealthFormRow,
  type PatientLinkPurpose,
} from '@clinic-mx/schemas';
import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { clientIp } from '../../../../modules/auth/session';
import { loadHealthFormVisit, type HealthFormWelcome } from '../../../../modules/intake/visit';
import {
  loadClearanceAcknowledgement,
  type ClearancePage,
} from '../../../../modules/consent/clearance';
import { loadPartB, type PartBPage } from '../../../../modules/consent/part-b';
import { kioskBrowser } from '../../../../modules/kiosk/device';
import {
  openPatientLink,
  patientLinkIdFromToken,
  type OpenedLink,
} from '../../../../modules/patient-links/services';
import {
  count,
  firstLimited,
  limited,
  networkKey,
  take,
} from '../../../../modules/rate-limits/limits';
import { loadFeedback } from '../../../../modules/feedback/services';
import { loadMyPlan, type MyPlanContent } from '../../../../modules/patient-links/my-plan';
import { reviewPageOf } from '../../../../modules/patient-links/review';
import {
  loadQuestionnaireStep,
  type QuestionnaireStep,
} from '../../../../modules/questionnaires/services';
import { getSetting } from '../../../../modules/settings/settings';
import type { FeedbackSurvey, FeedbackSurveyKey } from '@clinic-mx/schemas';
import { ChangesReview } from './changes-review';
import { CheckAndSubmit } from './check-submit';
import { ConsentScreenForm } from './consent-form';
import { FeedbackForm } from './feedback-form';
import { FirstTreatmentForm } from './first-treatment-form';
import { FollowUpForm } from './follow-up-form';
import { PartBConsentForm } from './part-b-form';
import { ClearanceAcknowledgementForm } from './clearance-form';
import { QuestionnaireForm } from './questionnaire-form';
import { HealthFormScreenForm } from './health-form';
import { KioskShell } from './kiosk-shell';
import { MyPlanPage } from './my-plan';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// Patient pages at /p/<token> (IAM-09). The signed, single purpose link is checked before any
// patient data is read: a forged or changed link never reaches the database. The pages for each
// purpose (health form, consent, My plan, questionnaires, feedback) come with their tickets;
// this page says where the link stands. data-voice="patient" sets the patient base size, 16 px
// (Frontend Specification section 1). Nothing alarming and no internal words for patients.
//
// On the clinic tablet (IAM-10, a browser with the kiosk cookie) the page opens only the form the
// front desk sent to that tablet; anything else goes back to the welcome screen. The kiosk shell
// returns there after a submit or when idle.
//
// A health form link (INT-03) opens the form for its own appointment only: the page reads that
// visit as the patient, under row level security, and greets them by first name. It is closed
// unless the visit is on, Checked in or In consultation (user decision, 23 October 2026).
//
// The health form itself (INT-04) is on this page too, one screen at a time (`?screen=<key>`, then
// `?screen=end`), so the tablet lock and the headers hold for every screen. Each screen is saved
// as it is sent; a returning patient is offered Continue and carries on where they stopped, and a
// screen not reached yet opens the one to carry on at. The end is Check and submit (INT-05);
// once submitted the link is used, and its page thanks the patient.
//
// Rate limits (IAM-11): every open counts against the network's opens, and a link that is not
// valid against its bad links. Over either, the page checks nothing and asks the patient to wait.
//
// A My plan link (PAT-01) opens the patient's page for their episode: the plan's week, the next
// visit, the exercises, the package and the pain line, read as the patient. A feedback link
// (PAT-04) opens the four questions after the consultation while its consultation is signed and
// unanswered.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Movementology Clinics',
  robots: { index: false, follow: false },
};

/**
 * What the page found: the link's state, a health form whose visit is not on (INT-03), or that
 * this network must wait (IAM-11).
 */
type Shown = OpenedLink | { status: 'closed'; purpose: PatientLinkPurpose } | { status: 'limited' };

function message(opened: Shown): { title: string; body: string } {
  const titleOf = (purpose: PatientLinkPurpose) => patientLinkDefinitions[purpose].title;
  switch (opened.status) {
    case 'valid':
      return {
        title: titleOf(opened.link.purpose),
        body:
          opened.link.purpose === 'health_form'
            ? 'It takes about 5 minutes.'
            : 'This page will open here.',
      };
    case 'closed':
      return {
        title: titleOf(opened.purpose),
        body:
          opened.purpose === 'my_plan'
            ? 'Your plan cannot be shown. Please ask the clinic.'
            : opened.purpose === 'consent'
              ? 'There is nothing to sign here now. Please ask the front desk.'
              : opened.purpose === 'clearance'
                ? 'There is nothing to acknowledge here now. Please ask your physiotherapist.'
                : opened.purpose === 'review'
                  ? 'This clinic has no review page yet. Thank you for thinking of us.'
                  : 'This form is no longer open. Please ask the front desk.',
      };
    case 'used':
      return {
        title: titleOf(opened.purpose),
        body:
          opened.purpose === 'health_form'
            ? 'Thank you. Your answers are with your physiotherapist.'
            : opened.purpose === 'consent'
              ? 'Thank you. Your consent is with the clinic.'
              : opened.purpose === 'clearance'
                ? 'Thank you. Your acknowledgement is with the clinic.'
                : opened.purpose === 'feedback' || opened.purpose === 'follow_up'
                  ? 'Thank you. Your feedback has reached the clinic.'
                  : opened.purpose === 'questionnaire'
                    ? 'Thank you. Your answers are with your physiotherapist.'
                    : 'You have already sent this. Thank you.',
      };
    case 'expired':
    case 'revoked':
      return {
        title: titleOf(opened.purpose),
        body: patientLinkDefinitions[opened.purpose].reissuedFromWhatsApp
          ? 'This link has expired. To get a new one, send "My plan" to Movementology Clinics on WhatsApp.'
          : 'This link has expired. Please ask the clinic for a new one.',
      };
    case 'invalid':
      return {
        title: 'We could not open this link',
        body: 'This link is not valid. Please ask the clinic for a new one.',
      };
    case 'limited':
      return {
        title: 'Please wait a moment',
        body: 'Too many tries. Please wait a few minutes and try again.',
      };
  }
}

/** On the tablet a finished or unusable form hands the tablet back; no WhatsApp hint. */
function kioskMessage(opened: Shown): { title: string; body: string } {
  switch (opened.status) {
    case 'valid':
      return message(opened);
    case 'used':
      return {
        title: 'Thank you',
        body: 'Your form has been sent. Please hand the tablet back to the front desk.',
      };
    default:
      return {
        title: 'We could not open this form',
        body: 'Please hand the tablet back to the front desk.',
      };
  }
}

/** Opens the link unless this network is over a limit; a link that is not valid is counted. */
async function openLimited(token: string, ip: string | undefined): Promise<Shown> {
  const network = networkKey(ip);
  const over = await firstLimited([
    limited('bad_links_per_network', network),
    take('link_opens_per_network', network),
  ]);
  if (over.limited) return { status: 'limited' };
  const opened = await openPatientLink(token, { ip });
  if (opened.status === 'invalid') await count('bad_links_per_network', network);
  return opened;
}

/** A screen's rows with only the options its earlier answers show (INT-05: pregnancy for female). */
function shownOptions(rows: HealthFormRow[], answers: Record<string, HealthFormAnswer>) {
  const shown = <F extends HealthFormRow['field']>(field: F): F =>
    field.kind === 'multi_choice'
      ? { ...field, options: visibleOptions(field.options, answers) }
      : field;
  return rows.map((row) => ({
    ...row,
    field: shown(row.field),
    followUps: row.followUps.map(shown),
  }));
}

/** A health form screen, the end, or nothing (the welcome), for an open form (INT-04). */
function healthFormScreen(
  token: string,
  welcome: Extract<HealthFormWelcome, { open: true }>,
  key: string | undefined,
  changing: boolean,
  guardianNeeded: boolean,
  reportMegabytes: number,
): ReactNode {
  if (!key) return null;
  const { form, answers, doneScreens, resume, returning } = welcome;
  const here = `/p/${token}`;
  const consentKeys = new Set(form.screens.filter((s) => s.consent).map((s) => s.key));
  // A returning patient (INT-08): "Has anything changed?" comes after Part A, before the rest.
  if (key === HEALTH_FORM_CHANGES) {
    if (!returning || ![...consentKeys].every((k) => doneScreens.includes(k))) {
      redirect(`${here}?screen=${resume}`);
    }
    return (
      <ChangesReview
        token={token}
        submittedOn={returning.submittedOn}
        details={returning.details}
        answered={returning.detailsChanged}
        backHref={`${here}?screen=${[...consentKeys][0] ?? ''}`}
      />
    );
  }
  const back = previousScreen(form, answers, key);
  const backTo = returning && back && consentKeys.has(back) ? HEALTH_FORM_CHANGES : back;
  const backHref = backTo ? `${here}?screen=${backTo}` : here;
  if (!canOpen(form, answers, doneScreens, key)) redirect(`${here}?screen=${resume}`);
  if (resume === HEALTH_FORM_CHANGES && !consentKeys.has(key)) {
    redirect(`${here}?screen=${HEALTH_FORM_CHANGES}`);
  }
  if (key === HEALTH_FORM_END) {
    return (
      <CheckAndSubmit
        token={token}
        form={form}
        answers={answers}
        reports={welcome.reports}
        backHref={backHref}
        detailsChanged={returning ? returning.detailsChanged : undefined}
      />
    );
  }
  const screen = visibleScreens(form, answers).find((s) => s.key === key);
  if (!screen) redirect(`${here}?screen=${resume}`);
  const { step, of } = stepOf(form, answers, key);
  const stepper = (
    <div className="flex flex-col gap-2">
      <p className="text-ink-secondary" data-testid="health-form-step">
        Step {step} of {of}
      </p>
      <div className="h-1 rounded-full bg-line" aria-hidden="true">
        <div
          className="h-1 rounded-full bg-brand"
          style={{ width: `${String(Math.round((step / of) * 100))}%` }}
        />
      </div>
    </div>
  );
  if (screen.consent) {
    // Part A consent (INT-06): after a decline the form waits for reception, unless the patient
    // chooses to change their answer. Under the adult age with no guardian on file (INT-07)
    // reception adds one first; when the age was only the patient's answer, they may change it.
    const { signing } = welcome;
    const noGuardian = signing.status === 'minor' && signing.guardians.length === 0;
    if ((welcome.consentDeclined || guardianNeeded || noGuardian) && !changing) {
      return (
        <>
          {stepper}
          <h1 className="text-xl font-semibold text-ink">{screen.title}</h1>
          <p className="text-lg text-ink" data-testid="consent-declined">
            Please speak to reception.
          </p>
          {noGuardian && !welcome.consentDeclined ? null : (
            <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
              <div className="mx-auto flex w-full max-w-signin">
                <Link
                  href={`${here}?screen=${screen.key}&change=1`}
                  className={`${patientSecondaryClass} flex-1`}
                >
                  Change my answer
                </Link>
              </div>
            </div>
          )}
        </>
      );
    }
    return (
      <>
        {stepper}
        <h1 className="text-xl font-semibold text-ink">{screen.title}</h1>
        <ConsentScreenForm
          token={token}
          screenKey={screen.key}
          cards={screen.consent.statements.map((statementKey) => ({
            key: statementKey,
            version: consentStatements[statementKey].version,
            text: consentStatements[statementKey].text,
          }))}
          signing={signing}
          backHref={backHref}
        />
      </>
    );
  }
  // About you starts from the record until the screen is sent (INT-05); a returning patient's
  // screens start from the details carried over (INT-08).
  const sent = doneScreens.includes(screen.key);
  const saved = Object.fromEntries(
    screen.fields.flatMap((field) => {
      const answer = answers[field.key] ?? (sent ? undefined : welcome.prefill[field.key]);
      return answer === undefined ? [] : [[field.key, postedAnswer(answer)]];
    }),
  );
  const filledIn =
    returning?.detailsChanged === true &&
    !sent &&
    screen.fields.some((field) => returning.carriedKeys.includes(field.key));
  return (
    <>
      {stepper}
      <h1 className="text-xl font-semibold text-ink">{screen.title}</h1>
      {filledIn ? (
        <p className="text-ink-secondary" data-testid="filled-in">
          Filled in from your last form. Change anything that is different.
        </p>
      ) : null}
      <HealthFormScreenForm
        token={token}
        screenKey={screen.key}
        rows={shownOptions(screenLayout(screen, answers), answers)}
        saved={saved}
        backHref={backHref}
        reports={
          screen.reports ? { maxMegabytes: reportMegabytes, added: welcome.reports } : undefined
        }
      />
    </>
  );
}

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    screen?: string;
    change?: string;
    guardian?: string;
    changed?: string;
    declined?: string;
    newer?: string;
  }>;
}) {
  const { token } = await params;
  const { screen: screenKey, change, guardian, changed, declined, newer } = await searchParams;
  const browser = await kioskBrowser();
  if (browser.status !== 'none') {
    const linkId = patientLinkIdFromToken(token);
    if (browser.status !== 'active' || !linkId || linkId !== browser.device.currentLinkId) {
      redirect('/kiosk');
    }
  }
  const kiosk = browser.status === 'active';
  const ip = await clientIp();
  const link = await openLimited(token, ip);
  let opened: Shown = link;
  let welcome: HealthFormWelcome | undefined;
  let myPlan: MyPlanContent | null = null;
  if (link.status === 'valid' && link.link.purpose === 'health_form') {
    welcome = await loadHealthFormVisit(link.link, ip);
    if (!welcome.open) opened = { status: 'closed', purpose: 'health_form' };
  }
  if (link.status === 'valid' && link.link.purpose === 'my_plan') {
    myPlan = await loadMyPlan(link.link, ip);
    if (!myPlan) opened = { status: 'closed', purpose: 'my_plan' };
  }
  let survey: { key: FeedbackSurveyKey; definition: FeedbackSurvey } | null = null;
  let firstTreatment = false;
  if (link.status === 'valid' && link.link.purpose === 'feedback') {
    const loaded = await loadFeedback(link.link, ip);
    if (!loaded.open || loaded.surveyKey === 'follow_up') {
      opened = { status: 'closed', purpose: 'feedback' };
    } else if (loaded.surveyKey === 'first_treatment') firstTreatment = true;
    else survey = { key: loaded.surveyKey, definition: loaded.survey };
  }
  // PAT-10: a follow up after discharge, for the interval due now.
  let followUp: string | null = null;
  if (link.status === 'valid' && link.link.purpose === 'follow_up') {
    const loaded = await loadFeedback(link.link, ip);
    if (loaded.open && loaded.surveyKey === 'follow_up') followUp = loaded.followUp;
    else opened = { status: 'closed', purpose: 'follow_up' };
  }
  // OUT-02: the plan's questionnaires, one after another, one question per screen.
  let questionnaire: QuestionnaireStep | undefined;
  if (link.status === 'valid' && link.link.purpose === 'questionnaire') {
    const step = await loadQuestionnaireStep(link.link, ip);
    if (step === 'done') opened = { status: 'used', purpose: 'questionnaire' };
    else if (!step) opened = { status: 'closed', purpose: 'questionnaire' };
    else questionnaire = step;
  }
  // BIL-03: Part B consent, through the episode's consent link.
  let partB: PartBPage | undefined;
  if (link.status === 'valid' && link.link.purpose === 'consent') {
    partB = await loadPartB(link.link, ip);
    if (!partB.open) {
      opened =
        partB.reason === 'done'
          ? { status: 'used', purpose: 'consent' }
          : { status: 'closed', purpose: 'consent' };
    }
  }
  // WA-06: the review request's button opens the centre's Google review page.
  if (link.status === 'valid' && link.link.purpose === 'review') {
    const page = await reviewPageOf(link.link);
    if (page) redirect(page);
    opened = { status: 'closed', purpose: 'review' };
  }
  // OUT-09: the clearance acknowledgement, through the episode's clearance link.
  let clearance: ClearancePage | undefined;
  if (link.status === 'valid' && link.link.purpose === 'clearance') {
    clearance = await loadClearanceAcknowledgement(link.link, ip);
    if (!clearance.open) {
      opened =
        clearance.reason === 'done'
          ? { status: 'used', purpose: 'clearance' }
          : { status: 'closed', purpose: 'clearance' };
    }
  }
  const shown = kiosk ? kioskMessage(opened) : message(opened);
  const { title } = shown;
  // Something declined on Part B: the desk speaks to the patient.
  const body =
    opened.status === 'used' && opened.purpose === 'consent' && declined === '1'
      ? `Thank you. You did not agree to everything; the front desk will speak to you about it.${
          kiosk ? ' Please hand the tablet back to the front desk.' : ''
        }`
      : shown.body;
  const formScreen = welcome?.open ? (
    healthFormScreen(
      token,
      welcome,
      screenKey,
      change === '1',
      guardian === 'needed',
      await getSetting('reports.max_file_mb'),
    )
  ) : survey ? (
    <FeedbackForm token={token} surveyKey={survey.key} survey={survey.definition} />
  ) : firstTreatment ? (
    <FirstTreatmentForm token={token} />
  ) : followUp ? (
    <FollowUpForm token={token} followUp={followUp} />
  ) : clearance?.open ? (
    <ClearanceAcknowledgementForm
      token={token}
      firstName={clearance.firstName}
      status={clearance.status}
      title={clearance.title}
      sections={clearance.sections}
      tick={clearance.tick}
      signing={clearance.signing}
      guardianNeeded={guardian === 'needed'}
      newer={newer === '1'}
    />
  ) : partB?.open ? (
    <PartBConsentForm
      token={token}
      firstName={partB.firstName}
      cards={partB.cards}
      awaiting={partB.awaiting}
      shown={partB.shown}
      signing={partB.signing}
      guardianNeeded={guardian === 'needed'}
    />
  ) : questionnaire ? (
    <QuestionnaireForm
      key={questionnaire.key}
      token={token}
      instrumentKey={questionnaire.key}
      kbVersionId={questionnaire.kbVersionId}
      name={questionnaire.name}
      definition={questionnaire.definition}
      number={questionnaire.number}
      of={questionnaire.of}
    />
  ) : null;
  const page = (
    <main data-voice="patient" className="min-h-dvh bg-surface px-4 py-6">
      <div className="mx-auto flex w-full max-w-signin flex-col gap-3">
        <p className="font-semibold text-ink-secondary">Movementology Clinics</p>
        {myPlan ? (
          <MyPlanPage plan={myPlan} now={new Date()} token={token} changed={changed === '1'} />
        ) : null}
        {myPlan
          ? null
          : (formScreen ?? (
              <>
                <h1 className="text-xl font-semibold text-ink">{title}</h1>
                {welcome?.open ? (
                  <div className="flex flex-col gap-1" data-testid="health-form-visit">
                    <p className="text-lg font-semibold text-ink">Hello {welcome.firstName}</p>
                    <p className="text-ink">{welcome.when}</p>
                    <p className="text-ink">
                      {welcome.centreName}, with {welcome.physioName}
                    </p>
                  </div>
                ) : null}
                <p
                  className="text-ink-secondary"
                  data-testid="patient-link-status"
                  data-status={opened.status}
                >
                  {body}
                </p>
                {welcome?.open ? (
                  <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
                    <div className="mx-auto flex w-full max-w-signin">
                      <Link
                        href={`/p/${token}?screen=${welcome.resume}`}
                        className={patientPrimaryClass}
                      >
                        {welcome.started ? 'Continue' : 'Start'}
                      </Link>
                    </div>
                  </div>
                ) : null}
              </>
            ))}
      </div>
    </main>
  );
  if (!kiosk) return page;
  const [idleSeconds, thankYouSeconds] = await Promise.all([
    getSetting('kiosk.idle_seconds'),
    getSetting('kiosk.thank_you_seconds'),
  ]);
  return (
    <KioskShell
      token={token}
      resetAfterSeconds={opened.status === 'valid' ? idleSeconds : thankYouSeconds}
      resetOnIdle={opened.status === 'valid'}
    >
      {page}
    </KioskShell>
  );
}
