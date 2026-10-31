import type { Db } from '@clinic-mx/db';
import type { AssistantChoice } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerTypedMessage } from './assistant';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  centreDirections: vi.fn(),
  inboundToRoute: vi.fn(),
  messageRecord: vi.fn(),
  patientNamesByPhone: vi.fn(),
  queueMessage: vi.fn(),
  solePatientByPhone: vi.fn(),
  sourceQueued: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));
const gateway = vi.hoisted(() => ({ assistantReply: vi.fn() }));
vi.mock('../ai/gateway', () => gateway);
const router = vi.hoisted(() => ({
  answerEmergency: vi.fn(),
  queueRouteReply: vi.fn(),
  assistantSourceKey: (id: string) => ['whatsapp.assistant_reply', id].join(':'),
}));
vi.mock('./router', () => router);
const faqs = vi.hoisted(() => [
  { id: 'directions', question: 'Where are your clinics?', answer: 'Our clinics:\n\n{{centres}}' },
  {
    id: 'what_to_bring',
    question: 'What should I bring?',
    answer: 'Please arrive 10 minutes early and bring any reports you have.',
  },
]);
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) =>
    Promise.resolve(key === 'whatsapp.assistant_faqs' ? faqs : undefined),
}));

// WA-11 done when: single message replies; FAQs; never diagnoses. The model only chooses; each
// choice gets exactly one reply, the clinic's own words or the menu's. Generated numbers and names.
const messageId = '00000000-0000-4000-8000-000000000b01';
const from = '+919845012311';
const sourceKey = ['whatsapp.assistant_reply', messageId].join(':');
const owner = { id: '00000000-0000-4000-8000-000000000b02', centreId: 'centre-1' };
const typed = (extra: Record<string, unknown> = {}) => ({
  id: messageId,
  direction: 'inbound',
  kind: 'text',
  route: 'assistant',
  fromPhone: from,
  body: 'What should I bring?',
  waMessageId: 'wamid.IN9',
  ...extra,
});
const chooses = (output: AssistantChoice) =>
  gateway.assistantReply.mockResolvedValue({ status: 'ok', output, runId: 'run-1' });

describe('the assistant answering a typed message', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), ...Object.values(gateway)]) fn.mockReset();
    router.answerEmergency.mockReset();
    router.queueRouteReply.mockReset();
    db.messageRecord.mockResolvedValue(typed());
    db.inboundToRoute.mockResolvedValue(typed());
    db.sourceQueued.mockResolvedValue(false);
    db.patientNamesByPhone.mockResolvedValue(['Asha Testpatient']);
    db.solePatientByPhone.mockResolvedValue(owner);
    db.centreDirections.mockResolvedValue([
      { name: 'HSR Layout', address: '1 Test Road', mapLink: null },
    ]);
    router.queueRouteReply.mockImplementation((_tx, _message, _owner, wanted: string) =>
      Promise.resolve(wanted),
    );
  });

  it('sends an approved answer word for word, one message, the number’s names never sent', async () => {
    chooses({ kind: 'faq', faq: faqs[1] as (typeof faqs)[number] });
    expect(await answerTypedMessage({} as Db, messageId)).toEqual({
      answered: true,
      choice: 'faq',
      reply: 'assistant_answer',
    });
    expect(gateway.assistantReply).toHaveBeenCalledWith(
      {},
      {
        message: 'What should I bring?',
        faqs,
        forbidden: ['Asha Testpatient'],
        transport: undefined,
      },
    );
    expect(db.queueMessage.mock.calls).toEqual([
      [
        'system-tx',
        {
          patientId: owner.id,
          toPhone: from,
          kind: 'session',
          templateKey: 'assistant_answer',
          templateVersion: 1,
          language: 'en',
          variables: { text: 'Please arrive 10 minutes early and bring any reports you have.' },
          createdBy: 'system:whatsapp',
          contextWaId: 'wamid.IN9',
          sourceKey,
        },
      ],
    ]);
  });

  it('fills in the centres for the directions answer', async () => {
    chooses({ kind: 'faq', faq: faqs[0] as (typeof faqs)[number] });
    await answerTypedMessage({} as Db, messageId);
    expect(db.queueMessage.mock.calls[0]?.[1]).toMatchObject({
      variables: { text: 'Our clinics:\n\nMovementology HSR Layout: 1 Test Road' },
    });
  });

  it('answers a menu choice as the menu does, and anything else with the menu', async () => {
    const cases = [
      ['book', 'booking_flow'],
      ['reschedule', 'reschedule_flow'],
      ['talk', 'contact'],
      ['none', 'menu'],
    ] as const;
    for (const [kind, reply] of cases) {
      router.queueRouteReply.mockClear();
      chooses({ kind });
      expect(await answerTypedMessage({} as Db, messageId)).toEqual({
        answered: true,
        choice: kind,
        reply,
      });
      expect(router.queueRouteReply).toHaveBeenCalledWith(
        'system-tx',
        { id: messageId, fromPhone: from, waMessageId: 'wamid.IN9' },
        owner,
        reply,
        sourceKey,
      );
    }
    expect(db.queueMessage).not.toHaveBeenCalled();
  });

  it('gives the emergency reply and task when the model reads an emergency', async () => {
    chooses({ kind: 'emergency' });
    expect(await answerTypedMessage({} as Db, messageId)).toMatchObject({
      choice: 'emergency',
      reply: 'emergency_advice',
    });
    expect(router.answerEmergency).toHaveBeenCalledWith(
      'system-tx',
      { id: messageId, fromPhone: from, waMessageId: 'wamid.IN9' },
      owner,
      sourceKey,
    );
  });

  it('gives the menu whenever the model is unavailable, and for an empty message without asking it', async () => {
    for (const reason of ['not_configured', 'capped', 'timed_out', 'invalid_output', 'blocked']) {
      router.queueRouteReply.mockClear();
      gateway.assistantReply.mockResolvedValue({ status: 'unavailable', reason, runId: 'run-2' });
      expect(await answerTypedMessage({} as Db, messageId)).toMatchObject({ reply: 'menu' });
      expect(router.queueRouteReply.mock.calls[0]?.[3]).toBe('menu');
    }
    gateway.assistantReply.mockClear();
    db.messageRecord.mockResolvedValue(typed({ body: '  ' }));
    expect(await answerTypedMessage({} as Db, messageId)).toMatchObject({ reply: 'menu' });
    expect(gateway.assistantReply).not.toHaveBeenCalled();
  });

  it('answers once: nothing when answered already, before or after asking the model', async () => {
    db.sourceQueued.mockResolvedValueOnce(true);
    expect(await answerTypedMessage({} as Db, messageId)).toEqual({ answered: false });
    expect(gateway.assistantReply).not.toHaveBeenCalled();

    // The webhook and the job ran at once: the second finds the first's answer under the lock.
    chooses({ kind: 'talk' });
    db.sourceQueued.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await answerTypedMessage({} as Db, messageId)).toEqual({ answered: false });
    expect(router.queueRouteReply).not.toHaveBeenCalled();
    expect(db.queueMessage).not.toHaveBeenCalled();
  });

  it('answers only a typed message the router sent to the assistant', async () => {
    for (const other of [
      typed({ route: 'menu' }),
      typed({ direction: 'outbound' }),
      typed({ fromPhone: null }),
      undefined,
    ]) {
      db.messageRecord.mockResolvedValue(other);
      expect(await answerTypedMessage({} as Db, messageId)).toEqual({ answered: false });
    }
    expect(gateway.assistantReply).not.toHaveBeenCalled();
  });
});
