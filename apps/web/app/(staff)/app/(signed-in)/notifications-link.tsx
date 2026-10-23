'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The link to the staff member's notifications on every page, with the unread count (INT-10). On
// the list itself the count is left off: opening the list marks what it shows read.
export function NotificationsLink({ unread }: { unread: number }) {
  const shown = usePathname() === '/app/notifications' ? 0 : unread;
  return (
    <Link
      href="/app/notifications"
      aria-label={shown > 0 ? `Notifications, ${String(shown)} unread` : 'Notifications'}
      className="inline-flex min-h-row items-center gap-2 text-accent underline-offset-2 hover:underline pointer-coarse:min-h-12"
      data-testid="notifications-link"
    >
      Notifications
      {shown > 0 ? (
        <span
          className="min-w-6 rounded-full bg-danger px-2 text-center text-xs leading-5 font-semibold text-on-danger"
          data-testid="notifications-unread"
        >
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
