import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { raiseEmergencyTask } from '../emergency';
import type { StaffMember } from '../identity';
import { recordInboundMessage } from '../messaging';
import { insertPatient } from '../patients';
import { task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { inboxTasks } from '../tasks';
import { fakePatientDetails } from './fake-patients';
import { becomeStaff } from './fake-schedule';

// WA-10: an emergency phrase on WhatsApp raises one urgent front desk task per number while it is
// open; the card reads the number to call back, for those who may read the task. In transactions
// rolled back. Generated numbers only. CI only.
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

const fakeNumber = () =>
  `+9199${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte % 10).join('')}`;

async function emergencyFrom(tx: Tx, phone: string): Promise<string> {
  const id = await recordInboundMessage(tx, {
    waMessageId: ['wamid.test', randomUUID()].join('-'),
    fromPhone: phone,
    at: new Date(),
    kind: 'text',
    body: 'Chest pain',
    replyId: null,
    replyPayload: null,
    contextWaId: null,
  });
  if (!id) throw new Error('not stored');
  return id;
}

const tasksFor = (tx: Tx, messageIds: string[]) =>
  tx
    .select()
    .from(task)
    .where(
      and(eq(task.kind, 'call.emergency'), sql`${task.details} ->> 'messageId' in ${messageIds}`),
    );

describe('the emergency call back task', () => {
  it('is urgent, for the front desk, at the patient’s centre or every centre', async () => {
    await rolledBack(async (tx) => {
      const details = fakePatientDetails();
      const patient = await insertPatient(tx, details);
      const known = await emergencyFrom(tx, details.phone);
      expect(
        await raiseEmergencyTask(tx, {
          messageId: known,
          phone: details.phone,
          patientId: patient.id,
          centreId: centreIds.hsrLayout,
        }),
      ).toBe('raised');
      const unknownPhone = fakeNumber();
      const unknown = await emergencyFrom(tx, unknownPhone);
      await raiseEmergencyTask(tx, {
        messageId: unknown,
        phone: unknownPhone,
        patientId: null,
        centreId: null,
      });
      const rows = await tasksFor(tx, [known, unknown]);
      expect(
        rows
          .map((row) => ({
            title: row.title,
            priority: row.priority,
            assigneeRole: row.assigneeRole,
            centreId: row.centreId,
            patientId: row.patientId,
            details: row.details,
          }))
          .sort((a, b) => String(a.centreId).localeCompare(String(b.centreId))),
      ).toEqual([
        {
          title: 'Emergency message on WhatsApp: call back now',
          priority: 'urgent',
          assigneeRole: 'front_desk',
          centreId: centreIds.hsrLayout,
          patientId: patient.id,
          details: { messageId: known },
        },
        {
          title: 'Emergency message on WhatsApp: call back now',
          priority: 'urgent',
          assigneeRole: 'front_desk',
          centreId: null,
          patientId: null,
          details: { messageId: unknown },
        },
      ]);
    });
  });

  it('is raised once per number while open, and again once it is closed', async () => {
    await rolledBack(async (tx) => {
      const phone = fakeNumber();
      const first = await emergencyFrom(tx, phone);
      const second = await emergencyFrom(tx, phone);
      const raise = (messageId: string) =>
        raiseEmergencyTask(tx, { messageId, phone, patientId: null, centreId: null });
      expect(await raise(first)).toBe('raised');
      expect(await raise(second)).toBe('open already');
      // Another number is its own task.
      const other = fakeNumber();
      expect(
        await raiseEmergencyTask(tx, {
          messageId: await emergencyFrom(tx, other),
          phone: other,
          patientId: null,
          centreId: null,
        }),
      ).toBe('raised');
      expect(await tasksFor(tx, [first, second])).toHaveLength(1);

      await tx
        .update(task)
        .set({ status: 'closed', decision: 'Called back.', closedAt: new Date() })
        .where(sql`${task.details} ->> 'messageId' = ${first}`);
      const third = await emergencyFrom(tx, phone);
      expect(await raise(third)).toBe('raised');
    });
  });

  it('shows the number to those who may read the task, and to no one else', async () => {
    const callBack = async (tx: Tx, as: StaffMember) => {
      await becomeStaff(tx, as);
      const shown = (await inboxTasks(tx)).find((entry) => entry.kind === 'call.emergency');
      const direct = await tx.execute<{ phone: string | null }>(
        sql`select internal.task_call_back_phone(id) as phone from public.task
            where kind = 'call.emergency' and status = 'open'`,
      );
      await tx.execute(sql`reset role`);
      return { card: shown?.callBackPhone ?? null, rows: [...direct].map((row) => row.phone) };
    };
    const setUp = async (tx: Tx) => {
      const phone = fakeNumber();
      // Every other open emergency task out of the way, so the inbox shows only this one.
      await tx
        .update(task)
        .set({ status: 'closed', decision: 'Test', closedAt: new Date() })
        .where(and(eq(task.kind, 'call.emergency'), eq(task.status, 'open')));
      await raiseEmergencyTask(tx, {
        messageId: await emergencyFrom(tx, phone),
        phone,
        patientId: null,
        centreId: centreIds.hsrLayout,
      });
      return phone;
    };

    await rolledBack(async (tx) => {
      const phone = await setUp(tx);
      expect(await callBack(tx, member('desk.hsr@clinicmx.test'))).toEqual({
        card: phone,
        rows: [phone],
      });
    });
    await rolledBack(async (tx) => {
      const phone = await setUp(tx);
      expect((await callBack(tx, member('super.admin@clinicmx.test'))).card).toBe(phone);
    });
    // A Velyx support login reads as the Super Admin, but never a patient's number: no message.
    await rolledBack(async (tx) => {
      await setUp(tx);
      expect((await callBack(tx, member('support.velyx@clinicmx.test'))).card).toBeNull();
    });
    // The front desk of another centre and a physio do not see the task, nor its number.
    for (const email of ['desk.koramangala@clinicmx.test', 'physio.hsr@clinicmx.test']) {
      await rolledBack(async (tx) => {
        await setUp(tx);
        expect(await callBack(tx, member(email))).toEqual({ card: null, rows: [] });
      });
    }
    // Asked directly for the task as someone who cannot read it: nothing.
    await rolledBack(async (tx) => {
      await setUp(tx);
      const [open] = await tx
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.kind, 'call.emergency'), eq(task.status, 'open')));
      await becomeStaff(tx, member('physio.hsr@clinicmx.test'));
      const [row] = await tx.execute<{ phone: string | null }>(
        sql`select internal.task_call_back_phone(${open?.id ?? ''}::uuid) as phone`,
      );
      expect(row?.phone).toBeNull();
    });
  });

  it('gives no number for any other kind of task', async () => {
    await rolledBack(async (tx) => {
      const [other] = await tx
        .insert(task)
        .values({
          kind: 'call.no_show',
          title: 'Test',
          details: { messageId: await emergencyFrom(tx, fakeNumber()) },
          priority: 'high',
          assigneeRole: 'front_desk',
        })
        .returning({ id: task.id });
      await becomeStaff(tx, member('super.admin@clinicmx.test'));
      const [row] = await tx.execute<{ phone: string | null }>(
        sql`select internal.task_call_back_phone(${other?.id ?? ''}::uuid) as phone`,
      );
      expect(row?.phone).toBeNull();
    });
  });
});
