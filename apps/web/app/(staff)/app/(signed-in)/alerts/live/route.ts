import { emergencyBannersOf } from '../../../../../../modules/alerts/services';
import { currentStaff } from '../../../../../../modules/auth/session';

// The emergency banners' live check (ALT-01): the open emergencies the signed in person sees, by
// id only. Our own domain only (rule 9); the proxy never counts the check as activity (it carries
// the live header).
export const dynamic = 'force-dynamic';

export async function GET() {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const banners = await emergencyBannersOf(staff);
  return Response.json({ alertIds: banners.map((banner) => banner.alertId) });
}
