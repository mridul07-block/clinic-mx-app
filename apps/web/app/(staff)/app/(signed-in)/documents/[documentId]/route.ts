import { documentFileName } from '@clinic-mx/schemas';
import { currentStaff } from '../../../../../../modules/auth/session';
import { documentFile } from '../../../../../../modules/documents/services';

// A generated document (ALT-05), opened from our own domain only (rule 9): the PDF is fetched
// from the private bucket by our server after the permission and row level security checks, and
// the open is logged. Never cached, never sniffed; anyone else gets "not found".
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  const { documentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return notFound();
  const file = await documentFile(staff, documentId);
  if (!file) return notFound();
  return new Response(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${documentFileName(file.kind, file.version)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
