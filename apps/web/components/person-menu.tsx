'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useDetailsClose } from './use-details-close';

// The person at the foot of the rail or sidebar (UI-02; design system v2 section 7): their
// initials on a sunken circle, and from 1280 px their name and role; it opens their menu, Account
// and Sign out, beside the sidebar so the rail never clips it. It closes on Escape, a click
// elsewhere, or moving to another screen.

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
}: {
  name: string;
  role: string;
  signOut: ReactNode;
}) {
  const menu = useDetailsClose();

  return (
    <details ref={menu} data-testid="person-menu">
      <summary
        aria-label={`${name}, ${role}: menu`}
        className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-control px-1 hover:bg-surface-hover xl:justify-start xl:px-2 [&::-webkit-details-marker]:hidden"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunken text-xs font-semibold text-ink-secondary"
        >
          {initialsOf(name)}
        </span>
        <span aria-hidden className="hidden min-w-0 flex-col xl:flex">
          <span className="truncate font-medium text-ink">{name}</span>
          <span className="truncate text-xs text-ink-muted">{role}</span>
        </span>
      </summary>
      <div className="fixed bottom-3 left-[calc(var(--rail-width)+0.5rem)] z-50 flex w-60 flex-col gap-2 rounded-panel border border-line bg-surface p-3 shadow-float xl:left-[calc(var(--sidebar-width)+0.5rem)]">
        <Link href="/app/account" className="text-accent underline underline-offset-2">
          Account
        </Link>
        {signOut}
      </div>
    </details>
  );
}
