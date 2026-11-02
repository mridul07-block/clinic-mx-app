'use client';

import {
  currentPhoneTab,
  showsPhoneTabs,
  type PhoneTab,
  type PhoneTabIcon,
} from '@clinic-mx/schemas';
import {
  CalendarCheck2,
  CalendarDays,
  Ellipsis,
  IndianRupee,
  LayoutDashboard,
  ListChecks,
  Receipt,
  Settings,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The bottom tab bar on phones (UI-01; Frontend Specification section 4): the role's tabs and More
// (Home), 18 px lucide icons in ink-muted over their words, the current tab in ink with a 3 px gold
// bar (design system v2's current-page mark). Phones only (below 768 px), and not on screens that
// pin their own actions at the bottom.

const icons: Record<PhoneTabIcon, LucideIcon> = {
  today: CalendarCheck2,
  calendar: CalendarDays,
  patients: Users,
  'my-patients': Stethoscope,
  tasks: ListChecks,
  finance: IndianRupee,
  prices: Receipt,
  overview: LayoutDashboard,
  settings: Settings,
  more: Ellipsis,
};

export function PhoneTabBar({
  tabs,
  counts,
}: {
  tabs: readonly PhoneTab[];
  /** Things needing action, by screen: a badge on the tab. */
  counts: Record<string, number>;
}) {
  const pathname = usePathname();
  if (!showsPhoneTabs(pathname)) return null;
  const current = currentPhoneTab(tabs, pathname);
  return (
    <>
      {/* Room at the end of every page, so the bar never covers its last lines. */}
      <div aria-hidden className="h-[calc(4rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        data-testid="phone-tab-bar"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map((tab) => {
            const Icon = icons[tab.icon];
            const here = current?.href === tab.href;
            const count = counts[tab.href] ?? 0;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={here ? 'page' : undefined}
                  className={[
                    'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-sm',
                    here ? 'font-semibold text-accent' : 'text-ink-secondary hover:text-ink',
                  ].join(' ')}
                >
                  {here ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-4 top-0 h-[3px] rounded-full bg-brand"
                    />
                  ) : null}
                  <Icon
                    aria-hidden
                    size={18}
                    strokeWidth={1.75}
                    className={here ? 'text-accent' : 'text-ink-muted'}
                  />
                  <span>{tab.label}</span>
                  {count > 0 ? (
                    <span
                      data-testid="tab-count"
                      data-volatile
                      className="absolute top-1 left-1/2 ml-2 min-w-5 rounded-full bg-accent px-1 text-center text-sm leading-5 font-normal text-on-accent tabular-nums"
                    >
                      <span className="sr-only">, </span>
                      {count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
