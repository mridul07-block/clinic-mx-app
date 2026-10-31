import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeInboundMessage } from './router';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  centreContacts: vi.fn(),
  confirmAppointment: vi.fn(),
  createFlowSession: vi.fn(),
  flowSessionRecord: vi.fn(),
  inboundToRoute: vi.fn(),
  queueMessage: vi.fn(),
  raiseEmergencyTask: vi.fn(),
  recordRoute: vi.fn(),
  repliedMessage: vi.fn(),
  solePatientByPhone: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const answers = vi.hoisted(() => ({ recordCheckAnswerIn: vi.fn() }));
vi.mock('./clinic-messages', () => answers);
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
      'whatsapp.emergency_advice': 'If this is a medical emergency, call 112 now.',
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

  // WA-10: emergency advice with the clinic's number, never a booking, and the front desk's task.
  it('answers an emergency phrase first with the advice and raises the call back task', async () => {
    db.inboundToRoute.mockResolvedValue(inbound({ body: 'Book me, I have chest pain' }));
    expect(await routeInboundMessage({} as Db, messageId)).toEqual({
      route: 'emergency',
      reply: 'none',
      skipped: false,
    });
    expect(db.centreContacts).toHaveBeenCalledWith('system-tx', undefined);
    expect(queued()).toEqual([
      {
        patientId: null,
        toPhone: from,
        kind: 'session',
        templateKey: 'emergency_advice',
        templateVersion: 1,
        language: 'en',
        variables: {
          text: 'If this is a medical emergency, call 112 now. To reach the clinic, call HSR Layout +91 80 0000 0001, Koramangala +91 80 0000 0002.',
        },
        createdBy: 'system:whatsapp',
        contextWaId: 'wamid.IN1',
      },
    ]);
    expect(db.raiseEmergencyTask).toHaveBeenCalledWith('system-tx', {
      messageId,
      phone: from,
      patientId: null,
      centreId: null,
    });
    expect(db.createFlowSession).not.toHaveBeenCalled();
  });

  it('gives a known patient their own centre and links the task to them', async () => {
    const patient = { id: '00000000-0000-4000-8000-000000000702', centreId: 'centre-hsr' };
    db.solePatientByPhone.mockResolvedValue(patient);
    db.centreContacts.mockResolvedValue([{ name: 'HSR Layout', phone: '+918041234567' }]);
    db.inboundToRoute.mockResolvedValue(inbound({ body: 'CHEST PAIN!' }));
    await routeInboundMessage({} as Db, messageId);
    expect(db.centreContacts).toHaveBeenCalledWith('system-tx', 'centre-hsr');
    expect(queued()[0]).toMatchObject({
      patientId: patient.id,
      variables: {
        text: 'If this is a medical emergency, call 112 now. To reach the clinic, call +91 80 4123 4567.',
      },
    });
    expect(db.raiseEmergencyTask).toHaveBeenCalledWith('system-tx', {
      messageId,
      phone: from,
      patientId: patient.id,
      centreId: 'centre-hsr',
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

  // WA-05: Reschedule or cancel opens the reschedule form, which first lists the number's
  // appointments; the contact details where the Flow is not set up.
  it('sends the reschedule form for Reschedule or cancel where the Flow is set up', async () => {
    env.values = {
      WHATSAPP_RESCHEDULE_FLOW_ID: '1000000000000005',
      WHATSAPP_FLOW_PRIVATE_KEY: 'k'.repeat(120),
    };
    db.inboundToRoute.mockResolvedValue(
      inbound({ kind: 'reply', replyId: 'menu.reschedule', body: null }),
    );
    expect(await routeInboundMessage({} as Db, messageId)).toMatchObject({
      route: 'reschedule',
      reply: 'reschedule_flow',
    });
    expect(db.createFlowSession).toHaveBeenCalledWith(
      'system-tx',
      expect.objectContaining({ phone: from, kind: 'reschedule' }),
    );
    expect(queued()[0]).toMatchObject({
      templateKey: 'reschedule_flow',
      variables: { flowToken: '00000000-0000-4000-8000-000000000801' },
    });
  });

  it('gives the contact details for Reschedule or cancel where its Flow is not set up', async () => {
    // The booking Flow alone does not open the reschedule form.
    env.values = {
      WHATSAPP_BOOKING_FLOW_ID: '1000000000000004',
      WHATSAPP_FLOW_PRIVATE_KEY: 'k'.repeat(120),
    };
    db.inboundToRoute.mockResolvedValue(
      inbound({ kind: 'reply', replyId: 'menu.reschedule', body: null }),
    );
    expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('contact');
    expect(db.createFlowSession).not.toHaveBeenCalled();
  });

  // Meta names every completed form `flow`: the Flow token in its answers says which it was.
  it('knows a completed form by its Flow token’s session, without replying', async () => {
    const token = '00000000-0000-4000-8000-000000000802';
    for (const kind of ['booking', 'reschedule'] as const) {
      db.flowSessionRecord.mockResolvedValueOnce({ id: token, kind });
      db.inboundToRoute.mockResolvedValueOnce(
        inbound({
          kind: 'flow',
          replyId: 'flow',
          body: null,
          replyPayload: { flow_token: token, appointment: 'MVH-00013' },
        }),
      );
      expect(await routeInboundMessage({} as Db, messageId)).toEqual({
        route: `${kind}_flow`,
        reply: 'none',
        skipped: false,
      });
    }
    expect(db.flowSessionRecord).toHaveBeenCalledWith('system-tx', token);
    // A token we do not know: the menu.
    db.flowSessionRecord.mockResolvedValueOnce(undefined);
    db.inboundToRoute.mockResolvedValueOnce(
      inbound({ kind: 'flow', replyId: 'flow', body: null, replyPayload: { flow_token: token } }),
    );
    expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('menu');
    expect(queued().map((reply) => reply.templateKey)).toEqual(['menu']);
  });

  // WA-08: a tap on the day before reminder's Confirm confirms its appointment, then thanks them.
  describe('a tap on the reminder’s Confirm', () => {
    const appointmentId = '00000000-0000-4000-8000-000000000a11';
    const startsAt = new Date('2026-11-03T04:30:00.000Z'); // 10:00 AM IST
    const tap = () =>
      inbound({
        kind: 'reply',
        replyId: 'day_before_reminder.confirm',
        body: 'Confirm',
        contextWaId: 'wamid.REMINDER',
      });
    beforeEach(() => {
      db.repliedMessage.mockResolvedValue({
        id: 'sent-2',
        templateKey: 'day_before_reminder',
        patientId: 'patient-1',
        patientLinkId: null,
        appointmentId,
      });
      db.inboundToRoute.mockResolvedValue(tap());
    });

    it('confirms the reminder’s appointment and thanks them with its day and time', async () => {
      db.confirmAppointment.mockResolvedValue({ outcome: 'confirmed', startsAt, centreId: 'c1' });
      expect(await routeInboundMessage({} as Db, messageId)).toEqual({
        route: 'confirm',
        reply: 'none',
        skipped: false,
      });
      expect(db.repliedMessage).toHaveBeenCalledWith('system-tx', 'wamid.REMINDER');
      expect(db.confirmAppointment).toHaveBeenCalledWith(
        'system-tx',
        appointmentId,
        expect.any(Date),
      );
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'session',
          templateKey: 'appointment_confirmed',
          variables: {
            text: 'Thank you, your appointment on Tue, 3 Nov at 10:00 AM is confirmed.',
          },
          contextWaId: 'wamid.IN1',
        }),
      ]);
      // Confirmed already: thanked the same.
      db.confirmAppointment.mockResolvedValue({ outcome: 'already', startsAt, centreId: 'c1' });
      await routeInboundMessage({} as Db, messageId);
      expect(queued()[1]?.variables).toEqual(queued()[0]?.variables);
    });

    it('gives the clinic’s contact details for an appointment changed since', async () => {
      db.confirmAppointment.mockResolvedValue({ outcome: 'changed', centreId: 'c1' });
      await routeInboundMessage({} as Db, messageId);
      expect(db.centreContacts).toHaveBeenCalledWith('system-tx', 'c1');
      const text = (queued()[0]?.variables as { text: string }).text;
      expect(text).toMatch(/^This appointment has changed, so it cannot be confirmed here\. /);
      expect(text).toContain('+91 80 0000 0001');
      expect(queued()[0]?.templateKey).toBe('appointment_confirmed');
    });

    it('sends the menu for a Confirm on a message that is not a reminder', async () => {
      db.repliedMessage.mockResolvedValue({
        id: 'sent-3',
        templateKey: 'no_show',
        patientId: null,
        patientLinkId: null,
        appointmentId,
      });
      expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('menu');
      db.repliedMessage.mockResolvedValue(undefined);
      expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('menu');
      expect(db.confirmAppointment).not.toHaveBeenCalled();
    });
  });

  // WA-06: a tap on a check's reply button is that check's answer.
  describe('a tap on a check’s reply button', () => {
    const linkId = '00000000-0000-4000-8000-000000000901';
    const tap = (replyId: string) =>
      inbound({ kind: 'reply', replyId, body: null, contextWaId: 'wamid.OUT1' });
    beforeEach(() => {
      answers.recordCheckAnswerIn.mockReset().mockResolvedValue('recorded');
      db.repliedMessage.mockResolvedValue({
        id: 'sent-1',
        templateKey: 'first_treatment_check',
        patientId: 'patient-1',
        patientLinkId: linkId,
      });
    });

    it('records the answer for the link the message stands for, and thanks them', async () => {
      db.inboundToRoute.mockResolvedValue(tap('first_treatment_check.still_sore'));
      expect(await routeInboundMessage({} as Db, messageId)).toEqual({
        route: 'check_answer',
        reply: 'none',
        skipped: false,
      });
      expect(db.repliedMessage).toHaveBeenCalledWith('system-tx', 'wamid.OUT1');
      expect(answers.recordCheckAnswerIn).toHaveBeenCalledWith('system-tx', {
        linkId,
        template: 'first_treatment_check',
        answer: 'still_sore',
      });
      expect(queued()).toEqual([
        expect.objectContaining({
          kind: 'session',
          templateKey: 'check_answer',
          variables: { text: 'Thank you, we have noted your answer.' },
          contextWaId: 'wamid.IN1',
        }),
      ]);
    });

    it('says so when it was answered already', async () => {
      answers.recordCheckAnswerIn.mockResolvedValue('closed');
      db.inboundToRoute.mockResolvedValue(tap('first_treatment_check.better'));
      await routeInboundMessage({} as Db, messageId);
      expect(queued()[0]).toMatchObject({
        variables: { text: 'We already have your answer, thank you.' },
      });
    });

    it('sends the menu for a tap on a message we cannot match', async () => {
      db.repliedMessage.mockResolvedValue(undefined);
      db.inboundToRoute.mockResolvedValue(tap('follow_up_check.some_pain'));
      expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('menu');
      // Another check's button on this message, or a message that stands for no link.
      db.repliedMessage.mockResolvedValue({
        id: 'sent-1',
        templateKey: 'first_treatment_check',
        patientId: null,
        patientLinkId: linkId,
      });
      expect((await routeInboundMessage({} as Db, messageId)).reply).toBe('menu');
      expect(answers.recordCheckAnswerIn).not.toHaveBeenCalled();
      expect(queued().map((reply) => reply.templateKey)).toEqual(['menu', 'menu']);
    });
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
