import { reportExtensions } from '@clinic-mx/schemas';
import { currentStaff } from '../../../../../../modules/auth/session';
import { reportFile } from '../../../../../../modules/reports/services';

// A report photo or scan, opened by a clinician (ALT-08), from our own domain only (rule 9): the
// file is fetched from the private bucket by our server after the permission and row level
// security checks. Never cached, never sniffed; anyone else gets "not found".
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  const { reportId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return notFound();
  const file = await reportFile(staff, reportId);
  if (!file) return notFound();
  return new Response(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': `inline; filename="report.${reportExtensions[file.contentType]}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
