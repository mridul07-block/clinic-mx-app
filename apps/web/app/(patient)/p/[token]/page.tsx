import {
  HEALTH_FORM_END,
  canOpen,
  patientLinkDefinitions,
  previousScreen,
  screenLayout,
  stepOf,
  visibleScreens,
  type HealthFormAnswer,
  type PatientLinkPurpose,
} from '@clinic-mx/schemas';
import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { clientIp } from '../../../../modules/auth/session';
import { loadHealthFormVisit, type HealthFormWelcome } from '../../../../modules/intake/visit';
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
import { getSetting } from '../../../../modules/settings/settings';
import { HealthFormScreenForm } from './health-form';
import { KioskShell } from './kiosk-shell';
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
// screen not reached yet opens the one to carry on at.
//
// Rate limits (IAM-11): every open counts against the network's opens, and a link that is not
// valid against its bad links. Over either, the page checks nothing and asks the patient to wait.
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
        body: 'This form is no longer open. Please ask the front desk.',
      };
    case 'used':
      return { title: titleOf(opened.purpose), body: 'You have already sent this. Thank you.' };
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

/** A saved answer as the form posts it back. */
function posted(answer: HealthFormAnswer): string | string[] {
  if (typeof answer === 'boolean') return answer ? 'yes' : 'no';
  if (typeof answer === 'number') return String(answer);
  return typeof answer === 'string' ? answer : [...answer];
}

/** A health form screen, the end, or nothing (the welcome), for an open form (INT-04). */
function healthFormScreen(
  token: string,
  welcome: Extract<HealthFormWelcome, { open: true }>,
  key: string | undefined,
): ReactNode {
  if (!key) return null;
  const { form, answers, doneScreens, resume } = welcome;
  const here = `/p/${token}`;
  const back = previousScreen(form, answers, key);
  const backHref = back ? `${here}?screen=${back}` : here;
  if (!canOpen(form, answers, doneScreens, key)) redirect(`${here}?screen=${resume}`);
  if (key === HEALTH_FORM_END) {
    return (
      <>
        <h1 className="text-xl font-semibold text-ink">Your health form</h1>
        <p className="text-ink" data-testid="health-form-end">
          Your answers are saved.
        </p>
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
          <div className="mx-auto flex w-full max-w-signin">
            <Link href={backHref} className={`${patientSecondaryClass} flex-1`}>
              Back
            </Link>
          </div>
        </div>
      </>
    );
  }
  const screen = visibleScreens(form, answers).find((s) => s.key === key);
  if (!screen) redirect(`${here}?screen=${resume}`);
  const { step, of } = stepOf(form, answers, key);
  const saved = Object.fromEntries(
    screen.fields.flatMap((field) => {
      const answer = answers[field.key];
      return answer === undefined ? [] : [[field.key, posted(answer)]];
    }),
  );
  return (
    <>
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
      <h1 className="text-xl font-semibold text-ink">{screen.title}</h1>
      <HealthFormScreenForm
        token={token}
        screenKey={screen.key}
        rows={screenLayout(screen, answers)}
        saved={saved}
        backHref={backHref}
      />
    </>
  );
}

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ screen?: string }>;
}) {
  const { token } = await params;
  const { screen: screenKey } = await searchParams;
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
  if (link.status === 'valid' && link.link.purpose === 'health_form') {
    welcome = await loadHealthFormVisit(link.link, ip);
    if (!welcome.open) opened = { status: 'closed', purpose: 'health_form' };
  }
  const { title, body } = kiosk ? kioskMessage(opened) : message(opened);
  const formScreen = welcome?.open ? healthFormScreen(token, welcome, screenKey) : null;
  const page = (
    <main data-voice="patient" className="min-h-dvh bg-surface px-4 py-6">
      <div className="mx-auto flex w-full max-w-signin flex-col gap-3">
        <p className="font-semibold text-ink-secondary">Movementology Clinics</p>
        {formScreen ?? (
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
        )}
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
