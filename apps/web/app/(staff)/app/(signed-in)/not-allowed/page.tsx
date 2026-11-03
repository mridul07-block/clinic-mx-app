import type { Metadata } from 'next';
import Link from 'next/link';
import { primaryButtonClass } from '../../../../../components/forms';
import { Page } from '@clinic-mx/ui/components/page';

export const metadata: Metadata = { title: 'No access · Clinic Mx' };

// Where requirePermission sends someone whose role or ticks do not give them a page (IAM-04).
export default function NotAllowedPage() {
  return (
    <Page width="form">
      <h1 className="text-title font-semibold">You do not have access to this page</h1>
      <p className="text-ink-secondary">
        Your role does not include it. If you need it for your work, ask your Super Admin.
      </p>
      <Link href="/app" className={primaryButtonClass}>
        Go to home
      </Link>
    </Page>
  );
}
