import { addDays, isoWeekday, istInstant, type Weekly } from '@clinic-mx/schemas';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { centre, roster, staffLeave, staffUser, staffUserCentre } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Rosters and leave (SET-04). Run under row level security: rosters are read by everyone who sees
 * the centre and set by managers there; leave is read by the person and their managers. Every
 * change is audited by the trigger; nothing is deleted.
 */

export interface RosterVersion {
  id: string;
  staffUserId: string;
  centreId: string;
  centreName: string;
  /** IST calendar date, YYYY-MM-DD. */
  effectiveFrom: string;
  weekly: Weekly;
}

/** Every roster version of a person, by centre name, then oldest first. */
export function rosterVersions(db: DbOrTransaction, staffUserId: string): Promise<RosterVersion[]> {
  return db
    .select({
      id: roster.id,
      staffUserId: roster.staffUserId,
      centreId: roster.centreId,
      centreName: centre.name,
      effectiveFrom: roster.effectiveFrom,
      weekly: roster.weekly,
    })
    .from(roster)
    .innerJoin(centre, eq(centre.id, roster.centreId))
    .where(eq(roster.staffUserId, staffUserId))
    .orderBy(asc(centre.name), asc(roster.effectiveFrom));
}

/**
 * Records a roster version, or replaces the one for the same person, centre and date. Returns its
 * id.
 */
export async function saveRoster(
  db: DbOrTransaction,
  version: {
    staffUserId: string;
    centreId: string;
    effectiveFrom: string;
    weekly: Weekly;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await db
    .insert(roster)
    .values(version)
    .onConflictDoUpdate({
      target: [roster.staffUserId, roster.centreId, roster.effectiveFrom],
      set: { weekly: version.weekly, createdBy: version.createdBy, updatedAt: sql`now()` },
    })
    .returning({ id: roster.id });
  if (!row) throw new Error('The roster was not recorded.');
  return row.id;
}

/** The version in effect on a date at each centre, from a person's versions. */
export function versionsOn(versions: RosterVersion[], date: string): RosterVersion[] {
  const current = new Map<string, RosterVersion>();
  for (const version of versions) {
    const held = current.get(version.centreId);
    if (version.effectiveFrom <= date && (!held || held.effectiveFrom < version.effectiveFrom)) {
      current.set(version.centreId, version);
    }
  }
  return [...current.values()];
}

/** A person's working blocks on a date, per centre (IST minutes). */
export async function rosterOn(
  db: DbOrTransaction,
  staffUserId: string,
  date: string,
): Promise<{ centreId: string; centreName: string; blocks: Weekly[number] }[]> {
  const weekday = isoWeekday(date) - 1;
  return versionsOn(await rosterVersions(db, staffUserId), date)
    .map((version) => ({
      centreId: version.centreId,
      centreName: version.centreName,
      blocks: version.weekly[weekday] ?? [],
    }))
    .filter((day) => day.blocks.length > 0);
}

export type LeaveStatus = (typeof staffLeave.$inferSelect)['status'];

export interface LeaveEntry {
  id: string;
  staffUserId: string;
  staffName: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  note: string | null;
  status: LeaveStatus;
  requestedBy: string;
  decidedBy: string | null;
  declineReason: string | null;
}

const leaveColumns = {
  id: staffLeave.id,
  staffUserId: staffLeave.staffUserId,
  staffName: staffUser.name,
  startsAt: staffLeave.startsAt,
  endsAt: staffLeave.endsAt,
  allDay: staffLeave.allDay,
  note: staffLeave.note,
  status: staffLeave.status,
  requestedBy: staffLeave.requestedBy,
  decidedBy: staffLeave.decidedBy,
  declineReason: staffLeave.declineReason,
};

/** A person's leave, latest first. */
export function leaveFor(db: DbOrTransaction, staffUserId: string): Promise<LeaveEntry[]> {
  return db
    .select(leaveColumns)
    .from(staffLeave)
    .innerJoin(staffUser, eq(staffUser.id, staffLeave.staffUserId))
    .where(eq(staffLeave.staffUserId, staffUserId))
    .orderBy(desc(staffLeave.startsAt));
}

/** Requested leave waiting for a decision, that the reader may see, soonest first. */
export function pendingLeave(db: DbOrTransaction): Promise<LeaveEntry[]> {
  return db
    .select(leaveColumns)
    .from(staffLeave)
    .innerJoin(staffUser, eq(staffUser.id, staffLeave.staffUserId))
    .where(eq(staffLeave.status, 'requested'))
    .orderBy(asc(staffLeave.startsAt));
}

/** One leave entry, or undefined when the reader cannot see it. */
export async function leaveRecord(
  db: DbOrTransaction,
  leaveId: string,
): Promise<LeaveEntry | undefined> {
  const [row] = await db
    .select(leaveColumns)
    .from(staffLeave)
    .innerJoin(staffUser, eq(staffUser.id, staffLeave.staffUserId))
    .where(eq(staffLeave.id, leaveId));
  return row;
}

/** Records leave; returns its id. Approved leave records its decider and time. */
export async function insertLeave(
  db: DbOrTransaction,
  leave: {
    staffUserId: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    note: string | null;
    status: 'requested' | 'approved';
    requestedBy: string;
  },
): Promise<string> {
  const decided =
    leave.status === 'approved' ? { decidedBy: leave.requestedBy, decidedAt: sql`now()` } : {};
  const [row] = await db
    .insert(staffLeave)
    .values({ ...leave, ...decided })
    .returning({ id: staffLeave.id });
  if (!row) throw new Error('The leave was not recorded.');
  return row.id;
}

/** Approves or declines requested leave; false when it is no longer requested. */
export async function decideLeave(
  db: DbOrTransaction,
  leaveId: string,
  decision: { approve: boolean; decidedBy: string; reason: string | null },
): Promise<boolean> {
  const changed = await db
    .update(staffLeave)
    .set({
      status: decision.approve ? 'approved' : 'declined',
      decidedBy: decision.decidedBy,
      decidedAt: sql`now()`,
      declineReason: decision.approve ? null : decision.reason,
      updatedAt: sql`now()`,
    })
    .where(and(eq(staffLeave.id, leaveId), eq(staffLeave.status, 'requested')))
    .returning({ id: staffLeave.id });
  return changed.length > 0;
}

/** Cancels requested or approved leave; false when it is neither. */
export async function cancelLeave(db: DbOrTransaction, leaveId: string): Promise<boolean> {
  const changed = await db
    .update(staffLeave)
    .set({ status: 'cancelled', updatedAt: sql`now()` })
    .where(and(eq(staffLeave.id, leaveId), inArray(staffLeave.status, ['requested', 'approved'])))
    .returning({ id: staffLeave.id });
  return changed.length > 0;
}

export interface TeamMember {
  id: string;
  name: string;
  role: (typeof staffUser.$inferSelect)['role'];
  centreIds: string[];
}

/** The active people who treat patients that the reader sees, by name. */
export async function teamMembers(db: DbOrTransaction): Promise<TeamMember[]> {
  const people = await db
    .select({ id: staffUser.id, name: staffUser.name, role: staffUser.role })
    .from(staffUser)
    .where(
      and(
        eq(staffUser.treatsPatients, true),
        eq(staffUser.active, true),
        eq(staffUser.velyxSupport, false),
      ),
    )
    .orderBy(asc(staffUser.name));
  if (people.length === 0) return [];
  const assignments = await db
    .select({ staffUserId: staffUserCentre.staffUserId, centreId: staffUserCentre.centreId })
    .from(staffUserCentre)
    .where(
      inArray(
        staffUserCentre.staffUserId,
        people.map((p) => p.id),
      ),
    );
  return people.map((person) => ({
    ...person,
    centreIds: assignments.filter((a) => a.staffUserId === person.id).map((a) => a.centreId),
  }));
}

/** A window of time, as UTC instants. */
export interface Window {
  startsAt: Date;
  endsAt: Date;
}

/** `windows` with every part covered by `gaps` cut out. */
export function cutOut<W extends Window>(windows: W[], gaps: Window[]): W[] {
  let pieces = windows;
  for (const gap of gaps) {
    pieces = pieces.flatMap((piece) => {
      if (gap.endsAt <= piece.startsAt || gap.startsAt >= piece.endsAt) return [piece];
      const parts: W[] = [];
      if (gap.startsAt > piece.startsAt) parts.push({ ...piece, endsAt: gap.startsAt });
      if (gap.endsAt < piece.endsAt) parts.push({ ...piece, startsAt: gap.endsAt });
      return parts;
    });
  }
  return pieces;
}

/**
 * When a person can be booked on a date: their roster blocks at each centre, as UTC windows, with
 * approved leave cut out. The slot engine (SCH-04) builds free slots from these.
 */
export async function availabilityOn(
  db: DbOrTransaction,
  staffUserId: string,
  date: string,
): Promise<(Window & { centreId: string })[]> {
  const windows = (await rosterOn(db, staffUserId, date)).flatMap((day) =>
    day.blocks.map((block) => ({
      centreId: day.centreId,
      startsAt: istInstant(date, block.starts),
      endsAt: istInstant(date, block.ends),
    })),
  );
  if (windows.length === 0) return [];
  const leave = await db
    .select({ startsAt: staffLeave.startsAt, endsAt: staffLeave.endsAt })
    .from(staffLeave)
    .where(
      and(
        eq(staffLeave.staffUserId, staffUserId),
        eq(staffLeave.status, 'approved'),
        lt(staffLeave.startsAt, istInstant(addDays(date, 1), 0)),
        gt(staffLeave.endsAt, istInstant(date, 0)),
      ),
    );
  return cutOut(windows, leave);
}

/** Whether a person is assigned to a centre. */
export async function assignedToCentre(
  db: DbOrTransaction,
  staffUserId: string,
  centreId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: staffUserCentre.staffUserId })
    .from(staffUserCentre)
    .where(
      and(eq(staffUserCentre.staffUserId, staffUserId), eq(staffUserCentre.centreId, centreId)),
    );
  return Boolean(row);
}

/** The latest version that starts on or before a date, per centre, plus all later ones. */
export function versionsFrom(versions: RosterVersion[], date: string): RosterVersion[] {
  const current = versionsOn(versions, date);
  return [...current, ...versions.filter((v) => v.effectiveFrom > date)];
}
