import { z } from 'zod';
import { currentStaff } from '../../../../../../../modules/auth/session';
import { paperFormsPdf } from '../../../../../../../modules/documents/paper';

// The paper health form and Part A consent of a centre (OPS-05), for those who check patients in
// there: blank, rendered by our server on each request, never cached, never sniffed. Anyone else
// gets "not found".
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ centreId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  const { centreId } = await params;
  if (!z.guid().safeParse(centreId).success) return notFound();
  const bytes = await paperFormsPdf(staff, centreId);
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="health-form-and-consent.pdf"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
