import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  applyDeliveryUpdate,
  markWhatsappEventProcessed,
  queueMessage,
  recentMessages,
  recordInboundMessage,
  recordMessageOutcome,
  storeWhatsappEvent,
} from '../messaging';
import { job, message, whatsappEvent } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff } from './fake-schedule';

// WA-02 done when: signature verified; acknowledged within seconds; work queued; delivery status
// stored. Under row level security, in transactions rolled back: a stored webhook body queues its
// job and is the server's alone; statuses move a sent message forward only; what is sent to us is
// stored once, Received; handled bodies go after the retention days. Generated numbers only.
// CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const everyone = [
  superAdmin,
  member('manager@clinicmx.test'),
  member('desk.hsr@clinicmx.test'),
  member('physio.hsr@clinicmx.test'),
  member('finance@clinicmx.test'),
  member('support.velyx@clinicmx.test'),
];

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

const asOwner = (tx: Tx) => tx.execute(sql`reset role`);
const waId = () => ['wamid.test', randomUUID()].join('-');
const at = new Date('2026-10-30T10:00:00Z');
const later = new Date('2026-10-30T10:05:00Z');

/** A test send Meta took, with its id. */
async function sentMessage(tx: Tx): Promise<{ id: string; wa: string }> {
  const id = await queueMessage(tx, {
    patientId: null,
    toPhone: '+919845012345',
    kind: 'test',
    templateKey: 'hello_world',
    templateVersion: 1,
    language: 'en_US',
    variables: {},
    createdBy: 'system:tests',
  });
  const wa = waId();
  await recordMessageOutcome(tx, id, { status: 'sent', waMessageId: wa });
  return { id, wa };
}

const statusOf = async (tx: Tx, id: string) =>
  (
    await tx
      .select({
        status: message.status,
        deliveredAt: message.deliveredAt,
        readAt: message.readAt,
        errorCode: message.errorCode,
        waMessageId: message.waMessageId,
      })
      .from(message)
      .where(eq(message.id, id))
  )[0];

const update = (wa: string, status: 'delivered' | 'read' | 'failed', when = at) => ({
  waMessageId: wa,
  status,
  at: when,
  errorCode: status === 'failed' ? '131026' : null,
  errorTitle: status === 'failed' ? 'Message undeliverable' : null,
});

const inbound = (wa: string) => ({
  waMessageId: wa,
  fromPhone: '+919845012399',
  at,
  kind: 'text' as const,
  body: 'Hi',
  replyId: null,
  replyPayload: null,
  contextWaId: null,
});

describe('WhatsApp webhook bodies', () => {
  it('queue their job once, and are the server’s alone', async () => {
    await rolledBack(async (tx) => {
      const id = await storeWhatsappEvent(tx, { object: 'whatsapp_business_account', entry: [] });
      const jobs = await tx
        .select({ kind: job.kind, payload: job.payload })
        .from(job)
        .where(eq(job.idempotencyKey, `whatsapp.event:${id}`));
      expect(jobs).toEqual([{ kind: 'whatsapp.event', payload: { eventId: id } }]);
      for (const staff of everyone) {
        await becomeStaff(tx, staff);
        expect(
          await failure(tx, (sp) =>
            sp.select().from(whatsappEvent).where(eq(whatsappEvent.id, id)),
          ),
          staff.email,
        ).toBe('42501');
        expect(
          await failure(tx, (sp) => storeWhatsappEvent(sp, { object: 'x', entry: [] })),
          staff.email,
        ).toBe('42501');
        expect(
          await failure(tx, (sp) => sp.delete(whatsappEvent).where(eq(whatsappEvent.id, id))),
          staff.email,
        ).toBe('42501');
        await asOwner(tx);
      }
    });
  });

  it('go once handled longer ago than the setting, or never handled that long after they came', async () => {
    await rolledBack(async (tx) => {
      const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
      const ids = {
        oldHandled: await storeWhatsappEvent(tx, { n: 1 }),
        newHandled: await storeWhatsappEvent(tx, { n: 2 }),
        newUnhandled: await storeWhatsappEvent(tx, { n: 3 }),
        oldUnhandled: await storeWhatsappEvent(tx, { n: 4 }),
      };
      await tx
        .update(whatsappEvent)
        .set({ receivedAt: days(9), processedAt: days(8) })
        .where(eq(whatsappEvent.id, ids.oldHandled));
      await tx
        .update(whatsappEvent)
        .set({ receivedAt: days(9), processedAt: days(1) })
        .where(eq(whatsappEvent.id, ids.newHandled));
      await tx
        .update(whatsappEvent)
        .set({ receivedAt: days(2) })
        .where(eq(whatsappEvent.id, ids.newUnhandled));
      await tx
        .update(whatsappEvent)
        .set({ receivedAt: days(8) })
        .where(eq(whatsappEvent.id, ids.oldUnhandled));
      await tx.execute(sql`select internal.prune_whatsapp_events()`);
      const left = (await tx.select({ id: whatsappEvent.id }).from(whatsappEvent)).map(
        (row) => row.id,
      );
      expect(left).toContain(ids.newHandled);
      expect(left).toContain(ids.newUnhandled);
      expect(left).not.toContain(ids.oldHandled);
      expect(left).not.toContain(ids.oldUnhandled);
    });
  });

  it('are marked handled once', async () => {
    await rolledBack(async (tx) => {
      const id = await storeWhatsappEvent(tx, { n: 1 });
      await markWhatsappEventProcessed(tx, id);
      const [first] = await tx.select().from(whatsappEvent).where(eq(whatsappEvent.id, id));
      await markWhatsappEventProcessed(tx, id);
      const [second] = await tx.select().from(whatsappEvent).where(eq(whatsappEvent.id, id));
      expect(first?.processedAt).not.toBeNull();
      expect(second?.processedAt).toEqual(first?.processedAt);
    });
  });
});

describe('delivery statuses', () => {
  it('move a sent message forward to Delivered, then Read, never back', async () => {
    await rolledBack(async (tx) => {
      const { id, wa } = await sentMessage(tx);
      expect(await applyDeliveryUpdate(tx, update(wa, 'delivered'))).toBe('changed');
      expect(await statusOf(tx, id)).toMatchObject({ status: 'delivered', deliveredAt: at });
      expect(await applyDeliveryUpdate(tx, update(wa, 'read', later))).toBe('changed');
      expect(await applyDeliveryUpdate(tx, update(wa, 'delivered', later))).toBe('unchanged');
      expect(await statusOf(tx, id)).toMatchObject({
        status: 'read',
        deliveredAt: at,
        readAt: later,
        waMessageId: wa,
      });
      expect(await applyDeliveryUpdate(tx, update(waId(), 'read'))).toBe('unknown');
      await becomeStaff(tx, superAdmin);
      const [listed] = (await recentMessages(tx, 50)).filter((m) => m.id === id);
      expect(listed).toMatchObject({
        status: 'read',
        direction: 'outbound',
        phone: '+919845012345',
      });
    });
  });

  it('fail a message Meta took but could not deliver, keeping its id', async () => {
    await rolledBack(async (tx) => {
      const { id, wa } = await sentMessage(tx);
      expect(await applyDeliveryUpdate(tx, update(wa, 'failed'))).toBe('changed');
      expect(await statusOf(tx, id)).toMatchObject({
        status: 'failed',
        errorCode: '131026',
        waMessageId: wa,
      });
    });
  });

  it('need Meta’s id for Delivered and Read, and none on a message never sent', async () => {
    await rolledBack(async (tx) => {
      const { id } = await sentMessage(tx);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(message)
            .set({ status: 'delivered', waMessageId: null })
            .where(eq(message.id, id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp.update(message).set({ status: 'queued' }).where(eq(message.id, id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp.update(message).set({ status: 'received' }).where(eq(message.id, id)),
        ),
      ).toBe('23514');
    });
  });
});

describe('messages sent to us', () => {
  it('are stored once, Received, by the system, and only the Super Admin reads them', async () => {
    await rolledBack(async (tx) => {
      const wa = waId();
      expect(await recordInboundMessage(tx, inbound(wa))).toBe(true);
      expect(await recordInboundMessage(tx, inbound(wa))).toBe(false);
      const rows = await tx.select().from(message).where(eq(message.waMessageId, wa));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        direction: 'inbound',
        status: 'received',
        kind: 'text',
        fromPhone: '+919845012399',
        toPhone: null,
        templateKey: null,
        createdBy: 'system:whatsapp',
      });
      const id = rows[0]?.id ?? '';
      for (const staff of everyone) {
        await becomeStaff(tx, staff);
        const listed = (await recentMessages(tx, 50)).filter((m) => m.id === id);
        expect(listed.length, staff.email).toBe(staff === superAdmin ? 1 : 0);
        expect(
          await failure(tx, (sp) => recordInboundMessage(sp, inbound(waId()))),
          staff.email,
        ).toBe('42501');
        await asOwner(tx);
      }
    });
  });

  it('need the sender, Meta’s id and its time, and an inbound kind', async () => {
    await rolledBack(async (tx) => {
      const base = {
        direction: 'inbound' as const,
        kind: 'text' as const,
        status: 'received' as const,
        fromPhone: '+919845012399',
        waMessageId: waId(),
        sentAt: at,
        createdBy: 'system:tests',
      };
      const insert = (extra: Record<string, unknown>) => (sp: Tx) =>
        sp.insert(message).values({ ...base, waMessageId: waId(), ...extra });
      expect(await failure(tx, insert({ fromPhone: null }))).toBe('23514');
      expect(await failure(tx, insert({ waMessageId: null }))).toBe('23514');
      expect(await failure(tx, insert({ sentAt: null }))).toBe('23514');
      expect(await failure(tx, insert({ kind: 'template' }))).toBe('23514');
      expect(await failure(tx, insert({ status: 'queued' }))).toBe('23514');
      expect(await failure(tx, insert({ toPhone: '+919845012345' }))).toBe('23514');
      expect(await failure(tx, insert({}))).toBeUndefined();
      // An inbound row never queues a send.
      const jobs = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from job where kind = 'whatsapp.send'
          and payload->>'messageId' in (select id::text from message where direction = 'inbound')`,
      );
      expect(jobs[0]?.n).toBe(0);
    });
  });
});
