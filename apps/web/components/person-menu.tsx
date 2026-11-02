'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useDetailsClose } from './use-details-close';

// The person at the foot of the rail or sidebar (UI-02; design system v3 section 7): their
// initials on a sunken circle, and from 1280 px their name and role; it opens their menu, Account
// and Sign out, beside the sidebar so the rail never clips it. On phones the same menu sits at the
// right of the top bar (UIX-12), opening downwards, with the centre switch when there is one. It
// closes on Escape, a click elsewhere, or moving to another screen.

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export function PersonMenu({
  name,
  role,
  signOut,
  placement = 'side',
  extra,
}: {
  name: string;
  role: string;
  signOut: ReactNode;
  /** 'side': the rail or sidebar's foot; 'top': the phone top bar. */
  placement?: 'side' | 'top';
  /** More in the menu above Account, such as the centre switcher on phones. */
  extra?: ReactNode;
}) {
  const top = placement === 'top';
  const menu = useDetailsClose();

  return (
    <details
      ref={menu}
      data-testid={top ? 'top-person-menu' : 'person-menu'}
      className={top ? 'relative' : undefined}
    >
      {/* Named by the words it shows (WCAG 2.5.3): the name and role, read on the rail too,
          then "menu". */}
      <summary
        className={[
          'flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-control px-1 hover:bg-surface-hover [&::-webkit-details-marker]:hidden',
          top ? 'min-w-11' : 'xl:justify-start xl:px-2',
        ].join(' ')}
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunken text-sm font-semibold text-ink-secondary"
        >
          {initialsOf(name)}
        </span>
        <span className={top ? 'sr-only' : 'sr-only min-w-0 flex-col xl:not-sr-only xl:flex'}>
          <span className="truncate font-medium text-ink">{name}</span>
          {/* No comma between them: the account page already says "Name, Role". */}
          <span className="truncate text-sm text-ink-muted">{role}</span>
        </span>
        <span className="sr-only">: menu</span>
      </summary>
      <div
        className={[
          'z-50 flex w-60 flex-col gap-2 rounded-panel border border-line bg-surface p-3 shadow-float',
          top
            ? 'absolute top-full right-0 mt-2'
            : 'fixed bottom-3 left-[calc(var(--rail-width)+0.5rem)] xl:left-[calc(var(--sidebar-width)+0.5rem)]',
        ].join(' ')}
      >
        {top ? (
          <p className="flex flex-col border-b border-line pb-2">
            <span className="font-medium text-ink">{name}</span>
            <span className="text-sm text-ink-muted">{role}</span>
          </p>
        ) : null}
        {extra}
        <Link href="/app/account" className="text-accent underline underline-offset-2">
          Account
        </Link>
        {signOut}
      </div>
    </details>
  );
}
