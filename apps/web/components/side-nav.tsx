'use client';

import {
  currentNavItem,
  navigationBySection,
  type NavIcon,
  type NavItem,
} from '@clinic-mx/schemas';
import {
  BookOpen,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CalendarOff,
  ChartColumn,
  ChartLine,
  ClipboardList,
  Clock,
  FileLock,
  FileText,
  History,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  Package,
  Receipt,
  Search,
  Settings,
  ShieldAlert,
  Stethoscope,
  Tablet,
  TriangleAlert,
  UserCog,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

// The tablet rail and the desktop sidebar (UI-02; Frontend Specification section 4, design system
// v2 section 7). From 768 px a 64 px rail of 18 px icons, names in tooltips with a mouse and small
// words under them on touch; from 1280 px a 240 px sidebar on the canvas: the logo, the centre
// switcher, Search or jump to, the person's screens by section, their menu at the foot. The
// current screen sits on a white pill with a 3 px gold bar on its left edge.

const icons: Record<NavIcon, LucideIcon> = {
  tasks: ListChecks,
  'my-patients': Stethoscope,
  today: CalendarCheck2,
  calendar: CalendarDays,
  patients: Users,
  centres: Building2,
  team: UsersRound,
  leave: CalendarOff,
  'appointment-types': Clock,
  ai: ClipboardList,
  alerts: TriangleAlert,
  'red-flags': ShieldAlert,
  'knowledge-base': BookOpen,
  templates: MessageSquareText,
  packages: Package,
  prices: Receipt,
  staff: UserCog,
  support: KeyRound,
  settings: Settings,
  audit: History,
  'opening-entries': FileText,
  overview: LayoutDashboard,
  dashboard: ChartLine,
  finance: IndianRupee,
  figures: ChartColumn,
  kiosk: Tablet,
  'data-requests': FileLock,
};

export function SideNav({
  items,
  counts,
  centreSwitcher,
  railCentreSwitcher,
  personMenu,
  onSearch,
}: {
  items: readonly NavItem[];
  /** Things needing action, by screen: shown beside its name, or as a badge on the rail. */
  counts: Record<string, number>;
  centreSwitcher: ReactNode;
  /** The centre switcher's rail form, 768 to 1279 px (UI-03). */
  railCentreSwitcher: ReactNode;
  personMenu: ReactNode;
  onSearch: () => void;
}) {
  const pathname = usePathname();
  const current = currentNavItem(items, pathname);
  return (
    <div
      className="sticky top-0 hidden h-dvh w-rail shrink-0 flex-col gap-3 overflow-y-auto bg-canvas px-2 py-3 md:flex xl:w-sidebar xl:px-3"
      data-testid="side-nav"
    >
      <Link href="/app" className="flex h-8 items-center justify-center xl:justify-start xl:px-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; the image optimiser adds nothing */}
        <img
          src="/brand/movementology-mark.svg"
          alt="Movementology"
          className="h-6 w-6 xl:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
        <img
          src="/brand/movementology-logo.svg"
          alt="Movementology"
          className="hidden h-5 w-auto xl:block"
        />
      </Link>
      <div className="hidden xl:block">{centreSwitcher}</div>
      {railCentreSwitcher ? <div className="xl:hidden">{railCentreSwitcher}</div> : null}
      <button
        type="button"
        onClick={onSearch}
        aria-keyshortcuts="Control+K"
        title="Search or jump to (Ctrl K)"
        className="flex min-h-11 items-center justify-center gap-2 rounded-control border border-line-control bg-surface px-2 text-ink-secondary shadow-xs hover:text-ink xl:min-h-row xl:justify-start xl:pointer-coarse:min-h-row-touch"
      >
        <Search aria-hidden size={16} strokeWidth={1.75} className="text-ink-muted" />
        <span className="sr-only">Search or jump to</span>
        <span aria-hidden className="hidden flex-1 text-left xl:inline">
          Search or jump to
        </span>
        <kbd
          aria-hidden
          className="hidden h-5 items-center rounded-tag border border-line px-1 font-mono text-xs text-ink-muted xl:inline-flex"
        >
          Ctrl K
        </kbd>
      </button>
      <nav aria-label="Main" className="flex flex-col gap-3">
        {navigationBySection(items).map((group) => (
          <div
            key={group.section}
            role="group"
            aria-label={group.label}
            className="flex flex-col gap-0.5"
          >
            <p className="hidden px-2 pt-1 text-xs text-ink-muted xl:block">{group.label}</p>
            <hr className="mx-2 border-line xl:hidden" />
            {group.items.map((item) => {
              const Icon = icons[item.icon];
              const here = current?.href === item.href;
              const count = counts[item.href] ?? 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={here ? 'page' : undefined}
                  title={item.label}
                  className={[
                    'relative flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-control border px-1 text-ink-secondary',
                    'xl:min-h-8 xl:flex-row xl:justify-start xl:gap-2.5 xl:px-2 xl:pointer-coarse:min-h-row-touch',
                    here
                      ? 'border-line bg-surface font-medium text-ink shadow-xs'
                      : 'border-transparent hover:bg-surface-hover hover:text-ink',
                  ].join(' ')}
                >
                  {here ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-brand"
                    />
                  ) : null}
                  {/* The name, for screen readers; the words shown are a picture of it. */}
                  <span className="sr-only">
                    {count > 0 ? `${item.label}, ${String(count)}` : item.label}
                  </span>
                  <Icon
                    aria-hidden
                    size={18}
                    strokeWidth={1.75}
                    className={here ? 'text-ink' : 'text-ink-muted'}
                  />
                  <span aria-hidden className="hidden flex-1 truncate xl:inline">
                    {item.label}
                  </span>
                  <span
                    aria-hidden
                    className="hidden max-w-full truncate text-xs pointer-coarse:block xl:pointer-coarse:hidden"
                  >
                    {item.label}
                  </span>
                  {count > 0 ? (
                    <span
                      aria-hidden
                      className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-ink px-1 text-center text-xs leading-4 text-surface xl:static xl:bg-transparent xl:px-0 xl:text-ink-muted"
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="mt-auto">{personMenu}</div>
    </div>
  );
}
