import { patientLinkDefinitions, type PatientLinkPurpose } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { openPatientLink, type OpenedLink } from '../../../../modules/patient-links/services';

// Patient pages at /p/<token> (IAM-09). The signed, single purpose link is checked before any
// patient data is read: a forged or changed link never reaches the database. The pages for each
// purpose (health form, consent, My plan, questionnaires, feedback) come with their tickets;
// this page says where the link stands. data-voice="patient" sets the patient base size, 16 px
// (Frontend Specification section 1). Nothing alarming and no internal words for patients.
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

export default async function PatientPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const opened = await openPatientLink(token, { ip });
  const { title, body } = message(opened);
  return (
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
}
