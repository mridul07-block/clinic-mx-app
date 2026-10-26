import type { TaskEntry } from '@clinic-mx/db';
import {
  UNSIGNED_NOTES_TASK,
  can,
  documentDateTime,
  formatIstDateTime,
  staffRoleLabels,
  taskKindLabel,
  taskPriorityLabels,
  unsignedNotesOf,
  type TaskPriority,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { inboxOf } from '../../../../../modules/tasks/services';
import { CloseTaskForm, TakeForm } from './task-forms';

export const metadata: Metadata = { title: 'Tasks · Clinic Mx' };
export const dynamic = 'force-dynamic';

const priorityTone: Record<TaskPriority, Tone> = {
  urgent: 'danger',
  high: 'waiting',
  normal: 'neutral',
};

/** Who the task is with: the person who has it, or the role (and centre) it is for. */
function holder(task: TaskEntry, viewerId: string): string {
  if (task.assigneeStaffUserId) {
    if (task.assigneeStaffUserId === viewerId) return task.takenAt ? 'Taken by you' : 'For you';
    return `${task.takenAt ? 'Taken by' : 'For'} ${task.assigneeName ?? 'a colleague'}`;
  }
  const role = task.assigneeRole ? staffRoleLabels[task.assigneeRole] : 'Staff';
  return task.centreName ? `For ${role} at ${task.centreName}` : `For ${role}`;
}

/** The facts a job failure task carries, for the Super Admin. */
function JobFailure({ details }: { details: Record<string, unknown> }) {
  const kind = typeof details.kind === 'string' ? details.kind : null;
  const attempts = typeof details.attempts === 'number' ? details.attempts : null;
  if (!kind) return null;
  return (
    <p className="text-sm text-ink-secondary">
      Job <span className="font-mono">{kind}</span>
      {attempts === null ? '' : `, ${String(attempts)} attempts`}. See the jobs runbook.
    </p>
  );
}

/** The notes an unsigned notes task lists (CLN-10): the visit and the physio, never the patient. */
function UnsignedNotes({ details }: { details: Record<string, unknown> }) {
  const notes = unsignedNotesOf(details);
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink-secondary" data-testid="unsigned-notes">
      {notes.map((note) => (
        <li key={[note.number, note.kind].join('-')}>
          {note.kind === 'consultation' ? 'Consultation' : 'Session'} · {note.physio} ·{' '}
          {documentDateTime(new Date(note.startsAt))} ·{' '}
          <span className="whitespace-nowrap font-mono">{note.number}</span>
        </li>
      ))}
    </ul>
  );
}

function TaskCard({
  task,
  viewerId,
  now,
  canAct,
  opensPatients,
}: {
  task: TaskEntry;
  viewerId: string;
  now: Date;
  canAct: boolean;
  opensPatients: boolean;
}) {
  const overdue = task.status === 'open' && task.dueAt !== null && task.dueAt < now;
  const untaken = task.assigneeStaffUserId === null;
  return (
    <li
      data-testid="task-card"
      data-task={task.id}
      data-status={task.status}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{task.title}</span>
          <Tag tone={priorityTone[task.priority]}>{taskPriorityLabels[task.priority]}</Tag>
          {overdue ? <Tag tone="danger">Overdue</Tag> : null}
          {task.status === 'closed' ? <Tag tone="done">Closed</Tag> : null}
        </span>
        <p className="text-sm text-ink-muted">
          {taskKindLabel(task.kind)}
          {task.status === 'open' ? (
            <>
              {' · '}
              <span data-testid="task-holder">{holder(task, viewerId)}</span>
            </>
          ) : null}
        </p>
        {task.dueAt && task.status === 'open' ? (
          <p className="text-sm text-ink-secondary">
            {overdue ? 'Overdue since' : 'Due'} {formatIstDateTime(task.dueAt)}
          </p>
        ) : null}
        {task.patientId && task.patientName ? (
          opensPatients ? (
            <Link
              href={`/app/patients/${task.patientId}`}
              className="self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3"
            >
              {task.patientName}
              {task.patientNumber ? ` · ${task.patientNumber}` : ''}
            </Link>
          ) : (
            <p className="text-sm text-ink">{task.patientName}</p>
          )
        ) : null}
        {task.kind === 'job.failed' ? <JobFailure details={task.details} /> : null}
        {task.kind === UNSIGNED_NOTES_TASK ? <UnsignedNotes details={task.details} /> : null}
      </div>
      {task.decision ? (
        <p className="text-sm text-ink-secondary" data-testid="task-decision">
          <span className="font-medium text-ink">Decision: </span>
          {task.decision}
          {task.closedAt
            ? ` · ${formatIstDateTime(task.closedAt)}${task.closedBy ? ` · ${task.closedBy}` : ''}`
            : ''}
        </p>
      ) : null}
      {canAct && task.status === 'open' ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          {untaken && task.assigneeRole ? <TakeForm taskId={task.id} /> : null}
          <CloseTaskForm taskId={task.id} />
        </div>
      ) : null}
    </li>
  );
}

// Tasks (ALT-03, PRD M11; Frontend Specification "Tasks": assigned to me, sorted by urgency, close
// with decision). The open tasks for the person and their role at their centres, most urgent
// first; "Take it" makes a role task yours; every task closes with a written decision. Open red
// flag alerts have their own page; those who read them see one line here that opens it.
export default async function TasksPage() {
  const staff = await requirePermission('tasks.view');
  const { open, recentlyClosed, openAlerts, canAct } = await inboxOf(staff);
  const now = new Date();
  const opensPatients = can(staff, 'patients.view_contact');
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Tasks</h1>
        <p className="text-sm text-ink-muted">
          Most urgent first. Close each with what was done or decided.
        </p>
      </div>
      {openAlerts > 0 ? (
        <Link
          href="/app/alerts"
          data-testid="tasks-alerts-line"
          className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface p-4 font-medium text-ink pointer-coarse:py-5"
        >
          <span>
            {openAlerts} open red flag {openAlerts === 1 ? 'alert' : 'alerts'}
          </span>
          <span className="text-accent underline underline-offset-2">Open alerts</span>
        </Link>
      ) : null}
      <section className="flex flex-col gap-3" aria-labelledby="open-tasks">
        <h2 id="open-tasks" className="font-semibold text-ink">
          Open
        </h2>
        {open.length === 0 ? (
          <FormMessage tone="info">No open tasks.</FormMessage>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="open-tasks">
            {open.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                viewerId={staff.id}
                now={now}
                canAct={canAct}
                opensPatients={opensPatients}
              />
            ))}
          </ul>
        )}
      </section>
      {recentlyClosed.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="closed-tasks">
          <h2 id="closed-tasks" className="font-semibold text-ink">
            Recently closed
          </h2>
          <ul className="flex flex-col gap-3" data-testid="closed-tasks">
            {recentlyClosed.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                viewerId={staff.id}
                now={now}
                canAct={false}
                opensPatients={opensPatients}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
