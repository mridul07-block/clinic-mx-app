import { auditPartsFor } from './audit-log';
import { accessScope, type Action, type StaffAccess } from './permissions';

/**
 * Every staff screen one navigates to, once (UI-02). A role's few main links show in the rail,
 * the sidebar and the phone's tabs (the user's review, 3 November 2026: `mainNavigationFor`);
 * the rest sit under headings on More, Setup for the Super Admin (`moreNavigationFor`), and Search
 * (Ctrl K) finds them all. Each shows only to those who may open it, the same check the page
 * makes (docs/runbooks/navigation.md).
 */

export const navSections = [
  'daily',
  'reports',
  'clinic',
  'people',
  'content',
  'rules',
  'records',
] as const;
export type NavSection = (typeof navSections)[number];

export const navSectionLabels: Record<NavSection, string> = {
  daily: 'Day to day',
  reports: 'Reports',
  clinic: 'Clinic',
  people: 'People',
  content: 'Clinical content',
  rules: 'Rules',
  records: 'Records and access',
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
  'exercises',
  'more',
] as const;
export type NavIcon = (typeof navIcons)[number];

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  section: NavSection;
  /** Paths that count as this link, beyond its own. */
  also?: readonly string[];
}

interface NavRule extends NavItem {
  /** Who may open it: an action any grant of which will do, or a rule of its own. */
  may: Action | ((staff: StaffAccess) => boolean);
}

// In Home's order, Home's words.
const navRules: readonly NavRule[] = [
  { label: 'To do', href: '/app/tasks', icon: 'tasks', section: 'daily', may: 'tasks.view' },
  {
    label: 'My day',
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
    section: 'clinic',
    may: 'centres.manage',
  },
  { label: 'Team', href: '/app/team', icon: 'team', section: 'people', may: 'rosters.manage' },
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
    section: 'clinic',
    may: 'settings.manage',
  },
  {
    label: 'AI preparation sheet',
    href: '/app/ai-preparation-sheet',
    icon: 'ai',
    section: 'rules',
    may: 'settings.manage',
  },
  { label: 'Alerts', href: '/app/alerts', icon: 'alerts', section: 'daily', may: 'red_flags.view' },
  {
    label: 'Red flags',
    href: '/app/red-flags',
    icon: 'red-flags',
    section: 'content',
    may: 'knowledge_base.view',
  },
  {
    label: 'Knowledge base',
    href: '/app/knowledge-base',
    icon: 'knowledge-base',
    section: 'content',
    may: 'knowledge_base.view',
  },
  {
    label: 'WhatsApp templates',
    href: '/app/templates',
    icon: 'templates',
    section: 'content',
    may: 'templates.manage',
  },
  {
    label: 'Packages',
    href: '/app/packages',
    icon: 'packages',
    section: 'daily',
    may: 'bills.view_amounts',
  },
  { label: 'Prices', href: '/app/prices', icon: 'prices', section: 'clinic', may: 'prices.view' },
  { label: 'Staff', href: '/app/staff', icon: 'staff', section: 'people', may: 'staff.manage' },
  {
    label: 'Support access',
    href: '/app/support-access',
    icon: 'support',
    section: 'records',
    may: 'support_access.grant',
  },
  {
    label: 'Exercise library',
    href: '/app/exercises',
    icon: 'exercises',
    section: 'content',
    may: 'exercises.manage',
  },
  {
    label: 'Settings',
    href: '/app/settings',
    icon: 'settings',
    section: 'rules',
    may: 'settings.manage',
  },
  {
    label: 'Audit log',
    href: '/app/audit',
    icon: 'audit',
    section: 'records',
    may: (staff) => auditPartsFor(staff).length > 0,
  },
  {
    label: 'Opening entries',
    href: '/app/opening-entries',
    icon: 'opening-entries',
    section: 'records',
    may: 'opening_entries.manage',
  },
  {
    label: 'Home',
    href: '/app/overview',
    icon: 'overview',
    section: 'reports',
    may: 'dashboard.overview',
  },
  {
    label: 'Reports',
    href: '/app/dashboard',
    icon: 'dashboard',
    section: 'reports',
    may: 'dashboard.clinical_operations',
  },
  {
    label: 'Money',
    href: '/app/finance',
    icon: 'finance',
    section: 'reports',
    may: 'dashboard.finance',
  },
  {
    label: 'Figures',
    href: '/app/figures',
    icon: 'figures',
    section: 'reports',
    may: 'dashboard.overview',
  },
  {
    label: 'Data requests',
    href: '/app/data-requests',
    icon: 'data-requests',
    section: 'records',
    may: 'data_requests.manage',
  },
  {
    label: 'Kiosk tablets',
    href: '/app/kiosk-tablets',
    icon: 'kiosk',
    section: 'clinic',
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

interface MainLink {
  /** The navigation rule behind it: who may open it, its icon. */
  rule: string;
  label?: string;
  href?: string;
  also?: readonly string[];
  /** Other screens this link's page reaches, so More need not list them. */
  holds?: readonly string[];
}

const reportsLink: MainLink = {
  rule: '/app/dashboard',
  label: 'Reports',
  href: '/app/dashboard/centres',
  also: ['/app/dashboard'],
};

/** The Super Admin's Reports also holds Money and Figures, as tabs. */
const adminReportsLink: MainLink = {
  ...reportsLink,
  also: ['/app/dashboard', '/app/finance', '/app/figures'],
  holds: ['/app/finance', '/app/figures'],
};

/** Each role's main links, in order: what it needs daily (the user's review, 3 November 2026). */
const mainLinksByRole: Record<StaffAccess['role'], readonly MainLink[]> = {
  front_desk: [
    { rule: '/app/today' },
    { rule: '/app/calendar' },
    { rule: '/app/patients' },
    { rule: '/app/tasks' },
  ],
  physiotherapist: [
    { rule: '/app/my-patients' },
    { rule: '/app/calendar' },
    { rule: '/app/patients' },
    { rule: '/app/tasks' },
  ],
  centre_manager: [
    { rule: '/app/dashboard', label: 'Home', href: '/app/dashboard/alerts' },
    { rule: '/app/my-patients' },
    { rule: '/app/today' },
    { rule: '/app/calendar' },
    { rule: '/app/patients' },
    { rule: '/app/tasks' },
    reportsLink,
  ],
  finance: [
    { rule: '/app/finance', href: '/app/finance/collections', also: ['/app/finance'] },
    { rule: '/app/patients' },
    { rule: '/app/prices' },
    { rule: '/app/tasks' },
  ],
  super_admin: [
    { rule: '/app/overview', label: 'Home' },
    { rule: '/app/my-patients' },
    { rule: '/app/calendar' },
    { rule: '/app/patients' },
    { rule: '/app/tasks' },
    adminReportsLink,
  ],
};

/** The name of the page holding everything else: Setup for the Super Admin, More for the rest. */
export function moreLabel(role: StaffAccess['role']): string {
  return role === 'super_admin' ? 'Setup' : 'More';
}

/** The rail's and sidebar's links: the role's main ones it may open, then More or Setup. */
export function mainNavigationFor(staff: StaffAccess): NavItem[] {
  const allowed = navigationFor(staff);
  const main = mainLinksByRole[staff.role].flatMap((link): NavItem[] => {
    const rule = allowed.find((item) => item.href === link.rule);
    if (!rule) return [];
    return [
      {
        ...rule,
        label: link.label ?? rule.label,
        href: link.href ?? rule.href,
        ...(link.also ? { also: link.also } : {}),
      },
    ];
  });
  return [
    ...main,
    {
      label: moreLabel(staff.role),
      href: '/app',
      icon: staff.role === 'super_admin' ? 'settings' : 'more',
      section: 'daily',
    },
  ];
}

/** Everything else the person may open: what More or Setup lists. */
export function moreNavigationFor(staff: StaffAccess): NavItem[] {
  const main = new Set(
    mainLinksByRole[staff.role].flatMap((link) => [link.rule, ...(link.holds ?? [])]),
  );
  return navigationFor(staff).filter((item) => !main.has(item.href));
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
  let length = 0;
  for (const item of items) {
    for (const path of [item.href, ...(item.also ?? [])]) {
      const hit = pathname === path || pathname.startsWith(`${path}/`);
      if (hit && path.length > length) {
        best = item;
        length = path.length;
      }
    }
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
