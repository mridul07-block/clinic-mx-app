import { NotAllowedError } from '../../../../../../modules/access/guard';
import { currentStaff } from '../../../../../../modules/auth/session';
import { loadMyPatients } from '../../../../../../modules/my-patients/services';

// My patients today's live check (CLN-01), like Today's: the list's version, and the visits only
// when they changed since the version the screen has. Our own domain only (rule 9); the proxy
// never counts the check as activity (it carries the live header).
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  try {
    const view = await loadMyPatients(staff);
    const since = new URL(request.url).searchParams.get('since');
    return Response.json(view.version === since ? { version: view.version } : view);
  } catch (error) {
    if (error instanceof NotAllowedError) {
      return Response.json({ error: 'Not allowed' }, { status: 403 });
    }
    throw error;
  }
}
