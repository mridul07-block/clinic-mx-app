import 'server-only';
import type { StaffMember } from '@clinic-mx/db';
import { can, formatRupees, kpiCatalogue } from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { collectionsView, revenueView, type RevenueView } from './finance';
import {
  centresDashboard,
  outcomesDashboard,
  type CentreToday,
  type KpiCell,
  type OutcomeBullet,
} from './manager';

/**
 * The Super Admin's overview (DSH-05, Frontend Specification section 6 "Overview across all
 * centres"; docs/runbooks/super-admin-overview.md): every centre at a glance today with its money,
 * the week against the week before (revenue included), the SOP targets, revenue by month against
 * the year before, and the AI's right diagnosis in its top 3, which comes with AI-03. Built from
 * the Centre Manager's and Finance's views, which the Super Admin reads in full.
 */

export interface OverviewCentre extends CentreToday {
  collected: string;
}

export interface OverviewView {
  countedAt: string;
  centres: OverviewCentre[];
  cells: KpiCell[];
  bullets: OutcomeBullet[];
  revenue: Pick<RevenueView, 'months' | 'thisYear' | 'lastYear'>;
  aiTop3: { label: string; target: string; needs: string };
  runningLateMinutes: number;
}

export async function overviewView(actor: StaffMember, now = new Date()): Promise<OverviewView> {
  if (!can(actor, 'dashboard.overview')) throw new NotAllowedError();
  const centres = await centresDashboard(actor, now);
  const collections = await collectionsView(actor, now);
  const outcomes = await outcomesDashboard(actor, '90', now);
  const revenue = await revenueView(actor, now);

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
  const ai = kpiCatalogue.find((figure) => figure.key === 'ai_top3');
  return {
    countedAt: centres.countedAt,
    centres: centres.centres.map((entry) => ({
      ...entry,
      collected:
        collections.today.byCentre.find((row) => row.name === entry.name)?.text ?? formatRupees(0),
    })),
    cells: [...centres.cells, revenueCell],
    bullets: outcomes.bullets,
    revenue: { months: revenue.months, thisYear: revenue.thisYear, lastYear: revenue.lastYear },
    aiTop3: {
      label: ai?.label ?? 'Right diagnosis in AI top 3',
      target: ai?.targetNote ?? 'Set after the first 3 months',
      needs: ai && ai.measured !== true ? ai.measured.needs : 'AI-03',
    },
    runningLateMinutes: centres.runningLateMinutes,
  };
}
