import Link from 'next/link';
import type { ReactNode } from 'react';
import { NotificationsLink } from './notifications-link';
import { SearchButton } from './search-button';

// The top bar of every signed in screen (Frontend Specification section 4, design system v3
// section 7, UIX-12). On phones it is a sticky 56 px bar: the mark (home), search, notifications
// with the unread count, and the person menu with Account, the centre switch and Sign out, so a
// phone reaches all of them without going through More. From 768 px the rail or sidebar holds the
// logo, search, centres and the person, and the bar keeps notifications at the right.
export function TopBar({
  unread,
  findsPatients,
  personMenu,
}: {
  unread: number;
  findsPatients: boolean;
  /** The phone's person menu (PersonMenu with placement "top"). */
  personMenu: ReactNode;
}) {
  return (
    <header
      data-testid="top-bar"
      className="sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b border-line bg-surface px-2 pt-[env(safe-area-inset-top)] md:static md:min-h-12 md:px-4"
    >
      <Link
        href="/app"
        aria-label="Clinic Mx"
        className="flex size-11 items-center justify-center rounded-control hover:bg-surface-hover md:hidden"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG mark; next/image adds nothing for it */}
        <img src="/brand/movementology-mark.svg" alt="" width={28} height={28} />
      </Link>
      <div className="flex-1" />
      <div className="md:hidden">
        <SearchButton findsPatients={findsPatients} />
      </div>
      <NotificationsLink unread={unread} />
      <div className="md:hidden">{personMenu}</div>
    </header>
  );
}
