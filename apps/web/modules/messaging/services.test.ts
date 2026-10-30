import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { MessagingError, recentMessagesOf, sendTestMessageService } from './services';

vi.mock('server-only', () => ({}));
const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  queueMessage: vi.fn(),
  recentMessages: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
const recipients = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('../settings/settings', () => ({
  getSetting: () => Promise.resolve(recipients.list),
}));

const admin = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000201',
  email: 'admin@clinicmx.test',
  name: 'Test Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
  ...extra,
});
const send = (actor: StaffMember, to: string) =>
  sendTestMessageService({ db: {} as Db, actor }, { to });

// WA-01: the Super Admin proves the connection with a test message to a number on the test list.
describe('test message', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.queueMessage.mockResolvedValue('message-1');
    db.recentMessages.mockResolvedValue([]);
    recipients.list = ['+919845012345'];
  });

  it('queues Meta’s sample to a number on the test list, as the Super Admin', async () => {
    await expect(send(admin(), '+91 98450 12345')).resolves.toEqual({ id: 'message-1' });
    expect(db.queueMessage).toHaveBeenCalledWith(fakeTx, {
      patientId: null,
      toPhone: '+919845012345',
      kind: 'test',
      templateKey: 'hello_world',
      templateVersion: 1,
      language: 'en_US',
      variables: {},
      createdBy: `staff:${admin().id}`,
    });
  });

  it('refuses a number off the test list, other roles and support', async () => {
    await expect(send(admin(), '+919999999999')).rejects.toThrow(MessagingError);
    await expect(send(admin({ role: 'centre_manager' }), '+919845012345')).rejects.toThrow(
      NotAllowedError,
    );
    await expect(send(admin({ support: true }), '+919845012345')).rejects.toThrow(ReadOnlyError);
    expect(db.queueMessage).not.toHaveBeenCalled();
  });

  it('lists recent messages for the Super Admin only', async () => {
    await recentMessagesOf(admin());
    expect(db.recentMessages).toHaveBeenCalledWith(fakeTx, 20);
    db.recentMessages.mockClear();
    expect(await recentMessagesOf(admin({ role: 'front_desk' }))).toEqual([]);
    expect(await recentMessagesOf(admin({ support: true }))).toEqual([]);
    expect(db.recentMessages).not.toHaveBeenCalled();
  });
});
