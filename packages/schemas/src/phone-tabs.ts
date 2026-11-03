import { mainNavigationFor, type NavItem } from './navigation';
import { accessScope, type Action, type StaffAccess } from './permissions';

/**
 * The bottom tab bar on phones (UI-01): each role's daily screens in the same words as the sidebar
 * (the user's review, 3 November 2026), each shown only to those who may open it, then More,
 * Setup for the Super Admin, which lists everything else (docs/runbooks/navigation.md).
 */

export const phoneTabIcons = [
  'today',
  'calendar',
  'patients',
  'my-patients',
  'tasks',
  'finance',
  'prices',
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

const todo: TabRule = { label: 'To do', href: '/app/tasks', icon: 'tasks', action: 'tasks.view' };
const patients: TabRule = {
  label: 'Patients',
  href: '/app/patients',
  icon: 'patients',
  action: 'patients.view_contact',
};
const calendar: TabRule = {
  label: 'Calendar',
  href: '/app/calendar',
  icon: 'calendar',
  action: 'calendar.view',
};

const tabsByRole: Record<StaffAccess['role'], readonly TabRule[]> = {
  front_desk: [
    { label: 'Today', href: '/app/today', icon: 'today', action: 'check_in.manage' },
    calendar,
    patients,
    todo,
  ],
  physiotherapist: [
    { label: 'My day', href: '/app/my-patients', icon: 'my-patients', action: 'visits.start' },
    calendar,
    patients,
    todo,
  ],
  centre_manager: [
    {
      label: 'Home',
      href: '/app/dashboard/alerts',
      icon: 'overview',
      action: 'dashboard.clinical_operations',
    },
    calendar,
    patients,
    todo,
  ],
  finance: [
    {
      label: 'Money',
      href: '/app/finance/collections',
      icon: 'finance',
      action: 'dashboard.finance',
      also: ['/app/finance'],
    },
    patients,
    { label: 'Prices', href: '/app/prices', icon: 'prices', action: 'prices.view' },
    todo,
  ],
  super_admin: [
    { label: 'Home', href: '/app/overview', icon: 'overview', action: 'dashboard.overview' },
    calendar,
    patients,
    todo,
  ],
};

/** The person's tabs: their role's, those they may open, then More or Setup. */
export function phoneTabsFor(staff: StaffAccess): PhoneTab[] {
  const own = tabsByRole[staff.role]
    // As the pages themselves check (`requirePermission`): any grant, one's own records included.
    .filter((tab) => accessScope(staff, tab.action) !== null)
    .map((tab): PhoneTab => ({ label: tab.label, href: tab.href, icon: tab.icon, also: tab.also }));
  const more: PhoneTab =
    staff.role === 'super_admin'
      ? { label: 'Setup', href: '/app', icon: 'settings' }
      : { label: 'More', href: '/app', icon: 'more' };
  return [...own, more];
}

/**
 * Main links with no tab of their own, on a phone: More lists them first, so a phone reaches
 * everything a computer's sidebar does.
 */
export function mainLinksWithoutTab(staff: StaffAccess): NavItem[] {
  const tabs = new Set(phoneTabsFor(staff).map((tab) => tab.href));
  return mainNavigationFor(staff).filter((item) => !tabs.has(item.href));
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
