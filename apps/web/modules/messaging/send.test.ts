import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetrySendError, sendQueuedMessage } from './send';
import type { WhatsAppTransport } from './transport';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  MAX_JOB_ATTEMPTS: 5,
  messageRecord: vi.fn(),
  recordMessageOutcome: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));
const settings = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  return { values };
});
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings.values[key]),
}));
vi.mock('../../lib/env', () => ({ serverEnv: () => ({ WHATSAPP_GRAPH_VERSION: 'v25.0' }) }));

const messageId = '00000000-0000-4000-8000-000000000901';
const onList = '+919845012345';
const queued = (extra: Record<string, unknown> = {}) => ({
  id: messageId,
  toPhone: onList,
  kind: 'test',
  templateKey: 'hello_world',
  language: 'en_US',
  variables: {},
  status: 'queued',
  ...extra,
});
const transport = (result: Awaited<ReturnType<WhatsAppTransport['sendTemplate']>>) => ({
  sendTemplate: vi.fn(() => Promise.resolve(result)),
});
const send = (options: { attempt?: number; transport?: WhatsAppTransport } = {}) =>
  sendQueuedMessage({} as Db, messageId, { attempt: 1, ...options });
const outcome = () =>
  db.recordMessageOutcome.mock.calls.map((call) => call[2] as { status: string });

// WA-01 done when: messages send with retries; message rows stored.
describe('sending a queued WhatsApp message', () => {
  beforeEach(() => {
    db.messageRecord.mockReset().mockResolvedValue(queued());
    db.recordMessageOutcome.mockReset().mockResolvedValue(true);
    settings.values = {
      'whatsapp.test_recipients_only': true,
      'whatsapp.test_recipients': [onList],
    };
  });

  it('sends to a number on the test list and keeps Meta’s id', async () => {
    const meta = transport({ ok: true, waMessageId: 'wamid.1' });
    await send({ transport: meta });
    expect(meta.sendTemplate).toHaveBeenCalledWith(
      { to: onList, template: 'hello_world', language: 'en_US', parameters: [] },
      expect.any(AbortSignal),
    );
    expect(db.recordMessageOutcome).toHaveBeenCalledWith('system-tx', messageId, {
      status: 'sent',
      waMessageId: 'wamid.1',
    });
  });

  const clinicMessage = (extra: Record<string, unknown> = {}) =>
    queued({
      kind: 'template',
      templateKey: 'no_show',
      language: 'en',
      // Given out of order: the registry's order is what is sent.
      variables: {
        clinic: 'HSR Layout',
        time: '10:00',
        patient_name: 'Test Patient',
        date: '30 Oct',
      },
      ...extra,
    });

  it('keeps a clinic message to a number off the test list as Not sent, without calling Meta', async () => {
    db.messageRecord.mockResolvedValue(clinicMessage({ toPhone: '+919999999999' }));
    const meta = transport({ ok: true, waMessageId: 'wamid.1' });
    await send({ transport: meta });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(outcome()).toEqual([
      expect.objectContaining({ status: 'skipped', errorCode: 'not_on_test_list' }),
    ]);
  });

  it('sends to anyone once the test list is switched off, with the template’s variables in order', async () => {
    settings.values['whatsapp.test_recipients_only'] = false;
    db.messageRecord.mockResolvedValue(clinicMessage({ toPhone: '+919999999999' }));
    const meta = transport({ ok: true, waMessageId: 'wamid.2' });
    await send({ transport: meta });
    expect(meta.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'no_show',
        language: 'en',
        parameters: ['Test Patient', '30 Oct', '10:00', 'HSR Layout'],
      }),
      expect.any(AbortSignal),
    );
    expect(outcome()).toEqual([{ status: 'sent', waMessageId: 'wamid.2' }]);
  });

  it('sends a test message checked against the list when it was queued', async () => {
    settings.values['whatsapp.test_recipients'] = [];
    await send({ transport: transport({ ok: true, waMessageId: 'wamid.4' }) });
    expect(outcome()).toEqual([{ status: 'sent', waMessageId: 'wamid.4' }]);
  });

  it('keeps it as Not sent when WhatsApp is not configured on this server', async () => {
    await send();
    expect(outcome()).toEqual([
      expect.objectContaining({ status: 'skipped', errorCode: 'not_configured' }),
    ]);
  });

  it('throws on a failure Meta may get over, so the queue tries again, and fails it at the last attempt', async () => {
    const busy = transport({
      ok: false,
      kind: 'http',
      httpStatus: 503,
      title: 'Service unavailable',
    });
    await expect(send({ transport: busy })).rejects.toThrow(RetrySendError);
    expect(outcome()).toEqual([expect.objectContaining({ status: 'queued', errorCode: 'http' })]);
    db.recordMessageOutcome.mockClear();
    await send({ transport: busy, attempt: 5 });
    expect(outcome()).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('fails a refusal at once with Meta’s code and title', async () => {
    await send({
      transport: transport({
        ok: false,
        kind: 'http',
        httpStatus: 400,
        code: '131030',
        title: 'Recipient not allowed',
      }),
    });
    expect(outcome()).toEqual([
      { status: 'failed', errorCode: '131030', errorTitle: 'Recipient not allowed' },
    ]);
  });

  it('leaves a message already sent, failed or not sent alone', async () => {
    db.messageRecord.mockResolvedValue(queued({ status: 'sent' }));
    const meta = transport({ ok: true, waMessageId: 'wamid.3' });
    await send({ transport: meta });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(db.recordMessageOutcome).not.toHaveBeenCalled();
  });
});
