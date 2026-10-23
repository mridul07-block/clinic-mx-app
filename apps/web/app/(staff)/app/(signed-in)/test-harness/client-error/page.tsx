import { notFound } from 'next/navigation';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';
import { FailingButton } from './failing-button';

// Error report test harness (end to end tests only; 404 unless CLINIC_MX_TEST_HARNESS=1): a
// button that fails in the browser with the generated fake patient details from the address, so
// the test can check the report sent to /monitoring holds none of them (FND-12). With ?fail=render
// the page fails while rendering instead, which shows the app's error page (app/global-error.tsx).
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | undefined>> };

export default async function ClientErrorHarnessPage({ searchParams }: Props) {
  if (!testHarnessEnabled()) notFound();
  const { name = '', phone = '', email = '', patient = '', fail } = await searchParams;
  if (fail === 'render') throw new Error('Error report harness failed while rendering');
  return (
    <main className="flex flex-col gap-4 px-4 py-6">
      <h1 className="text-title font-semibold">Error report</h1>
      <FailingButton details={{ name, phone, email, patient }} />
    </main>
  );
}
