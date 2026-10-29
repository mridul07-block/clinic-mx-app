import { z } from 'zod';
import { NotAllowedError } from '../../../../../../../modules/access/guard';
import { currentStaff } from '../../../../../../../modules/auth/session';
import { exportForRequest } from '../../../../../../../modules/data-requests/services';

// A patient's data for their open export request (ADM-03), as one JSON file: for the Super Admin
// only, built by the database on each request, audited as an export, never cached, never sniffed.
// A POST, so no link from elsewhere starts one (a cross-site POST carries no session cookie).
// Anyone else, and any request that is not an open export request, gets "not found".
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  const { requestId } = await params;
  if (!z.guid().safeParse(requestId).success) return notFound();
  let exported: Awaited<ReturnType<typeof exportForRequest>>;
  try {
    exported = await exportForRequest(staff, requestId);
  } catch (error) {
    if (error instanceof NotAllowedError) return notFound();
    throw error;
  }
  if (!exported) return notFound();
  return new Response(JSON.stringify(exported.data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exported.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
