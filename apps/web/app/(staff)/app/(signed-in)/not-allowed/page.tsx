import type { Metadata } from 'next';
import Link from 'next/link';
import { primaryButtonClass } from '../../../../../components/forms';

export const metadata: Metadata = { title: 'No access · Clinic Mx' };

// Where requirePermission sends someone whose role or ticks do not give them a page (IAM-04).
export default function NotAllowedPage() {
  return (
    <main className="flex w-full max-w-signin flex-col gap-4 px-4 py-6">
      <h1 className="text-title font-semibold">You do not have access to this page</h1>
      <p className="text-ink-secondary">
        Your role does not include it. If you need it for your work, ask your Super Admin.
      </p>
      <Link href="/app" className={primaryButtonClass}>
        Go to home
      </Link>
    </main>
  );
}
