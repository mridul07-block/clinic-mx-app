import { financeExports, type FinanceExport } from '@clinic-mx/schemas';
import { NotAllowedError } from '../../../../../../../modules/access/guard';
import { currentStaff } from '../../../../../../../modules/auth/session';
import { financeCsv } from '../../../../../../../modules/reporting/finance';

// A Finance table as CSV (DSH-04): the Super Admin and Finance, the same figures as the screen,
// bill and OP numbers but never a patient's name; formulas never run when opened.
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ table: string }> }) {
  const staff = await currentStaff();
  if (!staff) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const { table } = await params;
  const known = financeExports.find((each): each is FinanceExport => each === table);
  if (!known) return Response.json({ error: 'There is no such table.' }, { status: 404 });
  try {
    const file = await financeCsv(staff, known);
    return new Response(file.body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof NotAllowedError) {
      return Response.json(
        { error: 'Finance tables are for Finance and the Super Admin.' },
        { status: 403 },
      );
    }
    throw error;
  }
}
