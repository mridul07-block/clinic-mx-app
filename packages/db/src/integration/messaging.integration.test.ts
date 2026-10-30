import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { queueMessage, recentMessages, recordMessageOutcome, type NewMessage } from '../messaging';
import { auditEvent, job, message } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient } from './fake-schedule';

// WA-01 done when: messages send with retries; message rows stored. Under row level security, in
// transactions rolled back: a message is a row first and queues its send job with it; the Super
// Admin reads messages and queues only a test send as themselves; nobody signed in changes one.
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
const others = [
  member('manager@clinicmx.test'),
  member('desk.hsr@clinicmx.test'),
  member('physio.hsr@clinicmx.test'),
  member('finance@clinicmx.test'),
];
const support = member('support.velyx@clinicmx.test');

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
const testSend = (by: StaffMember, extra: Partial<NewMessage> = {}): NewMessage => ({
  patientId: null,
  toPhone: '+919845012345',
  kind: 'test',
  templateKey: 'hello_world',
  templateVersion: 1,
  language: 'en_US',
  variables: {},
  createdBy: `staff:${by.id}`,
  ...extra,
});
const sendJobs = (tx: Tx, messageId: string) =>
  tx
    .select({ kind: job.kind, status: job.status })
    .from(job)
    .where(eq(job.idempotencyKey, `whatsapp.send:${messageId}`));

describe('WhatsApp messages', () => {
  it('queue their send job with them, and the Super Admin queues a test send as themselves', async () => {
    await rolledBack(async (tx) => {
      await becomeStaff(tx, superAdmin);
      const id = await queueMessage(tx, testSend(superAdmin));
      expect((await recentMessages(tx, 20)).map((m) => m.id)).toContain(id);
      await asOwner(tx);
      expect(await sendJobs(tx, id)).toEqual([{ kind: 'whatsapp.send', status: 'queued' }]);
      const audit = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'message'), eq(auditEvent.entityId, id)));
      expect(audit).toEqual([{ actor: `staff:${superAdmin.id}`, action: 'insert' }]);
    });
  });

  it('are queued for a patient by the system only, never by the Super Admin', async () => {
    await rolledBack(async (tx) => {
      const patientId = await testPatient(tx);
      const template = {
        ...testSend(superAdmin),
        patientId,
        kind: 'template' as const,
        templateKey: 'receipt',
        language: 'en',
        createdBy: 'system:tests',
      };
      const id = await queueMessage(tx, template);
      expect(await sendJobs(tx, id)).toHaveLength(1);
      await becomeStaff(tx, superAdmin);
      expect(await failure(tx, (sp) => queueMessage(sp, template))).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          queueMessage(sp, testSend(superAdmin, { createdBy: `staff:${others[0]?.id ?? ''}` })),
        ),
      ).toBe('42501');
    });
  });

  it('are read and queued by nobody else, and changed by nobody signed in', async () => {
    await rolledBack(async (tx) => {
      const id = await queueMessage(tx, testSend(superAdmin, { createdBy: 'system:tests' }));
      for (const outsider of [...others, support]) {
        await becomeStaff(tx, outsider);
        expect(await recentMessages(tx, 20), outsider.email).toEqual([]);
        expect(
          await failure(tx, (sp) => queueMessage(sp, testSend(outsider))),
          outsider.email,
        ).toBe('42501');
      }
      await becomeStaff(tx, superAdmin);
      expect(
        await failure(tx, (sp) =>
          sp.update(message).set({ status: 'failed' }).where(eq(message.id, id)),
        ),
      ).toBe('42501');
      expect(await failure(tx, (sp) => sp.delete(message).where(eq(message.id, id)))).toBe('42501');
    });
  });

  it('record an outcome once, and a sent one always has Meta’s id', async () => {
    await rolledBack(async (tx) => {
      const id = await queueMessage(tx, testSend(superAdmin, { createdBy: 'system:tests' }));
      expect(
        await failure(tx, (sp) =>
          sp.update(message).set({ status: 'sent' }).where(eq(message.id, id)),
        ),
      ).toBe('23514');
      expect(
        await recordMessageOutcome(tx, id, {
          status: 'queued',
          errorCode: 'http',
          errorTitle: 'Busy',
        }),
      ).toBe(true);
      expect(
        await recordMessageOutcome(tx, id, { status: 'sent', waMessageId: 'wamid.test' }),
      ).toBe(true);
      expect(
        await recordMessageOutcome(tx, id, {
          status: 'failed',
          errorCode: 'x',
          errorTitle: 'Late',
        }),
      ).toBe(false);
      const [row] = await tx.select().from(message).where(eq(message.id, id));
      expect(row).toMatchObject({
        status: 'sent',
        waMessageId: 'wamid.test',
        attempts: 2,
        errorCode: null,
      });
    });
  });
});
