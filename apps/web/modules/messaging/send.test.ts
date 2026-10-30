import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetrySendError, sendQueuedMessage } from './send';
import type { WhatsAppTransport } from './transport';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  MAX_JOB_ATTEMPTS: 5,
  approvedTemplateVersion: vi.fn(),
  documentForMessage: vi.fn(),
  lastInboundAt: vi.fn(),
  messageRecord: vi.fn(),
  recordMessageOutcome: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const store = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../documents/document-store', () => ({ documentStore: () => store }));
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
const env = vi.hoisted(() => {
  const values: Record<string, string | undefined> = { WHATSAPP_GRAPH_VERSION: 'v25.0' };
  return { values };
});
vi.mock('../../lib/env', () => ({ serverEnv: () => env.values }));

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
  sendSession: vi.fn(() => Promise.resolve(result)),
  uploadMedia: vi.fn(() =>
    Promise.resolve<Awaited<ReturnType<WhatsAppTransport['uploadMedia']>>>({
      ok: true,
      waMessageId: 'media-1',
    }),
  ),
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
    db.approvedTemplateVersion
      .mockReset()
      .mockImplementation((_db: unknown, key: string) =>
        Promise.resolve({ metaName: `${key}_v2`, version: 2 }),
      );
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
      {
        to: '+919999999999',
        template: 'no_show_v2',
        language: 'en',
        parameters: ['Test Patient', '30 Oct', '10:00', 'HSR Layout'],
      },
      expect.any(AbortSignal),
    );
    expect(db.approvedTemplateVersion).toHaveBeenCalledWith({}, 'no_show', 'en');
    expect(outcome()).toEqual([{ status: 'sent', waMessageId: 'wamid.2' }]);
  });

  // WA-06: only a version Meta approved on this number goes, and the newest one.
  it('keeps a clinic template Meta has not approved here as Not sent, without calling Meta', async () => {
    db.messageRecord.mockResolvedValue(clinicMessage());
    db.approvedTemplateVersion.mockResolvedValue(null);
    const meta = transport({ ok: true, waMessageId: 'wamid.5' });
    await send({ transport: meta });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(outcome()).toEqual([
      {
        status: 'skipped',
        errorCode: 'not_approved',
        errorTitle: 'Meta has not approved this template on this number.',
      },
    ]);
  });

  // WA-06 part 2: the patient's own PDF, uploaded to Meta for the send, sent by its media id.
  const patientId = '00000000-0000-4000-8000-000000000b01';
  const documentId = '00000000-0000-4000-8000-000000000b02';
  const summary = () =>
    clinicMessage({
      patientId,
      templateKey: 'consultation_summary',
      variables: {
        patient_name: 'Test Patient',
        plan_link: 'plan-token',
        feedback_link: 'feedback-token',
        document_id: documentId,
        document_name: 'Consultation summary.pdf',
      },
    });

  it('uploads the patient’s PDF, then sends it by Meta’s id with the link tokens', async () => {
    const meta = transport({ ok: true, waMessageId: 'wamid.6' });
    const pdf = new Uint8Array([37, 80, 68, 70]);
    db.documentForMessage.mockResolvedValue({ patientId, filePath: 'p/d.pdf' });
    store.get.mockResolvedValue(pdf);
    db.messageRecord.mockResolvedValue(summary());
    await send({ transport: meta });
    expect(db.documentForMessage).toHaveBeenCalledWith({}, documentId);
    expect(store.get).toHaveBeenCalledWith('p/d.pdf');
    expect(meta.uploadMedia).toHaveBeenCalledWith(
      { bytes: pdf, filename: 'Consultation summary.pdf' },
      expect.any(AbortSignal),
    );
    expect(meta.sendTemplate).toHaveBeenCalledWith(
      {
        to: onList,
        template: 'consultation_summary_v2',
        language: 'en',
        parameters: ['Test Patient'],
        document: { id: 'media-1', filename: 'Consultation summary.pdf' },
        buttons: [
          { index: 0, kind: 'url', suffix: 'plan-token' },
          { index: 1, kind: 'url', suffix: 'feedback-token' },
        ],
      },
      expect.any(AbortSignal),
    );
    expect(outcome()).toEqual([{ status: 'sent', waMessageId: 'wamid.6' }]);
  });

  it('never sends another patient’s PDF, and retries an upload Meta may get over', async () => {
    const meta = transport({ ok: true, waMessageId: 'wamid.7' });
    db.messageRecord.mockResolvedValue(summary());
    db.documentForMessage.mockResolvedValue({ patientId: 'someone-else', filePath: 'x/y.pdf' });
    await send({ transport: meta });
    expect(meta.uploadMedia).not.toHaveBeenCalled();
    expect(outcome()).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'no_document' }),
    ]);

    db.recordMessageOutcome.mockClear();
    db.documentForMessage.mockResolvedValue({ patientId, filePath: 'p/d.pdf' });
    store.get.mockResolvedValue(new Uint8Array([1]));
    meta.uploadMedia.mockResolvedValue({ ok: false, kind: 'http', httpStatus: 503 } as never);
    await expect(send({ transport: meta })).rejects.toThrow(RetrySendError);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends quick reply payloads naming the template and button', async () => {
    const meta = transport({ ok: true, waMessageId: 'wamid.8' });
    db.messageRecord.mockResolvedValue(
      clinicMessage({ templateKey: 'first_treatment_check', variables: { patient_name: 'T' } }),
    );
    await send({ transport: meta });
    expect(meta.sendTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        buttons: [
          { index: 0, kind: 'quick_reply', payload: 'first_treatment_check.better' },
          { index: 1, kind: 'quick_reply', payload: 'first_treatment_check.same' },
          { index: 2, kind: 'quick_reply', payload: 'first_treatment_check.still_sore' },
        ],
      }),
      expect.any(AbortSignal),
    );
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

// WA-03: the router's replies go as plain messages, only inside WhatsApp's 24 hour window.
describe('sending a router reply', () => {
  const reply = (templateKey: string, variables: Record<string, string> = {}) =>
    queued({ kind: 'session', templateKey, language: 'en', variables });
  beforeEach(() => {
    db.messageRecord.mockReset();
    db.recordMessageOutcome.mockReset().mockResolvedValue(true);
    db.lastInboundAt.mockReset().mockResolvedValue(new Date(Date.now() - 60_000));
    settings.values = {
      'whatsapp.test_recipients_only': true,
      'whatsapp.test_recipients': [onList],
    };
  });

  it('sends the menu with its three buttons, and the contact details as text', async () => {
    db.messageRecord.mockResolvedValue(reply('menu'));
    const meta = transport({ ok: true, waMessageId: 'wamid.menu' });
    await send({ transport: meta });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    expect(meta.sendSession).toHaveBeenCalledWith(
      {
        to: onList,
        text: 'How can we help you today?',
        buttons: [
          { id: 'menu.book', title: 'Book appointment' },
          { id: 'menu.reschedule', title: 'Reschedule or cancel' },
          { id: 'menu.talk', title: 'Talk to our team' },
        ],
      },
      expect.any(AbortSignal),
    );
    db.messageRecord.mockResolvedValue(
      reply('contact', { text: 'To talk to our team, call 080.' }),
    );
    await send({ transport: meta });
    expect(meta.sendSession).toHaveBeenLastCalledWith(
      { to: onList, text: 'To talk to our team, call 080.' },
      expect.any(AbortSignal),
    );
    expect(outcome().map((o) => o.status)).toEqual(['sent', 'sent']);
  });

  // WA-04, WA-05: the booking and reschedule forms, each with its Flow and session token.
  it('sends each form with its own Flow, text and button, as a draft on the test number', async () => {
    env.values = {
      WHATSAPP_GRAPH_VERSION: 'v25.0',
      WHATSAPP_BOOKING_FLOW_ID: '1000000000000004',
      WHATSAPP_RESCHEDULE_FLOW_ID: '1000000000000005',
      WHATSAPP_FLOW_MODE: 'draft',
    };
    const meta = transport({ ok: true, waMessageId: 'wamid.form' });
    db.messageRecord.mockResolvedValue(reply('reschedule_flow', { flowToken: 'session-2' }));
    await send({ transport: meta });
    expect(meta.sendSession).toHaveBeenLastCalledWith(
      {
        to: onList,
        text: 'Move your appointment to another day or time.',
        flow: { id: '1000000000000005', token: 'session-2', cta: 'Reschedule', mode: 'draft' },
      },
      expect.any(AbortSignal),
    );
    db.messageRecord.mockResolvedValue(reply('booking_flow', { flowToken: 'session-1' }));
    await send({ transport: meta });
    expect((meta.sendSession.mock.lastCall as unknown[] | undefined)?.[0]).toMatchObject({
      flow: { id: '1000000000000004', cta: 'Book appointment' },
    });
    // Where its Flow is not set up on this server, the form is not sent.
    env.values = { WHATSAPP_GRAPH_VERSION: 'v25.0', WHATSAPP_BOOKING_FLOW_ID: '1000000000000004' };
    db.messageRecord.mockResolvedValue(reply('reschedule_flow', { flowToken: 'session-3' }));
    await send({ transport: meta });
    expect(meta.sendSession).toHaveBeenCalledTimes(2);
    expect(outcome().map((o) => o.status)).toEqual(['sent', 'sent', 'skipped']);
    env.values = { WHATSAPP_GRAPH_VERSION: 'v25.0' };
  });

  it('keeps it as Not sent once 24 hours have passed since they wrote, or if they never did', async () => {
    db.messageRecord.mockResolvedValue(reply('menu'));
    const meta = transport({ ok: true, waMessageId: 'wamid.late' });
    db.lastInboundAt.mockResolvedValue(new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000));
    await send({ transport: meta });
    db.lastInboundAt.mockResolvedValue(null);
    await send({ transport: meta });
    expect(meta.sendSession).not.toHaveBeenCalled();
    expect(outcome()).toEqual([
      expect.objectContaining({ status: 'skipped', errorCode: 'window_closed' }),
      expect.objectContaining({ status: 'skipped', errorCode: 'window_closed' }),
    ]);
  });

  it('keeps a reply to a number off the test list as Not sent while the list is on', async () => {
    db.messageRecord.mockResolvedValue(
      queued({ kind: 'session', templateKey: 'menu', toPhone: '+919999999999' }),
    );
    const meta = transport({ ok: true, waMessageId: 'wamid.off' });
    await send({ transport: meta });
    expect(meta.sendSession).not.toHaveBeenCalled();
    expect(outcome()).toEqual([expect.objectContaining({ errorCode: 'not_on_test_list' })]);
  });
});
