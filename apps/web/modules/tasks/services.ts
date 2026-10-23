import 'server-only';
import {
  closeTask as closeTaskRow,
  inboxTasks,
  openRedFlagAlerts,
  openTaskCount,
  recentlyClosedTasks,
  takeTask as takeTaskRow,
  taskForUpdate,
  type StaffMember,
  type TaskEntry,
} from '@clinic-mx/db';
import { can, closeTaskSchema, takeTaskSchema } from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService, type ServiceTransaction } from '../access/service';
import { asStaff } from '../access/staff-db';

/**
 * The tasks inbox (ALT-03, PRD M11): the open tasks for the signed in person and their role at
 * their centres, most urgent first; one person may take a role task; every task is closed with a
 * written decision. Decisions (user, 24 October 2026): the inbox lists tasks, with one line for
 * open red flag alerts on top for those who read them; "Take it" takes a role task for oneself.
 */

/** A refusal to show staff as it is. */
export class TaskError extends Error {
  override name = 'TaskError';
}

/** How many closed tasks the inbox keeps below the open ones. */
const RECENTLY_CLOSED_SHOWN = 20;

export interface TasksView {
  open: TaskEntry[];
  recentlyClosed: TaskEntry[];
  /** Open red flag alerts the person reads, for the line that opens the alerts list. */
  openAlerts: number;
  canAct: boolean;
}

export async function inboxOf(actor: StaffMember): Promise<TasksView> {
  assertMay(actor, 'tasks.view');
  return asStaff(actor, async (tx) => ({
    open: await inboxTasks(tx),
    recentlyClosed: await recentlyClosedTasks(tx, RECENTLY_CLOSED_SHOWN),
    openAlerts:
      can(actor, 'red_flags.view') && !actor.support ? (await openRedFlagAlerts(tx)).length : 0,
    canAct: can(actor, 'tasks.act') && !actor.support,
  }));
}

/** The open task count for the Home link. */
export async function openTasksOf(actor: StaffMember): Promise<number> {
  if (!can(actor, 'tasks.view')) return 0;
  return asStaff(actor, (tx) => openTaskCount(tx));
}

/** The task as the person sees it, open; its centre for the permission check. */
async function openTask(tx: ServiceTransaction, taskId: string) {
  const found = await taskForUpdate(tx, taskId);
  if (!found) throw new TaskError('That task was not found.');
  if (found.status !== 'open') throw new TaskError('This task is already closed.');
  return found;
}

/** "Take it": a role task becomes this person's, and leaves everyone else's list. */
export const takeTask = staffService({
  action: 'tasks.act',
  input: takeTaskSchema,
  target: async (input, tx) => {
    const found = await openTask(tx, input.taskId);
    return found.centreId ? { centreId: found.centreId } : {};
  },
  run: async (tx, input, actor) => {
    const found = await openTask(tx, input.taskId);
    if (found.assigneeStaffUserId) {
      throw new TaskError(
        found.assigneeStaffUserId === actor.id
          ? 'You have this task already.'
          : 'Someone else has taken this task.',
      );
    }
    if (!(await takeTaskRow(tx, input.taskId, actor.id))) {
      throw new TaskError('The task changed meanwhile. Reload and try again.');
    }
  },
});

/** Close with a written decision; a role task nobody took is taken by the person closing it. */
export const closeTask = staffService({
  action: 'tasks.act',
  input: closeTaskSchema,
  target: async (input, tx) => {
    const found = await openTask(tx, input.taskId);
    return found.centreId ? { centreId: found.centreId } : {};
  },
  run: async (tx, input, actor) => {
    const found = await openTask(tx, input.taskId);
    if (found.assigneeStaffUserId && found.assigneeStaffUserId !== actor.id) {
      throw new TaskError('Someone else has taken this task.');
    }
    if (!(await closeTaskRow(tx, input.taskId, actor.id, input.decision))) {
      throw new TaskError('The task changed meanwhile. Reload and try again.');
    }
  },
});
