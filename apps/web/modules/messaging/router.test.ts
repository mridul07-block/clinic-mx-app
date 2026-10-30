import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeInboundMessage } from './router';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  centreContacts: vi.fn(),
  createFlowSession: vi.fn(),
  inboundToRoute: vi.fn(),
  queueMessage: vi.fn(),
  recordRoute: vi.fn(),
  solePatientByPhone: vi.fn(),
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
const env = vi.hoisted(() => {
  const values: Record<string, string | undefined> = {};
  return { values };
});
vi.mock('../../lib/env', () => ({ serverEnv: () => env.values }));
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings.values[key]),
}));

// WA-03: each message sent to us gets one route and one reply, as the system. Generated numbers.
const messageId = '00000000-0000-4000-8000-000000000701';
const from = '+919845012399';
const inbound = (extra: Record<string, unknown> = {}) => ({
  id: messageId,
  direction: 'inbound',
  kind: 'text',
  fromPhone: from,
  body: 'Hi',
  replyId: null,
  route: null,
  waMessageId: 'wamid.IN1',
  ...extra,
});
const queued = () => db.queueMessage.mock.calls.map((call) => call[1] as Record<string, unknown>);

describe('routing a message sent to us', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.inboundToRoute.mockResolvedValue(inbound());
    db.solePatientByPhone.mockResolvedValue(undefined);
    db.recordRoute.mockResolvedValue(true);
    db.queueMessage.mockResolvedValue('reply-1');
    db.createFlowSession.mockResolvedValue('00000000-0000-4000-8000-000000000801');
    env.values = {};
    db.centreContacts.mockResolvedValue([
      { name: 'HSR Layout', phone: '+91 80 0000 0001' },
      { name: 'Koramangala', phone: '+91 80 0000 0002' },
    ]);
    settings.values = {
      'whatsapp.emergency_phrases': ['chest pain'],
      'whatsapp.front_desk_email': 'desk@example.com',
    };
  });

  it('answers typed text with the three button menu, as a reply to it', async () => {
    expect(await routeInboundMessage({} as Db, messageId)).toEqual({
      route: 'assistant',
      reply: 'menu',
      skipped: false,
    });
    expect(db.inboundToRoute).toHaveBeenCalledWith('system-tx', messageId);
    expect(db.recordRoute).toHaveBeenCalledWith('system-tx', messageId, 'assistant', null);
    expect(queued()).toEqual([
      {
        patientId: null,
        toPhone: from,
        kind: 'session',
        templateKey: 'menu',
        templateVersion: 1,
        language: 'en',
        variables: {},
        createdBy: 'system:whatsapp',
        contextWaId: 'wamid.IN1',
      },
    ]);
  });

  it('gives every centre’s phone and the email to "Talk to our team" from an unknown number', async () => {
    db.inboundToRoute.mockResolvedValue(
      inbound({ kind: 'reply', replyId: 'menu.talk', body: null }),
    );
    expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('contact');
    expect(db.centreContacts).toHaveBeenCalledWith('system-tx', undefined);
    expect(queued()[0]).toMatchObject({
      templateKey: 'contact',
      variables: {
        text: 'To talk to our team, call HSR Layout +91 80 0000 0001, Koramangala +91 80 0000 0002 or email desk@example.com.',
      },
    });
  });

  it('links the patient whose number it is alone, and gives their centre’s phone', async () => {
    db.solePatientByPhone.mockResolvedValue({ id: 'patient-1', centreId: 'centre-hsr' });
    db.centreContacts.mockResolvedValue([{ name: 'HSR Layout', phone: '+91 80 0000 0001' }]);
    db.inboundToRoute.mockResolvedValue(
      inbound({ kind: 'reply', replyId: 'menu.book', body: null }),
    );
    expect(await routeInboundMessage({} as Db, messageId)).toMatchObject({ route: 'book' });
    expect(db.recordRoute).toHaveBeenCalledWith('system-tx', messageId, 'book', 'patient-1');
    expect(db.centreContacts).toHaveBeenCalledWith('system-tx', 'centre-hsr');
    expect(queued()[0]).toMatchObject({ patientId: 'patient-1', templateKey: 'contact' });
  });

  it('routes an emergency phrase first, with the front desk details until WA-10', async () => {
    db.inboundToRoute.mockResolvedValue(inbound({ body: 'Book me, I have chest pain' }));
    expect(await routeInboundMessage({} as Db, messageId)).toMatchObject({
      route: 'emergency',
      reply: 'contact',
    });
  });

  it('routes a message once: one already routed, or gone, is left alone', async () => {
    db.inboundToRoute.mockResolvedValueOnce(inbound({ route: 'menu' }));
    expect((await routeInboundMessage({} as Db, messageId)).skipped).toBe(true);
    db.inboundToRoute.mockResolvedValueOnce(undefined);
    expect((await routeInboundMessage({} as Db, messageId)).skipped).toBe(true);
    expect(db.recordRoute).not.toHaveBeenCalled();
    expect(db.queueMessage).not.toHaveBeenCalled();
  });

  // WA-04: Book appointment opens the booking form, with a new Flow session as its token.
  it('sends the booking form for Book appointment where the Flow is set up', async () => {
    env.values = {
      WHATSAPP_BOOKING_FLOW_ID: '1000000000000004',
      WHATSAPP_FLOW_PRIVATE_KEY: 'k'.repeat(120),
    };
    db.inboundToRoute.mockResolvedValue(
      inbound({ kind: 'reply', replyId: 'menu.book', body: null }),
    );
    expect(await routeInboundMessage({} as Db, messageId)).toMatchObject({
      route: 'book',
      reply: 'booking_flow',
    });
    expect(db.createFlowSession).toHaveBeenCalledWith(
      'system-tx',
      expect.objectContaining({ phone: from, kind: 'booking' }),
    );
    expect(queued()[0]).toMatchObject({
      templateKey: 'booking_flow',
      variables: { flowToken: '00000000-0000-4000-8000-000000000801' },
    });
  });

  it('gives the contact details for Book appointment where the Flow is not set up', async () => {
    db.inboundToRoute.mockResolvedValue(
      inbound({ kind: 'reply', replyId: 'menu.book', body: null }),
    );
    expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('contact');
    expect(db.createFlowSession).not.toHaveBeenCalled();
  });

  it('records a completed booking form without replying: it sent its confirmation already', async () => {
    db.inboundToRoute.mockResolvedValue(inbound({ kind: 'flow', replyId: 'booking', body: null }));
    expect(await routeInboundMessage({} as Db, messageId)).toEqual({
      route: 'booking_flow',
      reply: 'none',
      skipped: false,
    });
    expect(db.recordRoute).toHaveBeenCalledWith('system-tx', messageId, 'booking_flow', null);
    expect(db.queueMessage).not.toHaveBeenCalled();
  });
});
