import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { closeTask, inboxOf, takeTask, TaskError } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  taskForUpdate: vi.fn(),
  takeTask: vi.fn(),
  closeTask: vi.fn(),
  inboxTasks: vi.fn(),
  recentlyClosedTasks: vi.fn(),
  openTaskCount: vi.fn(),
  openRedFlagAlerts: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const taskId = '00000000-0000-4000-8000-000000000801';
const desk = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000207',
  email: 'desk@clinicmx.test',
  name: 'Test Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = desk()) => ({ db: {} as Db, actor });
const roleTask = (extra: Record<string, unknown> = {}) => ({
  id: taskId,
  status: 'open',
  assigneeRole: 'front_desk',
  assigneeStaffUserId: null,
  centreId: hsr,
  ...extra,
});

// ALT-03: take a role task for yourself; close a task only with a written decision.
describe('tasks', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.takeTask.mockResolvedValue(true);
    db.closeTask.mockResolvedValue(true);
  });

  it('takes an untaken role task for the person, and refuses one already taken', async () => {
    db.taskForUpdate.mockResolvedValue(roleTask());
    await takeTask(context(), { taskId });
    expect(db.takeTask).toHaveBeenCalledWith(fakeTx, taskId, desk().id);

    db.taskForUpdate.mockResolvedValue(roleTask({ assigneeStaffUserId: 'someone-else' }));
    await expect(takeTask(context(), { taskId })).rejects.toThrow(
      'Someone else has taken this task.',
    );
    db.taskForUpdate.mockResolvedValue(roleTask({ assigneeStaffUserId: desk().id }));
    await expect(takeTask(context(), { taskId })).rejects.toThrow('You have this task already.');
  });

  it('closes with the decision, trimmed, as the person closing', async () => {
    db.taskForUpdate.mockResolvedValue(roleTask());
    await closeTask(context(), { taskId, decision: '  Called back; rebooked  ' });
    expect(db.closeTask).toHaveBeenCalledWith(fakeTx, taskId, desk().id, 'Called back; rebooked');
  });

  it('refuses a close without a decision, before anything is read', async () => {
    await expect(closeTask(context(), { taskId, decision: '   ' })).rejects.toThrow(
      'Write the decision before closing.',
    );
    expect(db.taskForUpdate).not.toHaveBeenCalled();
  });

  it('refuses a closed task, a missing one, a lost race and someone else’s', async () => {
    db.taskForUpdate.mockResolvedValue(roleTask({ status: 'closed' }));
    await expect(closeTask(context(), { taskId, decision: 'Done' })).rejects.toThrow(
      'This task is already closed.',
    );
    db.taskForUpdate.mockResolvedValue(undefined);
    await expect(closeTask(context(), { taskId, decision: 'Done' })).rejects.toThrow(
      'That task was not found.',
    );
    db.taskForUpdate.mockResolvedValue(roleTask());
    db.closeTask.mockResolvedValue(false);
    await expect(closeTask(context(), { taskId, decision: 'Done' })).rejects.toThrow(TaskError);
    db.taskForUpdate.mockResolvedValue(roleTask({ assigneeStaffUserId: 'someone-else' }));
    await expect(closeTask(context(), { taskId, decision: 'Done' })).rejects.toThrow(
      'Someone else has taken this task.',
    );
  });

  it('refuses a task at a centre the person does not work at', async () => {
    db.taskForUpdate.mockResolvedValue(roleTask({ centreId: koramangala }));
    await expect(takeTask(context(), { taskId })).rejects.toThrow(NotAllowedError);
  });

  it('refuses Velyx support, who only reads', async () => {
    const support = desk({ role: 'super_admin', support: true });
    await expect(takeTask(context(support), { taskId })).rejects.toThrow(ReadOnlyError);
  });

  it('shows clinicians their open alert count, and nobody else', async () => {
    db.inboxTasks.mockResolvedValue([]);
    db.recentlyClosedTasks.mockResolvedValue([]);
    db.openRedFlagAlerts.mockResolvedValue([{}, {}]);
    expect((await inboxOf(desk())).openAlerts).toBe(0);
    const physio = desk({ role: 'physiotherapist', treatsPatients: true });
    expect(await inboxOf(physio)).toMatchObject({ openAlerts: 2, canAct: true });
  });
});
