import type { StaffRole } from '@clinic-mx/schemas';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { centre, patient, staffUser, task, type taskPriorities } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The tasks inbox (ALT-03). Row level security gives each person the tasks for them, and the
 * untaken tasks for their role at centres they see (all of them for the Super Admin); the
 * lifecycle trigger lets staff only take a role task for themselves and close a task with a
 * written decision, as themselves (docs/runbooks/tasks.md).
 */

const taker = alias(staffUser, 'task_taker');
const closer = alias(staffUser, 'task_closer');

/** A task as its card shows it. */
export interface TaskEntry {
  id: string;
  kind: string;
  title: string;
  details: Record<string, unknown>;
  priority: (typeof taskPriorities)[number];
  status: 'open' | 'closed';
  assigneeRole: StaffRole | null;
  assigneeStaffUserId: string | null;
  /** Who it is with, when one person has it. */
  assigneeName: string | null;
  takenAt: Date | null;
  dueAt: Date | null;
  centreId: string | null;
  centreName: string | null;
  patientId: string | null;
  patientName: string | null;
  patientNumber: string | null;
  decision: string | null;
  closedBy: string | null;
  closedAt: Date | null;
  createdAt: Date;
}

function taskEntries(db: DbOrTransaction) {
  return db
    .select({
      id: task.id,
      kind: task.kind,
      title: task.title,
      details: task.details,
      priority: task.priority,
      status: task.status,
      assigneeRole: task.assigneeRole,
      assigneeStaffUserId: task.assigneeStaffUserId,
      assigneeName: taker.name,
      takenAt: task.takenAt,
      dueAt: task.dueAt,
      centreId: task.centreId,
      centreName: centre.name,
      patientId: task.patientId,
      patientName: patient.name,
      patientNumber: patient.opNumber,
      decision: task.decision,
      closedBy: closer.name,
      closedAt: task.closedAt,
      createdAt: task.createdAt,
    })
    .from(task)
    .leftJoin(taker, eq(taker.id, task.assigneeStaffUserId))
    .leftJoin(closer, eq(closer.id, task.closedBy))
    .leftJoin(centre, eq(centre.id, task.centreId))
    .leftJoin(patient, eq(patient.id, task.patientId));
}

/**
 * The open tasks the signed in person sees, most urgent first: by priority, then those overdue,
 * then by due time (none last), then the oldest.
 */
export async function inboxTasks(db: DbOrTransaction): Promise<TaskEntry[]> {
  const rows = await taskEntries(db)
    .where(eq(task.status, 'open'))
    .orderBy(
      sql`case ${task.priority} when 'urgent' then 0 when 'high' then 1 else 2 end`,
      sql`case when ${task.dueAt} < now() then 0 else 1 end`,
      sql`${task.dueAt} asc nulls last`,
      asc(task.createdAt),
      asc(task.id),
    );
  return rows as TaskEntry[];
}

/** The most recently closed tasks the signed in person sees. */
export async function recentlyClosedTasks(
  db: DbOrTransaction,
  limit: number,
): Promise<TaskEntry[]> {
  const rows = await taskEntries(db)
    .where(eq(task.status, 'closed'))
    .orderBy(desc(task.closedAt), desc(task.id))
    .limit(limit);
  return rows as TaskEntry[];
}

/** How many open tasks the signed in person sees, for the Home link. */
export async function openTaskCount(db: DbOrTransaction): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(task)
    .where(eq(task.status, 'open'));
  return row?.n ?? 0;
}

/** A task locked for taking or closing, as the signed in person sees it. */
export interface TaskForUpdate {
  id: string;
  status: 'open' | 'closed';
  assigneeRole: StaffRole | null;
  assigneeStaffUserId: string | null;
  centreId: string | null;
}

export async function taskForUpdate(
  tx: DbOrTransaction,
  taskId: string,
): Promise<TaskForUpdate | undefined> {
  const [row] = await tx
    .select({
      id: task.id,
      status: task.status,
      assigneeRole: task.assigneeRole,
      assigneeStaffUserId: task.assigneeStaffUserId,
      centreId: task.centreId,
    })
    .from(task)
    .where(eq(task.id, taskId))
    .for('update');
  return row;
}

/** Takes an open, untaken role task for this person; whether it was taken. */
export async function takeTask(
  tx: DbOrTransaction,
  taskId: string,
  staffUserId: string,
): Promise<boolean> {
  const taken = await tx
    .update(task)
    .set({ assigneeStaffUserId: staffUserId })
    .where(and(eq(task.id, taskId), eq(task.status, 'open'), isNull(task.assigneeStaffUserId)))
    .returning({ id: task.id });
  return taken.length > 0;
}

/**
 * Closes an open task with the decision. A role task nobody has taken is taken in the same step,
 * so a closed task always names who had it. Whether it closed.
 */
export async function closeTask(
  tx: DbOrTransaction,
  taskId: string,
  staffUserId: string,
  decision: string,
): Promise<boolean> {
  const closed = await tx
    .update(task)
    .set({
      status: 'closed',
      decision,
      closedBy: staffUserId,
      assigneeStaffUserId: sql`coalesce(${task.assigneeStaffUserId}, ${staffUserId}::uuid)`,
    })
    .where(and(eq(task.id, taskId), eq(task.status, 'open')))
    .returning({ id: task.id });
  return closed.length > 0;
}
