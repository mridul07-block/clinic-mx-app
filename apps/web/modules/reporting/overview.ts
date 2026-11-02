import 'server-only';
import type { StaffMember } from '@clinic-mx/db';
import { can, formatRupees } from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { collectionsView } from './finance';
import {
  alertsDashboard,
  centresDashboard,
  type AlertsDashboard,
  type CentreToday,
  type KpiCell,
} from './manager';

/**
 * The Super Admin's Home (DSH-05; the user's review, 3 November 2026;
 * docs/runbooks/super-admin-overview.md): what needs them now, every centre today with its money,
 * and four numbers for the week against the week before. One screen; everything else is on
 * Reports. Built from the Centre Manager's and Finance's views, which the Super Admin reads in full.
 */

export interface OverviewCentre extends CentreToday {
  collected: string;
}

export interface OverviewView {
  countedAt: string;
  /** What is waiting, largest first; nothing with a count of zero. */
  needs: AlertsDashboard['items'];
  centres: OverviewCentre[];
  cells: KpiCell[];
  runningLateMinutes: number;
}

/** The week's numbers on Home; today's no shows are already on each centre's row. */
const homeCells = new Set(['consultations', 'plan_acceptance', 'active_patients', 'revenue']);

export async function overviewView(actor: StaffMember, now = new Date()): Promise<OverviewView> {
  if (!can(actor, 'dashboard.overview')) throw new NotAllowedError();
  const centres = await centresDashboard(actor, now);
  const collections = await collectionsView(actor, now);
  const alerts = await alertsDashboard(actor);

  // Revenue over the last 7 days against the 7 before, from the 30 days of collections less
  // the refunds given on each (BIL-11), as the Revenue tab counts it.
  const daily = collections.daily.values.map(
    (value, index) => value - (collections.refundsDaily[index] ?? 0),
  );
  const week = daily.slice(-7).reduce((sum, value) => sum + value, 0);
  const before = daily.slice(-14, -7).reduce((sum, value) => sum + value, 0);
  const difference = week - before;
  const revenueCell: KpiCell = {
    key: 'revenue',
    label: 'Revenue',
    value: formatRupees(week),
    change:
      difference === 0
        ? 'Same as the 7 days before'
        : `${difference > 0 ? '+' : '−'}${formatRupees(Math.abs(difference))} on the 7 days before`,
    status: null,
  };
  return {
    countedAt: centres.countedAt,
    needs: alerts.items.filter((item) => item.total > 0).sort((a, b) => b.total - a.total),
    centres: centres.centres.map((entry) => ({
      ...entry,
      collected:
        collections.today.byCentre.find((row) => row.name === entry.name)?.text ?? formatRupees(0),
    })),
    cells: [...centres.cells, revenueCell].filter((cell) => homeCells.has(cell.key)),
    runningLateMinutes: centres.runningLateMinutes,
  };
}
