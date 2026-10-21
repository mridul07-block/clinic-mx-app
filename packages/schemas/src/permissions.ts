import { seesAllCentres, type StaffRole } from './staff';

/**
 * The permission map (IAM-04, TAD section 5): what each role may do, the single source for the
 * server guard and for screens that hide what someone cannot use. There is no runtime editor.
 * Rows follow the access summary in PRD section 2; see docs/runbooks/permissions.md.
 */

/** The two clinical ticks a grant can require (PRD section 2). */
export type Tick = 'treatsPatients' | 'consultant';

/**
 * One role's grant for one action: allowed, allowed only with every listed tick, or allowed only
 * for the person's own records (`own`). `null` means never.
 */
export interface Grant {
  own?: true;
  ticks?: readonly Tick[];
}

type Row = Readonly<Record<StaffRole, Grant | null>>;

const yes: Grant = {};
const own: Grant = { own: true };
const treats: Grant = { ticks: ['treatsPatients'] };
const consultant: Grant = { ticks: ['consultant'] };
// Signing any clinical record needs the Treats patients tick as well (PRD section 2).
const signsAsConsultant: Grant = { ticks: ['consultant', 'treatsPatients'] };
const no = null;

/** Columns in the order of the PRD table: Super Admin, Centre Manager, Front Desk, Physio, Finance. */
function row(
  superAdmin: Grant | null,
  centreManager: Grant | null,
  frontDesk: Grant | null,
  physiotherapist: Grant | null,
  finance: Grant | null,
): Row {
  return {
    super_admin: superAdmin,
    centre_manager: centreManager,
    front_desk: frontDesk,
    physiotherapist,
    finance,
  };
}

export const permissionMap = {
  // Setup: clinics, staff, templates.
  'centres.manage': row(yes, no, no, no, no),
  'staff.manage': row(yes, no, no, no, no),
  'templates.manage': row(yes, no, no, no, no),
  'settings.manage': row(yes, no, no, no, no),
  'support_access.grant': row(yes, no, no, no, no),
  'rosters.manage': row(yes, yes, no, no, no),
  'leave.manage': row(yes, yes, no, own, no),
  // Prices, packages, discount types.
  'prices.view': row(yes, yes, yes, no, yes),
  'prices.manage': row(yes, no, no, no, yes),
  // Calendar and bookings.
  'calendar.view': row(yes, yes, yes, own, no),
  'bookings.manage': row(yes, yes, yes, no, no),
  'bookings.book_next_session': row(yes, yes, yes, yes, no),
  // Check in, health form, consent.
  'check_in.manage': row(yes, yes, yes, no, no),
  'check_in.view': row(yes, yes, yes, yes, no),
  // Patient name and contact.
  'patients.view_contact': row(yes, yes, yes, yes, yes),
  'patients.edit_contact': row(yes, yes, yes, no, no),
  // Clinical records; physios hold the Treats patients tick automatically.
  'clinical.read': row(yes, treats, no, treats, no),
  'ai_prep.use': row(consultant, consultant, no, consultant, no),
  'consultant_records.write': row(consultant, consultant, no, consultant, no),
  'consultant_records.sign': row(signsAsConsultant, signsAsConsultant, no, signsAsConsultant, no),
  'session_notes.write': row(treats, treats, no, treats, no),
  // Red flag alerts: Front Desk sees the "Clinician review needed" banner only.
  'red_flags.view': row(yes, yes, no, yes, no),
  'red_flags.view_banner': row(yes, yes, yes, yes, no),
  // Bills and payments: managers see a "payment pending" flag, physios "sessions left" only.
  'bills.view_amounts': row(yes, no, yes, no, yes),
  'bills.create_and_collect': row(yes, no, yes, no, yes),
  'bills.view_payment_pending': row(yes, yes, yes, no, yes),
  'packages.view_sessions_left': row(yes, no, yes, yes, yes),
  // Discounts and refunds.
  'discounts.apply_preset': row(yes, no, yes, no, yes),
  'discounts.apply_any': row(yes, no, no, no, yes),
  'refunds.manage': row(yes, no, no, no, yes),
  // Dashboards.
  'dashboard.overview': row(yes, no, no, no, no),
  'dashboard.clinical_operations': row(yes, yes, no, no, no),
  'dashboard.today': row(yes, no, yes, no, no),
  'dashboard.own_patients': row(yes, no, no, own, no),
  'dashboard.finance': row(yes, no, no, no, yes),
  // Knowledge base.
  'knowledge_base.view': row(yes, yes, no, yes, no),
  'knowledge_base.edit': row(yes, no, no, no, no),
  // Audit log and data export.
  'audit.view_all': row(yes, no, no, no, no),
  'audit.view_clinical': row(yes, yes, no, no, no),
  'audit.view_finance': row(yes, no, no, no, yes),
  'data.export': row(yes, no, no, no, no),
  'data_requests.manage': row(yes, no, no, no, no),
} as const satisfies Record<string, Row>;

export type Action = keyof typeof permissionMap;

export const actions = Object.keys(permissionMap) as Action[];

/** What the guard needs to know about a staff member. */
export interface StaffAccess {
  id: string;
  role: StaffRole;
  treatsPatients: boolean;
  consultant: boolean;
  centreIds: readonly string[];
}

/** The record an action is about: its centre, and the staff member it belongs to. */
export interface AccessTarget {
  centreId?: string;
  ownerId?: string;
}

function grantFor(staff: StaffAccess, action: Action): Grant | null {
  const grant = permissionMap[action][staff.role];
  if (!grant) return null;
  return (grant.ticks ?? []).every((tick) => staff[tick]) ? grant : null;
}

/**
 * How far a staff member may take an action: on any record (`any`), only their own (`own`), or
 * not at all (`null`). List queries filter with it; single records go through `can`.
 */
export function accessScope(staff: StaffAccess, action: Action): 'any' | 'own' | null {
  const grant = grantFor(staff, action);
  if (!grant) return null;
  return grant.own ? 'own' : 'any';
}

/**
 * Whether a staff member may take an action, on a record when one is given. Everyone acts only in
 * their assigned centres, except the roles that see every centre. An `own` grant needs the record
 * to be theirs.
 */
export function can(staff: StaffAccess, action: Action, target: AccessTarget = {}): boolean {
  const scope = accessScope(staff, action);
  if (!scope) return false;
  if (scope === 'own' && target.ownerId !== staff.id) return false;
  if (
    target.centreId !== undefined &&
    !seesAllCentres(staff.role) &&
    !staff.centreIds.includes(target.centreId)
  ) {
    return false;
  }
  return true;
}
