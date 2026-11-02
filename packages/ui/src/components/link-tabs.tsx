import type { AnchorHTMLAttributes, ComponentType } from 'react';
import { cn } from '../cn';

/*
 * No 'use client': link tabs are plain links, so a server page renders them with Next's Link
 * passed as `linkAs` (a component cannot cross into a client file as a prop). tabs.tsx imports
 * the class recipes from here for the same reason: a string exported from a 'use client' file
 * reaches a server file as a client reference, not as the string.
 */

/** The row under the tabs: a `line` rule, scrolling sideways on a phone if it ever outgrows it. */
export const tabListClass = 'flex min-w-max gap-1 border-b border-line';

/**
 * An underline tab (design system v3 section 8, Tabs): 40 px high (44 on touch), weight 500,
 * `ink-muted` with a 2 px transparent bottom border; hover `ink`. The current one has a 2 px
 * `accent` underline and `ink` text (`data-active` from Base UI Tabs, `aria-current` on a link).
 */
export const tabClass = [
  '-mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-3 text-base font-medium whitespace-nowrap text-ink-muted pointer-coarse:h-11',
  'transition-colors duration-[var(--duration-quick)] hover:text-ink',
  'data-active:border-accent data-active:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink',
  'data-disabled:cursor-not-allowed data-disabled:text-ink-faint',
].join(' ');

/** A count beside a tab's label; `attention` puts it on the waiting tint (open alerts). */
export const tabCountClass = {
  neutral:
    'rounded-tag border border-line bg-surface-sunken px-1.5 text-sm font-medium text-ink-secondary tabular-nums',
  attention:
    'rounded-tag border border-waiting-line bg-waiting-soft px-1.5 text-sm font-medium text-waiting tabular-nums',
};

export interface LinkTab {
  key: string;
  label: string;
  href: string;
  /** A count beside the label; nothing when zero or absent. */
  count?: number;
  /** The count needs action (open alerts): waiting tint instead of grey. */
  attention?: boolean;
}

export interface LinkTabsProps {
  /** Names the row for screen readers ("Patient record"). */
  label: string;
  tabs: LinkTab[];
  /** The key of the tab whose page this is. */
  current: string;
  /** Next's Link for client navigation; a plain `<a>` by default. */
  linkAs?: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>;
  /** Layout only. */
  className?: string;
}

/**
 * Tabs that are links, for URL-driven tabs such as a patient record's: each tab has its own
 * address, so it can be shared and survives a reload; the current one carries
 * `aria-current="page"`. For tabs that switch content in place, use Tabs.
 */
export function LinkTabs({ label, tabs, current, linkAs, className }: LinkTabsProps) {
  const Anchor = linkAs ?? 'a';
  return (
    <nav aria-label={label} className={cn('overflow-x-auto', className)}>
      <ul className={tabListClass}>
        {tabs.map((tab) => (
          <li key={tab.key} className="flex">
            <Anchor
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
              className={tabClass}
            >
              {tab.label}
              {tab.count ? (
                <span className={tabCountClass[tab.attention ? 'attention' : 'neutral']}>
                  {tab.count}
                </span>
              ) : null}
            </Anchor>
          </li>
        ))}
      </ul>
    </nav>
  );
}
