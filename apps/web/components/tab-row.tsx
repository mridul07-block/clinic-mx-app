'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The scrolling row of `RecordTabs`: on a phone, where the row may outgrow the screen, the open tab
 * is scrolled into view, so it is never cut off at the edge (BIL-11 review: Finance's fifth tab).
 */
export function TabRow({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const box = row.current;
    if (!current || !box) return;
    const left = current.offsetLeft - box.offsetLeft;
    const right = left + current.offsetWidth;
    if (left < box.scrollLeft || right > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, right - box.clientWidth + 16);
    }
  });
  return (
    <nav ref={row} aria-label={label} className="-mx-4 overflow-x-auto px-4">
      {children}
    </nav>
  );
}
