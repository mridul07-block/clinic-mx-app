import 'server-only';
import { contentVersion, todayBoard, type StaffMember, type TodayAppointment } from '@clinic-mx/db';
import { calendarQuerySchema } from '@clinic-mx/schemas';
import { assertCan } from '../access/guard';
import { asStaff } from '../access/staff-db';

/** The Today board's appointments and their fingerprint, for the live check. */
export interface TodayView {
  appointments: TodayAppointment[];
  version: string;
}

/**
 * The front desk Today board (INT-01): a centre's appointments on a day, for those who check
 * patients in (`check_in.manage`) at that centre, under their row level security.
 */
export async function loadToday(actor: StaffMember, rawQuery: unknown): Promise<TodayView> {
  const query = calendarQuerySchema.parse(rawQuery);
  assertCan(actor, 'check_in.manage', { centreId: query.centreId });
  const appointments = await asStaff(actor, (tx) => todayBoard(tx, query));
  return { appointments, version: contentVersion(appointments) };
}
