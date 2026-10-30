import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  centreContacts,
  inboundToRoute,
  lastInboundAt,
  queueMessage,
  recordInboundMessage,
  recordRoute,
  solePatientByPhone,
} from '../messaging';
import { insertPatient } from '../patients';
import { centre, job, message } from '../schema';
import { centreIds } from '../seed/data';
import { fakePatientDetails } from './fake-patients';

// WA-03 done when: buttons, Flow completions, typed text and emergency phrases each reach the
// right handler. In transactions rolled back: a message sent to us queues its route job; it is
// routed once, and only inbound messages are; the router's replies are outbound messages; a number
// is linked to a patient only when it is theirs alone. Generated numbers only. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const fakeNumber = () =>
  `+9199${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte % 10).join('')}`;
const waId = () => ['wamid.test', randomUUID()].join('-');

const inbound = (from: string, at = new Date()) => ({
  waMessageId: waId(),
  fromPhone: from,
  at,
  kind: 'text' as const,
  body: 'Hi',
  replyId: null,
  replyPayload: null,
  contextWaId: null,
});

const reply = (to: string, patientId: string | null = null) => ({
  patientId,
  toPhone: to,
  kind: 'session' as const,
  templateKey: 'menu',
  templateVersion: 1,
  language: 'en',
  variables: {},
  createdBy: 'system:tests',
  contextWaId: waId(),
});

describe('routing messages sent to us', () => {
  it('queues one route job per message, and routes it once', async () => {
    await rolledBack(async (tx) => {
      const id = await recordInboundMessage(tx, inbound(fakeNumber()));
      if (!id) throw new Error('not stored');
      const jobs = await tx
        .select({ kind: job.kind, payload: job.payload })
        .from(job)
        .where(eq(job.idempotencyKey, `whatsapp.route:${id}`));
      expect(jobs).toEqual([{ kind: 'whatsapp.route', payload: { messageId: id } }]);
      expect((await inboundToRoute(tx, id))?.route).toBeNull();
      expect(await recordRoute(tx, id, 'assistant', null)).toBe(true);
      expect(await recordRoute(tx, id, 'emergency', null)).toBe(false);
      const [row] = await tx.select().from(message).where(eq(message.id, id));
      expect(row?.route).toBe('assistant');
      expect(row?.routedAt).not.toBeNull();
    });
  });

  it('routes only inbound messages, always with the time', async () => {
    await rolledBack(async (tx) => {
      const outId = await queueMessage(tx, reply(fakeNumber()));
      expect(await inboundToRoute(tx, outId)).toBeUndefined();
      expect(
        await failure(tx, (sp) =>
          sp
            .update(message)
            .set({ route: 'menu', routedAt: new Date() })
            .where(eq(message.id, outId)),
        ),
      ).toBe('23514');
      const inId = await recordInboundMessage(tx, inbound(fakeNumber()));
      expect(
        await failure(tx, (sp) =>
          sp
            .update(message)
            .set({ route: 'menu' })
            .where(eq(message.id, inId ?? '')),
        ),
      ).toBe('23514');
    });
  });
});

describe('the router’s replies', () => {
  it('are outbound messages that queue their send job, never inbound or routed', async () => {
    await rolledBack(async (tx) => {
      const id = await queueMessage(tx, reply(fakeNumber()));
      const [row] = await tx.select().from(message).where(eq(message.id, id));
      expect(row).toMatchObject({ direction: 'outbound', kind: 'session', status: 'queued' });
      expect(
        await tx
          .select({ kind: job.kind })
          .from(job)
          .where(eq(job.idempotencyKey, `whatsapp.send:${id}`)),
      ).toEqual([{ kind: 'whatsapp.send' }]);
      expect(
        await failure(tx, (sp) =>
          sp.insert(message).values({ ...reply(fakeNumber()), direction: 'inbound' }),
        ),
      ).toBe('23514');
    });
  });
});

describe('numbers and patients', () => {
  it('link a number to a patient only when it is theirs alone', async () => {
    await rolledBack(async (tx) => {
      const details = fakePatientDetails(centreIds.koramangala);
      const first = await insertPatient(tx, details);
      expect(await solePatientByPhone(tx, details.phone)).toEqual({
        id: first.id,
        centreId: centreIds.koramangala,
      });
      await insertPatient(tx, { ...fakePatientDetails(), phone: details.phone });
      expect(await solePatientByPhone(tx, details.phone)).toBeUndefined();
      expect(await solePatientByPhone(tx, fakeNumber())).toBeUndefined();
    });
  });

  it('know when the number last wrote, for the 24 hour window', async () => {
    await rolledBack(async (tx) => {
      const from = fakeNumber();
      expect(await lastInboundAt(tx, from)).toBeNull();
      const earlier = new Date('2026-10-30T08:00:00Z');
      const later = new Date('2026-10-30T09:00:00Z');
      await recordInboundMessage(tx, inbound(from, earlier));
      await recordInboundMessage(tx, inbound(from, later));
      await queueMessage(tx, reply(from));
      expect(await lastInboundAt(tx, from)).toEqual(later);
    });
  });

  it('give one centre’s contact, or every active centre’s', async () => {
    await rolledBack(async (tx) => {
      await tx
        .update(centre)
        .set({ phone: '+91 80 0000 0001' })
        .where(eq(centre.id, centreIds.hsrLayout));
      const one = await centreContacts(tx, centreIds.hsrLayout);
      expect(one).toEqual([expect.objectContaining({ phone: '+91 80 0000 0001' })]);
      const all = await centreContacts(tx);
      const active = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(centre)
        .where(and(eq(centre.active, true)));
      expect(all).toHaveLength(active[0]?.n ?? 0);
      expect(all.map((c) => c.name)).toEqual([...all.map((c) => c.name)].sort());
    });
  });
});
