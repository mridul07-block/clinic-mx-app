import {
  istDate,
  packageState,
  type PackageListFilter,
  type PackageState,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from 'drizzle-orm';
import { appointment, appointmentType, centre, patient, patientPackage } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Packages (BIL-08; docs/runbooks/bills.md). The database makes one when a package's bill is paid
 * and cancels it when that payment is undone; closing a treatment session uses one through
 * `usePackageSession`. Row level security shows them to those who see amounts at the package's
 * centre and to physios there; they hold no amounts.
 */

export const PACKAGE_EXPIRY_REMINDER_JOB = 'whatsapp.package_expiry_reminder';

export interface PackageEntry {
  id: string;
  name: string;
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsLeft: number;
  reschedulesLeft: number;
  paidAt: Date;
  /** The last IST day it can be used (YYYY-MM-DD). */
  validUntil: string;
  cancelReason: string | null;
  state: PackageState;
}

const entryColumns = {
  id: patientPackage.id,
  name: patientPackage.name,
  sessionsTotal: patientPackage.sessionsTotal,
  sessionsUsed: patientPackage.sessionsUsed,
  reschedulesLeft: patientPackage.reschedulesLeft,
  paidAt: patientPackage.paidAt,
  validUntil: patientPackage.validUntil,
  cancelledAt: patientPackage.cancelledAt,
  cancelReason: patientPackage.cancelReason,
};

function toEntry(
  {
    cancelledAt,
    ...row
  }: { cancelledAt: Date | null } & Omit<PackageEntry, 'sessionsLeft' | 'state'>,
  today: string,
): PackageEntry {
  return {
    ...row,
    sessionsLeft: row.sessionsTotal - row.sessionsUsed,
    state: packageState({ ...row, cancelledAt }, today),
  };
}

/** An episode's packages, newest first. */
export async function packagesOfEpisode(
  db: DbOrTransaction,
  episodeId: string,
  now = new Date(),
): Promise<PackageEntry[]> {
  const rows = await db
    .select(entryColumns)
    .from(patientPackage)
    .where(eq(patientPackage.episodeId, episodeId))
    .orderBy(desc(patientPackage.paidAt));
  return rows.map((row) => toEntry(row, istDate(now)));
}

/** A patient's packages across their episodes, newest first. */
export async function packagesOfPatient(
  db: DbOrTransaction,
  patientId: string,
  now = new Date(),
): Promise<PackageEntry[]> {
  const rows = await db
    .select(entryColumns)
    .from(patientPackage)
    .where(eq(patientPackage.patientId, patientId))
    .orderBy(desc(patientPackage.paidAt));
  return rows.map((row) => toEntry(row, istDate(now)));
}

export interface PackageListRow extends PackageEntry {
  patientId: string;
  patientName: string;
  opNumber: string;
  centreName: string;
}

/**
 * Finance's package lists: active ones; active ones expiring within `expiringDays` (the reminder
 * setting); and expired ones with sessions left (DECISION 12). Cancelled and used up packages are
 * in none. Soonest expiry first.
 */
export async function packageList(
  db: DbOrTransaction,
  filter: PackageListFilter,
  expiringDays: number,
  now = new Date(),
): Promise<PackageListRow[]> {
  const today = istDate(now);
  const live = and(
    isNull(patientPackage.cancelledAt),
    lt(patientPackage.sessionsUsed, patientPackage.sessionsTotal),
  );
  const when =
    filter === 'expired'
      ? lt(patientPackage.validUntil, today)
      : filter === 'expiring'
        ? and(
            gte(patientPackage.validUntil, today),
            lte(patientPackage.validUntil, sql`${today}::date + ${expiringDays}::int`),
          )
        : gte(patientPackage.validUntil, today);
  const rows = await db
    .select({
      ...entryColumns,
      patientId: patientPackage.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      centreName: centre.name,
    })
    .from(patientPackage)
    .innerJoin(patient, eq(patient.id, patientPackage.patientId))
    .innerJoin(centre, eq(centre.id, patientPackage.centreId))
    .where(and(live, when))
    .orderBy(
      filter === 'expired' ? desc(patientPackage.validUntil) : asc(patientPackage.validUntil),
      asc(patient.name),
    );
  return rows.map(({ patientId, patientName, opNumber, centreName, ...row }) => ({
    ...toEntry(row, today),
    patientId,
    patientName,
    opNumber,
    centreName,
  }));
}

/**
 * Uses one session of an active package and returns the sessions left (PRD J5.5). The database
 * refuses a cancelled, used up or expired package. SES-07 calls it when a session is closed; it
 * runs as the system, never for a person directly.
 */
export async function usePackageSession(db: DbOrTransaction, packageId: string): Promise<number> {
  const [row] = await db.execute<{ sessions_left: number }>(
    sql`select internal.use_package_session(${packageId}::uuid) as sessions_left`,
  );
  if (!row) throw new Error('The package session was not used.');
  return row.sessions_left;
}

/**
 * Whether an appointment is a package session and how many reschedules its package has left
 * (SCH-10), for the reschedule sheet: a type in `sessionTypes` in an episode with an active
 * package. Read under row level security, so a reader who does not see packages (a Centre
 * Manager) gets undefined; the database enforces the allowance whoever moves it.
 */
export async function packageRescheduleState(
  db: DbOrTransaction,
  appointmentId: string,
  settings: { sessionTypes: readonly string[]; neverReschedulable: readonly string[] },
  now = new Date(),
): Promise<{ reschedulesLeft: number; neverReschedulable: boolean } | undefined> {
  const [visit] = await db
    .select({ episodeId: appointment.episodeId, typeKey: appointmentType.key })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(eq(appointment.id, appointmentId));
  if (!visit?.episodeId || !settings.sessionTypes.includes(visit.typeKey)) return undefined;
  const active = (await packagesOfEpisode(db, visit.episodeId, now)).find(
    (entry) => entry.state === 'active',
  );
  if (!active) return undefined;
  return {
    reschedulesLeft: active.reschedulesLeft,
    neverReschedulable: settings.neverReschedulable.includes(visit.typeKey),
  };
}
