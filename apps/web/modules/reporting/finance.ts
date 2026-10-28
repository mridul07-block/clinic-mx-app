import 'server-only';
import {
  centreList,
  packageCounts,
  paymentsDaily,
  paymentsUndone,
  revenueMonthly,
  unpaidBills,
  type StaffMember,
} from '@clinic-mx/db';
import {
  addDays,
  addMonths,
  billKindLabels,
  billKinds,
  can,
  centreColourIndex,
  csvRupees,
  financeComing,
  formatIstDateTime,
  formatRupees,
  istDate,
  monthLabel,
  monthOf,
  monthsEnding,
  paymentMethodLabels,
  paymentMethods,
  startOfIstDay,
  toCsv,
  type FinanceExport,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * Finance's dashboards (DSH-04, Frontend Specification sections 6 and 8;
 * docs/runbooks/finance-dashboards.md): one view per tab and a CSV per table, for the Super Admin
 * and Finance (`dashboard.finance`), read under the reader's own access. Money in exact rupees in
 * tables and files, in lakhs on charts; patient names never, only bill and OP numbers.
 */

function assertReads(actor: StaffMember): void {
  if (!can(actor, 'dashboard.finance')) throw new NotAllowedError();
}

type Tx = Parameters<Parameters<typeof asStaff>[1]>[0];

interface FinanceCentre {
  id: string;
  name: string;
  tone: number;
  active: boolean;
}

/**
 * Every centre, by name: an inactive centre's money still counts in the totals, so it is shown
 * (and named) wherever it has money in the period, marked "(inactive)".
 */
async function allCentres(tx: Tx): Promise<FinanceCentre[]> {
  return (await centreList(tx))
    .map((entry) => ({
      id: entry.id,
      name: entry.active ? entry.name : `${entry.name} (inactive)`,
      tone: centreColourIndex(entry.colour),
      active: entry.active,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** The active centres, and the inactive ones with money in `rows`. */
function centresWithMoney(
  centres: readonly FinanceCentre[],
  rows: readonly { centreId: string; paise: number }[],
): FinanceCentre[] {
  return centres.filter(
    (entry) => entry.active || rows.some((row) => row.centreId === entry.id && row.paise !== 0),
  );
}

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

// Collections ----------------------------------------------------------------------------------

export interface CollectionsView {
  countedAt: string;
  today: {
    total: string;
    byMethod: { label: string; value: number; text: string }[];
    byCentre: { name: string; text: string; payments: number }[];
    undone: { payments: number; text: string };
  };
  daily: { categories: string[]; values: number[] };
  dailyTable: { day: string; text: string }[];
}

const COLLECTION_DAYS = 30;

export async function collectionsView(
  actor: StaffMember,
  now = new Date(),
): Promise<CollectionsView> {
  assertReads(actor);
  const today = istDate(now);
  const from = addDays(today, 1 - COLLECTION_DAYS);
  return asStaff(actor, async (tx) => {
    const all = await allCentres(tx);
    const rows = await paymentsDaily(tx, from, today);
    const undone = await paymentsUndone(tx, today);
    const todays = rows.filter((row) => row.day === today);
    const total = todays.reduce((sum, row) => sum + row.paise, 0);
    const days = Array.from({ length: COLLECTION_DAYS }, (_, index) => addDays(from, index));
    const perDay = days.map((day) =>
      rows.filter((row) => row.day === day).reduce((sum, row) => sum + row.paise, 0),
    );
    const undonePaise = undone.reduce((sum, row) => sum + row.paise, 0);
    return {
      countedAt: formatIstDateTime(now),
      today: {
        total: formatRupees(total),
        byMethod: paymentMethods.map((method) => {
          const paise = todays
            .filter((row) => row.method === method)
            .reduce((sum, row) => sum + row.paise, 0);
          return { label: paymentMethodLabels[method], value: paise, text: formatRupees(paise) };
        }),
        byCentre: centresWithMoney(all, todays).map((entry) => {
          const theirs = todays.filter((row) => row.centreId === entry.id);
          return {
            name: entry.name,
            text: formatRupees(theirs.reduce((sum, row) => sum + row.paise, 0)),
            payments: theirs.reduce((sum, row) => sum + row.payments, 0),
          };
        }),
        undone: {
          payments: undone.reduce((sum, row) => sum + row.payments, 0),
          text: formatRupees(undonePaise),
        },
      },
      daily: { categories: days.map(dayLabel), values: perDay },
      dailyTable: days.map((day, index) => ({ day, text: formatRupees(perDay[index] ?? 0) })),
    };
  });
}

// Unpaid ---------------------------------------------------------------------------------------

export interface UnpaidView {
  count: number;
  total: string;
  rows: {
    number: string;
    centre: string;
    kind: string;
    amount: string;
    days: number;
    opNumber: string;
    /** The bill's plan and payment sheet, where Finance applies a discount (BIL-07). */
    href: string | null;
  }[];
  coming: string;
}

export async function unpaidView(actor: StaffMember, now = new Date()): Promise<UnpaidView> {
  assertReads(actor);
  const start = startOfIstDay(istDate(now)).getTime();
  return asStaff(actor, async (tx) => {
    const rows = await unpaidBills(tx);
    return {
      count: rows.length,
      total: formatRupees(rows.reduce((sum, row) => sum + row.totalPaise, 0)),
      rows: rows.map((row) => ({
        number: row.number,
        centre: row.centreName,
        kind: billKindLabels[row.kind],
        amount: formatRupees(row.totalPaise),
        days: Math.max(
          0,
          Math.floor((start - startOfIstDay(istDate(row.createdAt)).getTime()) / 86_400_000),
        ),
        opNumber: row.opNumber,
        href: row.episodeId ? ['/app/plans', row.episodeId].join('/') : null,
      })),
      coming: financeComing.unpaid,
    };
  });
}

// Packages -------------------------------------------------------------------------------------

export interface PackagesView {
  expiringDays: number;
  centres: {
    name: string;
    active: number;
    expiring: number;
    expired: number;
    sessionsLeftActive: number;
    sessionsLeftExpired: number;
  }[];
}

export async function packagesView(actor: StaffMember, now = new Date()): Promise<PackagesView> {
  assertReads(actor);
  const expiringDays = await getSetting('packages.expiry_reminder_days');
  return asStaff(actor, async (tx) => {
    const counts = await packageCounts(tx, istDate(now), expiringDays);
    const centres = (await allCentres(tx)).filter(
      (entry) => entry.active || counts.some((row) => row.centreId === entry.id),
    );
    return {
      expiringDays,
      centres: centres.map((entry) => {
        const found = counts.find((row) => row.centreId === entry.id);
        return {
          name: entry.name,
          active: found?.active ?? 0,
          expiring: found?.expiring ?? 0,
          expired: found?.expired ?? 0,
          sessionsLeftActive: found?.sessionsLeftActive ?? 0,
          sessionsLeftExpired: found?.sessionsLeftExpired ?? 0,
        };
      }),
    };
  });
}

// Revenue --------------------------------------------------------------------------------------

export interface RevenueView {
  months: string[];
  thisYear: number[];
  lastYear: number[];
  table: { month: string; thisYear: string; lastYear: string }[];
  thisMonth: string;
  byCentre: { name: string; tone: number; value: number; text: string }[];
  byService: { label: string; value: number; text: string }[];
  coming: string;
}

export async function revenueView(actor: StaffMember, now = new Date()): Promise<RevenueView> {
  assertReads(actor);
  const today = istDate(now);
  const thisMonth = monthOf(today);
  const months = monthsEnding(thisMonth, 12);
  const firstMonth = months[0] ?? thisMonth;
  return asStaff(actor, async (tx) => {
    const all = await allCentres(tx);
    // A year at a time: this year's twelve months, then the same months a year before.
    const current = await revenueMonthly(tx, `${firstMonth}-01`, today);
    const before = await revenueMonthly(
      tx,
      `${addMonths(firstMonth, -12)}-01`,
      addDays(`${addMonths(thisMonth, -11)}-01`, -1),
    );
    const total = (rows: typeof current, month: string) =>
      rows.filter((row) => row.month === month).reduce((sum, row) => sum + row.paise, 0);
    const thisYear = months.map((month) => total(current, month));
    const lastYear = months.map((month) => total(before, addMonths(month, -12)));
    const monthRows = current.filter((row) => row.month === thisMonth);
    return {
      months,
      thisYear,
      lastYear,
      table: months.map((month, index) => ({
        month: monthLabel(month, true),
        thisYear: formatRupees(thisYear[index] ?? 0),
        lastYear: formatRupees(lastYear[index] ?? 0),
      })),
      thisMonth: monthLabel(thisMonth, true),
      byCentre: centresWithMoney(all, monthRows).map((entry) => {
        const value = monthRows
          .filter((row) => row.centreId === entry.id)
          .reduce((sum, row) => sum + row.paise, 0);
        return { name: entry.name, tone: entry.tone, value, text: formatRupees(value) };
      }),
      byService: billKinds.map((kind) => {
        const value = current
          .filter((row) => row.kind === kind)
          .reduce((sum, row) => sum + row.paise, 0);
        return { label: billKindLabels[kind], value, text: formatRupees(value) };
      }),
      coming: financeComing.revenue,
    };
  });
}

// CSV ------------------------------------------------------------------------------------------

/** A table as a CSV file: its name and contents. */
export async function financeCsv(
  actor: StaffMember,
  table: FinanceExport,
  now = new Date(),
): Promise<{ filename: string; body: string }> {
  assertReads(actor);
  const today = istDate(now);
  if (table === 'unpaid') {
    const rows = await asStaff(actor, unpaidBills);
    return {
      filename: `${['clinic-mx-unpaid', today].join('-')}.csv`,
      body: toCsv(
        ['Bill', 'Centre', 'Kind', 'Rupees', 'Raised (IST)', 'OP number'],
        rows.map((row) => [
          row.number,
          row.centreName,
          billKindLabels[row.kind],
          csvRupees(row.totalPaise),
          istDate(row.createdAt),
          row.opNumber,
        ]),
      ),
    };
  }
  if (table === 'collections') {
    const from = addDays(today, 1 - COLLECTION_DAYS);
    const { rows, centres } = await asStaff(actor, async (tx) => ({
      rows: await paymentsDaily(tx, from, today),
      centres: await allCentres(tx),
    }));
    const name = new Map(centres.map((entry) => [entry.id, entry.name]));
    return {
      filename: `${['clinic-mx-collections', from, 'to', today].join('-')}.csv`,
      body: toCsv(
        ['Day (IST)', 'Centre', 'Method', 'Payments', 'Rupees'],
        [...rows]
          .sort((a, b) => a.day.localeCompare(b.day) || a.method.localeCompare(b.method))
          .map((row) => [
            row.day,
            name.get(row.centreId) ?? row.centreId,
            paymentMethodLabels[row.method],
            row.payments,
            csvRupees(row.paise),
          ]),
      ),
    };
  }
  const view = await revenueView(actor, now);
  return {
    filename: `${['clinic-mx-revenue', today].join('-')}.csv`,
    body: toCsv(
      ['Month', 'Rupees this year', 'Rupees a year before'],
      view.months.map((month, index) => [
        month,
        csvRupees(view.thisYear[index] ?? 0),
        csvRupees(view.lastYear[index] ?? 0),
      ]),
    ),
  };
}
