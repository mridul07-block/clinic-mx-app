import 'server-only';
import {
  contentVersion,
  sessionProgress,
  todayBoard,
  type StaffMember,
  type TodayAppointment,
} from '@clinic-mx/db';
import { calendarQuerySchema, sessionView, type SessionView } from '@clinic-mx/schemas';
import { assertCan } from '../access/guard';
import { asStaff } from '../access/staff-db';

/** A Today row: the appointment and, for a treatment session, its number and gate (SES-01). */
export type TodayRow = TodayAppointment & { session: SessionView | null };

/** The Today board's appointments and their fingerprint, for the live check. */
export interface TodayView {
  appointments: TodayRow[];
  version: string;
}

/**
 * The front desk Today board (INT-01): a centre's appointments on a day, for those who check
 * patients in (`check_in.manage`) at that centre, under their row level security.
 */
export async function loadToday(actor: StaffMember, rawQuery: unknown): Promise<TodayView> {
  const query = calendarQuerySchema.parse(rawQuery);
  assertCan(actor, 'check_in.manage', { centreId: query.centreId });
  const appointments = await asStaff(actor, async (tx) => {
    const rows = await todayBoard(tx, query);
    const progress = await sessionProgress(
      tx,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({ ...row, session: sessionView(progress.get(row.id)) }));
  });
  return { appointments, version: contentVersion(appointments) };
}
