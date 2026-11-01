'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The link to the staff member's notifications on every page, with the unread count (INT-10). On
// the list itself the count is left off: opening the list marks what it shows read. In the top
// bar (UIX-12): a bell, with the word from 768 px.
export function NotificationsLink({ unread }: { unread: number }) {
  const shown = usePathname() === '/app/notifications' ? 0 : unread;
  return (
    <Link
      href="/app/notifications"
      aria-label={shown > 0 ? `Notifications, ${String(shown)} unread` : 'Notifications'}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-2 text-ink-secondary hover:bg-surface-hover hover:text-ink md:min-h-row md:justify-start md:text-accent md:underline-offset-2 md:hover:bg-transparent md:hover:underline md:pointer-coarse:min-h-12"
      data-testid="notifications-link"
    >
      <Bell aria-hidden size={20} strokeWidth={1.75} className="md:size-4" />
      <span className="hidden md:inline">Notifications</span>
      {shown > 0 ? (
        <span
          className="absolute top-1 right-0.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-xs leading-5 font-semibold text-on-danger md:static md:min-w-6 md:px-2"
          data-testid="notifications-unread"
        >
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
