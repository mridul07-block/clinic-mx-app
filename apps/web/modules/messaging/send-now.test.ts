import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFlowMessagesNow, sendQueuedNow, showTyping } from './send-now';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  BOOKING_CONFIRMATION_JOB: 'whatsapp.booking_confirmation',
  flowSessionRecord: vi.fn(),
  messageRecord: vi.fn(),
  queuedSendKeys: vi.fn(),
  runJobsNow: vi.fn<(db: unknown, handlers: unknown, keys: string[]) => Promise<unknown>>(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('./conversation-jobs', () => ({ conversationJobs: {} }));
const transport = vi.hoisted(() => ({ markReadTyping: vi.fn() }));
vi.mock('./transport', () => transport);
const settings = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  return { values };
});
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings.values[key]),
}));
const env = vi.hoisted(() => {
  const values: Record<string, string | undefined> = {};
  return { values };
});
vi.mock('../../lib/env', () => ({ serverEnv: () => env.values }));

// Reply speed (WA-03, 1 November 2026). Generated numbers only.
const phone = '+919845012399';
const anyDb = {} as Db;
const ran = (claimed: number) => ({ claimed, done: claimed, failed: 0, timedOut: 0 });

beforeEach(() => {
  for (const fn of [
    db.flowSessionRecord,
    db.messageRecord,
    db.queuedSendKeys,
    db.runJobsNow,
    transport.markReadTyping,
  ]) {
    fn.mockReset();
  }
  env.values = {
    WHATSAPP_ACCESS_TOKEN: 'fake',
    WHATSAPP_PHONE_NUMBER_ID: '111',
    WHATSAPP_GRAPH_VERSION: 'v25.0',
  };
  settings.values = {
    'whatsapp.test_recipients_only': true,
    'whatsapp.test_recipients': [phone],
  };
});

describe('sendQueuedNow', () => {
  it('sends what is queued, then what those sends queued in their place', async () => {
    db.queuedSendKeys
      .mockResolvedValueOnce(['whatsapp.send:form'])
      .mockResolvedValueOnce(['whatsapp.send:contact'])
      .mockResolvedValueOnce([]);
    db.runJobsNow.mockResolvedValue(ran(1));
    await sendQueuedNow(anyDb, phone);
    expect(db.runJobsNow.mock.calls.map((call) => call[2])).toEqual([
      ['whatsapp.send:form'],
      ['whatsapp.send:contact'],
    ]);
  });

  it('stops when nothing could be claimed, and after its rounds', async () => {
    db.queuedSendKeys.mockResolvedValue(['whatsapp.send:waiting']);
    db.runJobsNow.mockResolvedValue(ran(0));
    await sendQueuedNow(anyDb, phone);
    expect(db.runJobsNow).toHaveBeenCalledTimes(1);
    db.runJobsNow.mockReset().mockResolvedValue(ran(1));
    await sendQueuedNow(anyDb, phone);
    expect(db.runJobsNow).toHaveBeenCalledTimes(3);
  });
});

describe('showTyping', () => {
  const inbound = (extra: Record<string, unknown> = {}) => ({
    direction: 'inbound',
    fromPhone: phone,
    waMessageId: 'wamid.IN1',
    ...extra,
  });

  it('marks the message read with "typing…" for a number on the test list', async () => {
    db.messageRecord.mockResolvedValue(inbound());
    transport.markReadTyping.mockResolvedValue(true);
    await showTyping(anyDb, 'message-1');
    expect(transport.markReadTyping).toHaveBeenCalledWith(
      { accessToken: 'fake', phoneNumberId: '111', graphVersion: 'v25.0' },
      'wamid.IN1',
      expect.any(AbortSignal),
    );
  });

  it('does nothing off the list, unconfigured, or for our own message, and never throws', async () => {
    db.messageRecord.mockResolvedValue(inbound({ fromPhone: '+919845012300' }));
    await showTyping(anyDb, 'message-1');
    db.messageRecord.mockResolvedValue(inbound({ direction: 'outbound' }));
    await showTyping(anyDb, 'message-1');
    env.values = {};
    db.messageRecord.mockResolvedValue(inbound());
    await showTyping(anyDb, 'message-1');
    expect(transport.markReadTyping).not.toHaveBeenCalled();
    env.values = { WHATSAPP_ACCESS_TOKEN: 'fake', WHATSAPP_PHONE_NUMBER_ID: '111' };
    db.messageRecord.mockRejectedValue(new Error('database busy'));
    await expect(showTyping(anyDb, 'message-1')).resolves.toBeUndefined();
  });
});

describe('sendFlowMessagesNow', () => {
  const token = '00000000-0000-4000-8000-000000000801';

  it('writes and sends the confirmation of what the form booked, at once', async () => {
    db.flowSessionRecord.mockResolvedValue({ phone, appointmentId: 'visit-1' });
    db.runJobsNow.mockResolvedValue(ran(1));
    db.queuedSendKeys.mockResolvedValueOnce(['whatsapp.send:confirmation']).mockResolvedValue([]);
    await sendFlowMessagesNow(anyDb, token);
    expect(db.runJobsNow.mock.calls.map((call) => call[2])).toEqual([
      ['whatsapp.booking_confirmation:visit-1'],
      ['whatsapp.send:confirmation'],
    ]);
  });

  it('does nothing before the form has booked, or for a token not ours', async () => {
    db.flowSessionRecord.mockResolvedValue({ phone, appointmentId: null });
    await sendFlowMessagesNow(anyDb, token);
    await sendFlowMessagesNow(anyDb, 'not-a-token');
    expect(db.runJobsNow).not.toHaveBeenCalled();
  });
});
