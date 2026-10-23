import { notFound } from 'next/navigation';
import { EmergencyBanner } from '../../../../../../components/emergency-banner';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';

// Emergency banner test harness (end to end tests only; 404 unless CLINIC_MX_TEST_HARNESS=1): the
// banner every staff page shows for an open emergency (ALT-01), with a generated name.
export const dynamic = 'force-dynamic';

export default function EmergencyBannerHarnessPage() {
  if (!testHarnessEnabled()) notFound();
  return (
    <>
      <EmergencyBanner
        alert={{ id: 'harness', patientName: 'Test Patient Harness', href: '/app/patients' }}
      />
      <main className="px-4 py-6">
        <h1 className="text-title font-semibold">Today</h1>
      </main>
    </>
  );
}
