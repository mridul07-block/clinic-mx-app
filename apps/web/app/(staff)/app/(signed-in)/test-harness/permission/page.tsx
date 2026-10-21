import { actions, type Action } from '@clinic-mx/schemas';
import { notFound } from 'next/navigation';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { TryWrite } from './try-write';

// Permission test harness (end to end tests only; 404 unless CLINIC_MX_TEST_HARNESS=1): a page
// guarded by the action in `?action=`, the way each screen will be guarded by its own (IAM-04),
// with a write through a staffService for it (IAM-08).
export const dynamic = 'force-dynamic';

const isAction = (value: string | undefined): value is Action =>
  (actions as (string | undefined)[]).includes(value);

export default async function PermissionHarnessPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  if (!testHarnessEnabled() || !isAction(action)) notFound();
  const staff = await requirePermission(action);
  return (
    <main className="flex flex-col gap-4 px-4 py-6">
      <h1 className="text-title font-semibold">Allowed</h1>
      <p className="text-ink-secondary">
        {staff.name} may use {action}.
      </p>
      <TryWrite action={action} />
    </main>
  );
}
