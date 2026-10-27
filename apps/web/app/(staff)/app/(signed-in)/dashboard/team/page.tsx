import { can } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { requireStaff } from '../../../../../../modules/auth/session';
import { teamDashboard } from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Team · Dashboard · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Team (DSH-03): notes signed the same day by each physio and each physio's visits, with the
// rosters and leave a link away.
export default async function DashboardTeamPage() {
  const staff = await requireStaff();
  const view = await teamDashboard(staff);
  return (
    <div className="flex flex-col gap-6">
      {can(staff, 'rosters.manage') ? (
        <p className="text-sm">
          <Link href="/app/team" className="text-accent underline underline-offset-2">
            Rosters and leave
          </Link>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {view.notesOnTime.length > 0 ? (
          <div className="flex flex-col gap-1">
            <HorizontalBars
              label="Notes signed the same day, last 30 days"
              rows={view.notesOnTime}
              format={(value) => `${String(value)}%`}
            />
            <p className="text-xs text-ink-muted">
              Target over {view.notesTarget}%. Each physio:{' '}
              {view.notesOnTime.map((row) => `${row.label} ${row.counted}`).join(', ')}.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No notes started in the last 30 days.</p>
        )}
        {view.workload.length > 0 ? (
          <HorizontalBars label="Visits per physio, last 7 days" rows={view.workload} />
        ) : (
          <p className="text-sm text-ink-muted">No visits in the last 7 days.</p>
        )}
      </div>
    </div>
  );
}
