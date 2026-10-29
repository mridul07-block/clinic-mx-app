'use client';

import {
  currentPhoneTab,
  showsPhoneTabs,
  type PhoneTab,
  type PhoneTabIcon,
} from '@clinic-mx/schemas';
import {
  Building2,
  CalendarCheck2,
  CalendarDays,
  ChartLine,
  Ellipsis,
  IndianRupee,
  LayoutDashboard,
  NotebookPen,
  Package,
  Receipt,
  Settings,
  Stethoscope,
  TriangleAlert,
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
  notes: NotebookPen,
  alerts: TriangleAlert,
  centres: Building2,
  outcomes: ChartLine,
  bills: Receipt,
  unpaid: IndianRupee,
  packages: Package,
  overview: LayoutDashboard,
  settings: Settings,
  more: Ellipsis,
};

export function PhoneTabBar({ tabs }: { tabs: readonly PhoneTab[] }) {
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
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={here ? 'page' : undefined}
                  className={[
                    'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs',
                    here ? 'font-semibold text-ink' : 'text-ink-secondary hover:text-ink',
                  ].join(' ')}
                >
                  {here ? (
                    <span
                      aria-hidden
                      className="absolute inset-x-4 top-0 h-[3px] rounded-b bg-brand"
                    />
                  ) : null}
                  <Icon
                    aria-hidden
                    size={18}
                    strokeWidth={1.75}
                    className={here ? 'text-ink' : 'text-ink-muted'}
                  />
                  <span>{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
