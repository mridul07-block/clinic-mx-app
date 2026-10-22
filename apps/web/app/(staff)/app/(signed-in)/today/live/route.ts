import { z } from 'zod';
import { NotAllowedError } from '../../../../../../modules/access/guard';
import { currentStaff } from '../../../../../../modules/auth/session';
import { loadToday } from '../../../../../../modules/front-desk/today';

// The Today board's live check (INT-01), like the calendar's (SCH-05): the board's version, and
// the appointments only when they changed since the version the screen has. Our own domain only
// (rule 9); the proxy never counts the check as activity (it carries the live header).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const query = new URL(request.url).searchParams;
  try {
    const today = await loadToday(staff, {
      centreId: query.get('centre'),
      date: query.get('date'),
    });
    return Response.json(today.version === query.get('since') ? { version: today.version } : today);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Bad day' }, { status: 400 });
    if (error instanceof NotAllowedError) {
      return Response.json({ error: 'Not allowed' }, { status: 403 });
    }
    throw error;
  }
}
