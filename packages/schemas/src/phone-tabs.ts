import { accessScope, type Action, type StaffAccess } from './permissions';

/**
 * The bottom tab bar on phones (UI-01; Frontend Specification section 4, "Bottom tabs by role"):
 * each role's tabs, in the specification's order and words, each going to the screen built for it
 * and shown only to those who may open it; More is Home, which lists everything else. Recommended
 * defaults chosen under the user's approval, 29 October 2026 (DECISION UI-01;
 * docs/runbooks/navigation.md): the physiotherapist's Today is their calendar day and Notes their
 * Tasks inbox (no screen lists a physio's own unsigned notes; the nightly flag goes to the Centre
 * Manager, CLN-10); Finance's Bills is Collections; the Super Admin's Settings came with ADM-02.
 */

export const phoneTabIcons = [
  'today',
  'calendar',
  'patients',
  'my-patients',
  'notes',
  'alerts',
  'centres',
  'outcomes',
  'bills',
  'unpaid',
  'packages',
  'overview',
  'settings',
  'more',
] as const;
export type PhoneTabIcon = (typeof phoneTabIcons)[number];

export interface PhoneTab {
  label: string;
  href: string;
  icon: PhoneTabIcon;
  /** Paths that count as this tab, beyond its own. */
  also?: readonly string[];
}

interface TabRule extends PhoneTab {
  /** What one must be allowed to open it. */
  action: Action;
}

const tabsByRole: Record<StaffAccess['role'], readonly TabRule[]> = {
  front_desk: [
    { label: 'Today', href: '/app/today', icon: 'today', action: 'check_in.manage' },
    { label: 'Calendar', href: '/app/calendar', icon: 'calendar', action: 'calendar.view' },
    { label: 'Patients', href: '/app/patients', icon: 'patients', action: 'patients.view_contact' },
  ],
  physiotherapist: [
    { label: 'My patients', href: '/app/my-patients', icon: 'my-patients', action: 'visits.start' },
    { label: 'Today', href: '/app/calendar', icon: 'today', action: 'calendar.view' },
    { label: 'Notes', href: '/app/tasks', icon: 'notes', action: 'tasks.view' },
  ],
  centre_manager: [
    {
      label: 'Alerts',
      href: '/app/dashboard/alerts',
      icon: 'alerts',
      action: 'dashboard.clinical_operations',
    },
    {
      label: 'Centres',
      href: '/app/dashboard/centres',
      icon: 'centres',
      action: 'dashboard.clinical_operations',
    },
    {
      label: 'Outcomes',
      href: '/app/dashboard/outcomes',
      icon: 'outcomes',
      action: 'dashboard.clinical_operations',
    },
  ],
  finance: [
    {
      label: 'Bills',
      href: '/app/finance/collections',
      icon: 'bills',
      action: 'dashboard.finance',
      also: ['/app/finance/revenue', '/app/finance/refunds'],
    },
    { label: 'Unpaid', href: '/app/finance/unpaid', icon: 'unpaid', action: 'dashboard.finance' },
    {
      label: 'Packages',
      href: '/app/finance/packages',
      icon: 'packages',
      action: 'dashboard.finance',
    },
  ],
  super_admin: [
    { label: 'Overview', href: '/app/overview', icon: 'overview', action: 'dashboard.overview' },
    { label: 'Alerts', href: '/app/alerts', icon: 'alerts', action: 'red_flags.view' },
    { label: 'Settings', href: '/app/settings', icon: 'settings', action: 'settings.manage' },
  ],
};

/** "More": Home, which lists every screen the person may open. */
export const MORE_TAB: PhoneTab = { label: 'More', href: '/app', icon: 'more' };

/** The person's tabs: their role's, those they may open, then More. */
export function phoneTabsFor(staff: StaffAccess): PhoneTab[] {
  const own = tabsByRole[staff.role]
    // As the pages themselves check (`requirePermission`): any grant, one's own records included.
    .filter((tab) => accessScope(staff, tab.action) !== null)
    .map((tab): PhoneTab => ({ label: tab.label, href: tab.href, icon: tab.icon, also: tab.also }));
  return [...own, MORE_TAB];
}

/** The tab a path belongs to: the longest match among the tabs' own and extra paths. */
export function currentPhoneTab(tabs: readonly PhoneTab[], pathname: string): PhoneTab | undefined {
  let best: { tab: PhoneTab; length: number } | undefined;
  for (const tab of tabs) {
    for (const path of [tab.href, ...(tab.also ?? [])]) {
      const hit = pathname === path || (path !== '/app' && pathname.startsWith(`${path}/`));
      if (hit && (!best || path.length > best.length)) best = { tab, length: path.length };
    }
  }
  return best?.tab;
}

/**
 * Screens that pin their own actions at the bottom of a phone (the consultation's Back and Next,
 * Close session): the tab bar stands aside there.
 */
export const screensWithoutTabs: readonly RegExp[] = [
  /^\/app\/consultations\/[^/]+$/,
  /^\/app\/sessions\/[^/]+$/,
];

export function showsPhoneTabs(pathname: string): boolean {
  return !screensWithoutTabs.some((pattern) => pattern.test(pathname));
}
