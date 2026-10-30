import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusAheadOfSendError, UNKNOWN_STATUS_WAIT_MS, handleWhatsappEvent } from './webhook';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  applyDeliveryUpdate: vi.fn(),
  applyTemplateUpdate: vi.fn(),
  markWhatsappEventProcessed: vi.fn(),
  recordInboundMessage: vi.fn(),
  storeWhatsappEvent: vi.fn(),
  whatsappEventRecord: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));

// WA-02: a stored webhook body becomes delivery statuses and inbound messages, once.
const eventId = '00000000-0000-4000-8000-000000000601';
const received = new Date('2026-10-30T10:00:00Z');
const soon = new Date(received.getTime() + 60_000);
const muchLater = new Date(received.getTime() + UNKNOWN_STATUS_WAIT_MS + 1);

const payload = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value }] }],
});
const statuses = payload({
  statuses: [
    { id: 'wamid.OUT1', status: 'sent', timestamp: '1793350000' },
    { id: 'wamid.OUT1', status: 'delivered', timestamp: '1793350001' },
    { id: 'wamid.OUT1', status: 'read', timestamp: '1793350002' },
  ],
});
const inbound = payload({
  messages: [
    {
      from: '919845012345',
      id: 'wamid.IN1',
      timestamp: '1793350100',
      type: 'text',
      text: { body: 'Hi' },
    },
  ],
});
const event = (body: unknown, processedAt: Date | null = null) => ({
  id: eventId,
  receivedAt: received,
  payload: body,
  processedAt,
});

describe('handling a webhook body', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.applyDeliveryUpdate.mockResolvedValue('changed');
    db.recordInboundMessage.mockResolvedValue('message-1');
  });

  it('applies Delivered and Read (never Sent again), locked, then marks it handled', async () => {
    db.whatsappEventRecord.mockResolvedValue(event(statuses));
    const outcome = await handleWhatsappEvent({} as Db, eventId, soon);
    expect(outcome).toEqual({
      updated: 2,
      received: 0,
      receivedIds: [],
      templates: 0,
      skipped: false,
    });
    expect(db.whatsappEventRecord).toHaveBeenCalledWith('system-tx', eventId, { lock: true });
    const applied = db.applyDeliveryUpdate.mock.calls as [unknown, { status: string }][];
    expect(applied.map(([, update]) => update.status)).toEqual(['delivered', 'read']);
    expect(db.markWhatsappEventProcessed).toHaveBeenCalledWith('system-tx', eventId);
  });

  it('stores what was sent to us, counting a repeat only once', async () => {
    db.whatsappEventRecord.mockResolvedValue(event(inbound));
    db.recordInboundMessage.mockResolvedValueOnce('message-1');
    expect(await handleWhatsappEvent({} as Db, eventId, soon)).toEqual({
      updated: 0,
      received: 1,
      receivedIds: ['message-1'],
      templates: 0,
      skipped: false,
    });
    expect(db.recordInboundMessage).toHaveBeenCalledWith(
      'system-tx',
      expect.objectContaining({
        waMessageId: 'wamid.IN1',
        fromPhone: '+919845012345',
        kind: 'text',
      }),
    );
    db.recordInboundMessage.mockResolvedValueOnce(null);
    expect((await handleWhatsappEvent({} as Db, eventId, soon)).received).toBe(0);
  });

  it('skips a body already handled, or gone', async () => {
    db.whatsappEventRecord.mockResolvedValueOnce(event(statuses, received));
    expect((await handleWhatsappEvent({} as Db, eventId, soon)).skipped).toBe(true);
    db.whatsappEventRecord.mockResolvedValueOnce(undefined);
    expect((await handleWhatsappEvent({} as Db, eventId, soon)).skipped).toBe(true);
    expect(db.applyDeliveryUpdate).not.toHaveBeenCalled();
    expect(db.markWhatsappEventProcessed).not.toHaveBeenCalled();
  });

  it('waits for the send to be recorded when a status comes first, then lets it go', async () => {
    db.whatsappEventRecord.mockResolvedValue(event(statuses));
    db.applyDeliveryUpdate.mockResolvedValue('unknown');
    await expect(handleWhatsappEvent({} as Db, eventId, soon)).rejects.toThrow(
      StatusAheadOfSendError,
    );
    expect(db.markWhatsappEventProcessed).not.toHaveBeenCalled();
    expect(await handleWhatsappEvent({} as Db, eventId, muchLater)).toEqual({
      updated: 0,
      received: 0,
      receivedIds: [],
      templates: 0,
      skipped: false,
    });
    expect(db.markWhatsappEventProcessed).toHaveBeenCalledTimes(1);
  });

  // WA-06: Meta's verdict on a template, and a category it moved one to.
  it('applies template verdicts and category changes, leaving templates not ours alone', async () => {
    db.applyTemplateUpdate
      .mockResolvedValueOnce('changed')
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce('changed');
    db.whatsappEventRecord.mockResolvedValue(
      event({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: '1',
            changes: [
              {
                field: 'message_template_status_update',
                value: {
                  event: 'APPROVED',
                  message_template_id: 1698651768258211,
                  message_template_name: 'no_show_v1',
                  message_template_language: 'en',
                  reason: 'NONE',
                },
              },
              {
                field: 'message_template_status_update',
                value: {
                  event: 'REJECTED',
                  message_template_id: '42',
                  message_template_name: 'jaspers_market',
                  message_template_language: 'en_US',
                  reason: 'INVALID_FORMAT',
                },
              },
              {
                field: 'template_category_update',
                value: {
                  message_template_id: '77',
                  message_template_name: 'review_request_v1',
                  message_template_language: 'en',
                  previous_category: 'UTILITY',
                  new_category: 'MARKETING',
                },
              },
              { field: 'message_template_status_update', value: { event: 'FLAGGED' } },
            ],
          },
        ],
      }),
    );
    expect((await handleWhatsappEvent({} as Db, eventId, soon)).templates).toBe(2);
    expect(db.applyTemplateUpdate.mock.calls.map((call) => call[1] as unknown)).toEqual([
      { metaId: '1698651768258211', status: 'approved', reason: null },
      { metaId: '42', status: 'rejected', reason: 'INVALID_FORMAT' },
      {
        metaId: '77',
        category: 'MARKETING',
        reason: 'Meta moved it to the marketing category.',
      },
    ]);
    expect(db.markWhatsappEventProcessed).toHaveBeenCalledWith('system-tx', eventId);
  });

  it('closes a stored body that no longer reads as a WhatsApp one, changing nothing', async () => {
    db.whatsappEventRecord.mockResolvedValue(event({ object: 'page' }));
    expect((await handleWhatsappEvent({} as Db, eventId, soon)).updated).toBe(0);
    expect(db.applyDeliveryUpdate).not.toHaveBeenCalled();
    expect(db.markWhatsappEventProcessed).toHaveBeenCalledWith('system-tx', eventId);
  });
});
