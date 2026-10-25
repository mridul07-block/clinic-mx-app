import 'server-only';
import {
  packageList,
  packagesOfPatient,
  type PackageEntry,
  type PackageListRow,
  type StaffMember,
} from '@clinic-mx/db';
import type { PackageListFilter } from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * Packages (BIL-08; docs/runbooks/bills.md). The database activates them on payment; these are
 * the reads. Physios, the front desk, Finance and the Super Admin see a patient's packages (no
 * prices are in them); Finance's lists are for those who see amounts. Row level security limits
 * both to the reader's centres.
 */

/** A patient's packages, newest first, for the patient record. */
export async function patientPackagesFor(
  actor: StaffMember,
  patientId: string,
): Promise<PackageEntry[]> {
  assertMay(actor, 'packages.view_sessions_left');
  return asStaff(actor, (tx) => packagesOfPatient(tx, patientId));
}

/** Finance's Packages list: active, expiring within the reminder days, or expired with sessions left. */
export async function packageListFor(
  actor: StaffMember,
  filter: PackageListFilter,
): Promise<{ rows: PackageListRow[]; expiringDays: number }> {
  assertMay(actor, 'bills.view_amounts');
  const expiringDays = await getSetting('packages.expiry_reminder_days');
  const rows = await asStaff(actor, (tx) => packageList(tx, filter, expiringDays));
  return { rows, expiringDays };
}
