import { patientLinkDefinitions, type PatientLinkPurpose } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { kioskBrowser } from '../../../../modules/kiosk/device';
import {
  openPatientLink,
  patientLinkIdFromToken,
  type OpenedLink,
} from '../../../../modules/patient-links/services';
import { getSetting } from '../../../../modules/settings/settings';
import { KioskShell } from './kiosk-shell';

// Patient pages at /p/<token> (IAM-09). The signed, single purpose link is checked before any
// patient data is read: a forged or changed link never reaches the database. The pages for each
// purpose (health form, consent, My plan, questionnaires, feedback) come with their tickets;
// this page says where the link stands. data-voice="patient" sets the patient base size, 16 px
// (Frontend Specification section 1). Nothing alarming and no internal words for patients.
//
// On the clinic tablet (IAM-10, a browser with the kiosk cookie) the page opens only the form the
// front desk sent to that tablet; anything else goes back to the welcome screen. The kiosk shell
// returns there after a submit or when idle.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Movementology Clinics',
  robots: { index: false, follow: false },
};

function message(opened: OpenedLink): { title: string; body: string } {
  const titleOf = (purpose: PatientLinkPurpose) => patientLinkDefinitions[purpose].title;
  switch (opened.status) {
    case 'valid':
      return { title: titleOf(opened.link.purpose), body: 'This page will open here.' };
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
  }
}

/** On the tablet a finished or unusable form hands the tablet back; no WhatsApp hint. */
function kioskMessage(opened: OpenedLink): { title: string; body: string } {
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

export default async function PatientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const browser = await kioskBrowser();
  if (browser.status !== 'none') {
    const linkId = patientLinkIdFromToken(token);
    if (browser.status !== 'active' || !linkId || linkId !== browser.device.currentLinkId) {
      redirect('/kiosk');
    }
  }
  const kiosk = browser.status === 'active';
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const opened = await openPatientLink(token, { ip });
  const { title, body } = kiosk ? kioskMessage(opened) : message(opened);
  const page = (
    <main data-voice="patient" className="min-h-dvh bg-surface px-4 py-6">
      <div className="mx-auto flex w-full max-w-signin flex-col gap-3">
        <p className="font-semibold text-ink-secondary">Movementology Clinics</p>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p
          className="text-ink-secondary"
          data-testid="patient-link-status"
          data-status={opened.status}
        >
          {body}
        </p>
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
