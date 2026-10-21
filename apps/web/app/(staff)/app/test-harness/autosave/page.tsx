import { notFound } from 'next/navigation';
import { readTestNote, testHarnessEnabled } from '../../../../../lib/drafts/test-harness-store';
import { AutosaveNote } from './autosave-note';

// Autosave test harness (end to end tests only; 404 unless CLINIC_MX_TEST_HARNESS=1): one note
// that autosaves, the way a consultation section will (CLN-02).
export const dynamic = 'force-dynamic';

export default async function AutosaveHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  if (!testHarnessEnabled()) notFound();
  const id = (await searchParams).id ?? 'note';
  const note = readTestNote(id);
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <AutosaveNote id={id} serverValue={note.value} serverVersion={note.version} />
    </main>
  );
}
