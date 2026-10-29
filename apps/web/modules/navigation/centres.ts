import 'server-only';
import { centreList, type StaffMember } from '@clinic-mx/db';
import { CENTRE_COOKIE, seesAllCentres } from '@clinic-mx/schemas';
import { cookies } from 'next/headers';
import { asStaff } from '../access/staff-db';

/**
 * The centre switcher (UI-02; Frontend Specification section 4: "centre switcher, only for users
 * with more than one centre"). The person's choice is the centre Today and the Calendar open on
 * when their address names none; a centre named in the address, and their own centre buttons,
 * still win. Kept in a cookie on the device. Recommended default chosen under the user's standing
 * approval, 29 October 2026 (DECISION UI-02).
 */

export interface SwitchableCentre {
  id: string;
  name: string;
  /** Short, for the tablet rail: "HSR". */
  code: string;
}

/** The active centres the person works in (the Super Admin and Finance: all). */
export async function switchableCentres(staff: StaffMember): Promise<SwitchableCentre[]> {
  const rows = await asStaff(staff, (tx) => centreList(tx));
  return rows
    .filter((c) => c.active && (seesAllCentres(staff.role) || staff.centreIds.includes(c.id)))
    .map(({ id, name, code }) => ({ id, name, code }));
}

/**
 * The centre chosen on this device, when the person works there. A choice made by someone else on
 * a shared device, or at a centre they have since left, counts as none.
 */
export async function chosenCentreId(staff: StaffMember): Promise<string | undefined> {
  const chosen = (await cookies()).get(CENTRE_COOKIE)?.value;
  if (!chosen) return undefined;
  return seesAllCentres(staff.role) || staff.centreIds.includes(chosen) ? chosen : undefined;
}
