import { auditPartsFor } from './audit-log';
import { accessScope, type Action, type StaffAccess } from './permissions';

/**
 * Every staff screen one navigates to, once (UI-02): Home lists them, the tablet rail and the
 * desktop sidebar show them by section (Frontend Specification section 4, design system v2
 * section 7), and Search or jump to (Ctrl K) finds them. Each shows only to those who may open it,
 * the same check the page makes. Recommended defaults chosen under the user's standing approval,
 * 29 October 2026 (DECISION UI-02; docs/runbooks/navigation.md).
 */

export const navSections = ['daily', 'clinical', 'figures', 'setup'] as const;
export type NavSection = (typeof navSections)[number];

export const navSectionLabels: Record<NavSection, string> = {
  daily: 'Day to day',
  clinical: 'Clinical',
  figures: 'Figures',
  setup: 'Setup',
};

export const navIcons = [
  'tasks',
  'my-patients',
  'today',
  'calendar',
  'patients',
  'centres',
  'team',
  'leave',
  'appointment-types',
  'ai',
  'alerts',
  'red-flags',
  'knowledge-base',
  'templates',
  'packages',
  'prices',
  'staff',
  'support',
  'settings',
  'audit',
  'opening-entries',
  'overview',
  'dashboard',
  'finance',
  'figures',
  'kiosk',
  'data-requests',
] as const;
export type NavIcon = (typeof navIcons)[number];

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  section: NavSection;
}

interface NavRule extends NavItem {
  /** Who may open it: an action any grant of which will do, or a rule of its own. */
  may: Action | ((staff: StaffAccess) => boolean);
}

// In Home's order, Home's words.
const navRules: readonly NavRule[] = [
  { label: 'Tasks', href: '/app/tasks', icon: 'tasks', section: 'daily', may: 'tasks.view' },
  {
    label: 'My patients today',
    href: '/app/my-patients',
    icon: 'my-patients',
    section: 'daily',
    may: 'visits.start',
  },
  { label: 'Today', href: '/app/today', icon: 'today', section: 'daily', may: 'check_in.manage' },
  {
    label: 'Calendar',
    href: '/app/calendar',
    icon: 'calendar',
    section: 'daily',
    may: 'calendar.view',
  },
  {
    label: 'Patients',
    href: '/app/patients',
    icon: 'patients',
    section: 'daily',
    may: 'patients.view_contact',
  },
  {
    label: 'Centres',
    href: '/app/centres',
    icon: 'centres',
    section: 'setup',
    may: 'centres.manage',
  },
  { label: 'Team', href: '/app/team', icon: 'team', section: 'setup', may: 'rosters.manage' },
  {
    label: 'My leave',
    href: '/app/leave',
    icon: 'leave',
    section: 'daily',
    may: (staff) => accessScope(staff, 'leave.manage') !== null && staff.treatsPatients,
  },
  {
    label: 'Appointment types',
    href: '/app/appointment-types',
    icon: 'appointment-types',
    section: 'setup',
    may: 'settings.manage',
  },
  {
    label: 'AI preparation sheet',
    href: '/app/ai-preparation-sheet',
    icon: 'ai',
    section: 'setup',
    may: 'settings.manage',
  },
  { label: 'Alerts', href: '/app/alerts', icon: 'alerts', section: 'daily', may: 'red_flags.view' },
  {
    label: 'Red flags',
    href: '/app/red-flags',
    icon: 'red-flags',
    section: 'clinical',
    may: 'knowledge_base.view',
  },
  {
    label: 'Knowledge base',
    href: '/app/knowledge-base',
    icon: 'knowledge-base',
    section: 'clinical',
    may: 'knowledge_base.view',
  },
  {
    label: 'WhatsApp templates',
    href: '/app/templates',
    icon: 'templates',
    section: 'setup',
    may: 'templates.manage',
  },
  {
    label: 'Packages',
    href: '/app/packages',
    icon: 'packages',
    section: 'daily',
    may: 'bills.view_amounts',
  },
  { label: 'Prices', href: '/app/prices', icon: 'prices', section: 'setup', may: 'prices.view' },
  { label: 'Staff', href: '/app/staff', icon: 'staff', section: 'setup', may: 'staff.manage' },
  {
    label: 'Support access',
    href: '/app/support-access',
    icon: 'support',
    section: 'setup',
    may: 'support_access.grant',
  },
  {
    label: 'Settings',
    href: '/app/settings',
    icon: 'settings',
    section: 'setup',
    may: 'settings.manage',
  },
  {
    label: 'Audit log',
    href: '/app/audit',
    icon: 'audit',
    section: 'setup',
    may: (staff) => auditPartsFor(staff).length > 0,
  },
  {
    label: 'Opening entries',
    href: '/app/opening-entries',
    icon: 'opening-entries',
    section: 'setup',
    may: 'opening_entries.manage',
  },
  {
    label: 'Overview',
    href: '/app/overview',
    icon: 'overview',
    section: 'figures',
    may: 'dashboard.overview',
  },
  {
    label: 'Dashboard',
    href: '/app/dashboard',
    icon: 'dashboard',
    section: 'figures',
    may: 'dashboard.clinical_operations',
  },
  {
    label: 'Finance',
    href: '/app/finance',
    icon: 'finance',
    section: 'figures',
    may: 'dashboard.finance',
  },
  {
    label: 'Figures',
    href: '/app/figures',
    icon: 'figures',
    section: 'figures',
    may: 'dashboard.overview',
  },
  {
    label: 'Data requests',
    href: '/app/data-requests',
    icon: 'data-requests',
    section: 'setup',
    may: 'data_requests.manage',
  },
  {
    label: 'Kiosk tablets',
    href: '/app/kiosk-tablets',
    icon: 'kiosk',
    section: 'setup',
    may: 'check_in.manage',
  },
];

/** The screens a person may open, in Home's order. Account and signing out are in their menu. */
export function navigationFor(staff: StaffAccess): NavItem[] {
  return navRules
    .filter((rule) =>
      typeof rule.may === 'function' ? rule.may(staff) : accessScope(staff, rule.may) !== null,
    )
    .map(({ label, href, icon, section }) => ({ label, href, icon, section }));
}

/** The items by section, sections in order, empty ones left out. */
export function navigationBySection(
  items: readonly NavItem[],
): { section: NavSection; label: string; items: NavItem[] }[] {
  return navSections
    .map((section) => ({
      section,
      label: navSectionLabels[section],
      items: items.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);
}

/** The item a path belongs to: its own path or one under it, the longest winning. */
export function currentNavItem(items: readonly NavItem[], pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const item of items) {
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

/** Items whose words contain every word typed, for Search or jump to. */
export function matchNavItems(items: readonly NavItem[], typed: string): NavItem[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  return items.filter((item) => {
    const label = item.label.toLowerCase();
    return words.every((word) => label.includes(word));
  });
}

/** The cookie holding the centre Today and the Calendar open on (the centre switcher). */
export const CENTRE_COOKIE = 'cmx_centre';
