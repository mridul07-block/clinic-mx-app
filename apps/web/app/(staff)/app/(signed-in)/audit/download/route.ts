import { NotAllowedError } from '../../../../../../modules/access/guard';
import { AuditDownloadError, auditLogDownload } from '../../../../../../modules/audit/services';
import { currentStaff } from '../../../../../../modules/auth/session';

// The audit log as CSV (ADM-04): the events the person may read, for the days, part and record
// type chosen on the screen; audited. A POST, so no link from elsewhere starts one. A download
// that cannot be made goes back to the screen, which says why.
export const dynamic = 'force-dynamic';

const fields = ['part', 'entity', 'from', 'to'] as const;
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export async function POST(request: Request) {
  const staff = await currentStaff();
  if (!staff) return new Response('Sign in again.', { status: 401 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Send the form from the audit log.', { status: 400 });
  }
  const raw: Record<string, string> = {};
  for (const field of fields) {
    const value = form.get(field);
    if (typeof value === 'string' && value !== '') raw[field] = value;
  }
  try {
    const file = await auditLogDownload(staff, raw);
    // A byte order mark, so spreadsheets read the names in UTF-8.
    return new Response(BYTE_ORDER_MARK + file.body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof AuditDownloadError) {
      const back = new URL('/app/audit', request.url);
      for (const [key, value] of Object.entries(raw)) back.searchParams.set(key, value);
      back.searchParams.set('download', error.refusal);
      return Response.redirect(back, 303);
    }
    if (error instanceof NotAllowedError) return new Response('Not found', { status: 404 });
    throw error;
  }
}
