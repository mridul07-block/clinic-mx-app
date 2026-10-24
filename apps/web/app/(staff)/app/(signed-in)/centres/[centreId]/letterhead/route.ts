import { currentStaff } from '../../../../../../../modules/auth/session';
import { letterheadPreview } from '../../../../../../../modules/documents/preview';

// A centre's letterhead preview (ALT-05): a sample PDF on its live details, for the Super Admin.
// Rendered by our server on each request; never cached, never sniffed. Anyone else gets "not
// found".
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ centreId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  const { centreId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(centreId)) return notFound();
  const bytes = await letterheadPreview(staff, centreId);
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="letterhead-preview.pdf"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
