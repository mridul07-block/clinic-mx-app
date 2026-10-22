import { calendarVersion } from '@clinic-mx/db';
import { z } from 'zod';
import { NotAllowedError } from '../../../../../../modules/access/guard';
import { currentStaff } from '../../../../../../modules/auth/session';
import { loadCalendar } from '../../../../../../modules/scheduling/calendar';

// The calendar's live check (SCH-05): the day's version, and the day itself only when it changed
// since the version the screen has. Our own domain only (rule 9); the proxy keeps the session
// fresh and never counts the check as activity (it carries the live header).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const query = new URL(request.url).searchParams;
  try {
    const day = await loadCalendar(staff, {
      centreId: query.get('centre'),
      date: query.get('date'),
    });
    const version = calendarVersion(day);
    return Response.json(version === query.get('since') ? { version } : { version, day });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Bad day' }, { status: 400 });
    if (error instanceof NotAllowedError) {
      return Response.json({ error: 'Not allowed' }, { status: 403 });
    }
    throw error;
  }
}
