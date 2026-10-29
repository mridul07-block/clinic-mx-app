import { addDays, istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { recordPayment } from '../bills';
import { createDb } from '../client';
import { patientUnpaid, ytpBalances } from '../finance';
import type { StaffMember } from '../identity';
import {
  auditEvent,
  bill,
  billLine,
  packageType,
  patientPackage,
  patientPlanChoice,
  payment,
  planOfCare,
  priceItem,
  treatmentSession,
} from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { todayBoard } from '../today';
import { asSystem, claimsOf, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// BIL-10 done when: a balance is the patient's unpaid bills (payments are whole), and more than 3
// unpaid sessions flags the patient. Signing a session in an episode whose newest plan choice is
// pay per session, with no package used for it, makes one session bill at the chosen session
// price; read per patient under each reader's own access. Rolled back. CI database only.
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
const finance = member('finance@clinicmx.test');
const manager = member('manager@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');

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

const today = istDate(new Date());

/**
 * An Active episode at HSR Layout with its plan, the patient's `choice` recorded (pay per session
 * at the rehabilitation session's price unless said otherwise), and a way to sign sessions.
 */
async function paidPerSession(tx: Tx, choice: 'per_session' | 'package' | null = 'per_session') {
  await asSystem(tx);
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const kb = await knowledgeVersion(tx);
  const opened = await episodeThrough(tx, centreIds.hsrLayout, [
    'awaiting_consultation',
    'plan_proposed',
    'active',
  ]);
  const [price] = await tx
    .select({ id: priceItem.id, label: priceItem.label, amountPaise: priceItem.amountPaise })
    .from(priceItem)
    .where(eq(priceItem.key, 'rehabilitation_session'));
  if (!price) throw new Error('seed has no rehabilitation session price');
  const seen = await visit(tx, {
    centreId: centreIds.hsrLayout,
    physio,
    type: 'consultation',
    day: addDays(today, -3),
    status: 'completed',
    episodeId: opened.id,
    patientId: opened.patientId,
  });
  const consultationId = await note(tx, {
    appointmentId: seen.id,
    episodeId: opened.id,
    physio,
    kbVersionId: kb,
    signedAt: new Date(Date.now() - 3 * 86_400_000),
  });
  // The plan and the choice placed directly, guards and triggers off; the fee bill is not wanted.
  await tx.execute(sql`set local session_replication_role = replica`);
  const [plan] = await tx
    .insert(planOfCare)
    .values({
      episodeId: opened.id,
      consultationId,
      version: 1,
      goals: [{ text: 'Generated goal', patient: true }],
      interventions: ['exercise'],
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [],
      reviewDate: addDays(today, 30),
      treatingPhysioId: physio.id,
      createdBy: physio.id,
    })
    .returning({ id: planOfCare.id });
  let packageTypeId: string | null = null;
  if (choice === 'package') {
    const [offer] = await tx
      .insert(packageType)
      .values({ name: 'Test Two sessions', sessions: 2, pricePaise: 300000 })
      .returning({ id: packageType.id });
    packageTypeId = offer?.id ?? null;
  }
  let choiceId: string | null = null;
  if (choice) {
    const [chosen] = await tx
      .insert(patientPlanChoice)
      .values({
        episodeId: opened.id,
        planOfCareId: plan?.id ?? '',
        choice,
        packageTypeId,
        sessionPriceItemId: price.id,
        recordedBy: deskHsr.id,
      })
      .returning({ id: patientPlanChoice.id });
    choiceId = chosen?.id ?? null;
  }
  await tx.execute(sql`set local session_replication_role = origin`);

  const session = async (day = addDays(today, -1)) => {
    const booked = await visit(tx, {
      centreId: centreIds.hsrLayout,
      physio,
      type: 'session',
      day,
      status: 'checked_in',
      episodeId: opened.id,
      patientId: opened.patientId,
    });
    const [row] = await tx
      .insert(treatmentSession)
      .values({
        appointmentId: booked.id,
        episodeId: opened.id,
        patientId: opened.patientId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        number: 0,
        kbVersionId: kb,
      })
      .returning({ id: treatmentSession.id, number: treatmentSession.number });
    if (!row) throw new Error('no session');
    return { appointmentId: booked.id, ...row };
  };
  const sign = async (sessionId: string) => {
    await claimsOf(tx, physio);
    await tx
      .update(treatmentSession)
      .set({
        status: 'signed',
        signedBy: physio.id,
        signedAt: new Date(),
        painRest: 2,
        painActivity: 4,
        painAfter: 1,
      })
      .where(eq(treatmentSession.id, sessionId));
    await asSystem(tx);
  };
  const signed = async () => {
    const one = await session();
    await sign(one.id);
    return one;
  };
  return { ...opened, physio, price, choiceId, packageTypeId, session, sign, signed };
}

const sessionBills = (tx: Tx, episodeId: string) =>
  tx
    .select({
      id: bill.id,
      number: bill.number,
      status: bill.status,
      appointmentId: bill.appointmentId,
      planChoiceId: bill.planChoiceId,
      totalPaise: bill.totalPaise,
      createdBy: bill.createdBy,
    })
    .from(bill)
    .where(and(eq(bill.episodeId, episodeId), eq(bill.kind, 'session')))
    .orderBy(bill.number);

describe('session bills', () => {
  it('bills each signed session paid per session once, at the chosen session price', async () => {
    await rolledBack(async (tx) => {
      const fixture = await paidPerSession(tx);
      const draft = await fixture.session();
      expect(await sessionBills(tx, fixture.id), 'a draft is not billed').toEqual([]);
      await fixture.sign(draft.id);
      const [made, ...more] = await sessionBills(tx, fixture.id);
      expect(more).toEqual([]);
      expect(made).toMatchObject({
        status: 'unpaid',
        appointmentId: draft.appointmentId,
        planChoiceId: null,
        totalPaise: fixture.price.amountPaise,
        createdBy: fixture.physio.id,
      });
      expect(made?.number).toMatch(/^HSR-B-\d{5,}$/);
      const lines = await tx
        .select({
          id: billLine.id,
          priceItemId: billLine.priceItemId,
          description: billLine.description,
          quantity: billLine.quantity,
          amountPaise: billLine.amountPaise,
        })
        .from(billLine)
        .where(eq(billLine.billId, made?.id ?? ''));
      expect(lines).toEqual([
        {
          id: expect.any(String) as string,
          priceItemId: fixture.price.id,
          description: `${fixture.price.label}, session ${String(draft.number)}`,
          quantity: 1,
          amountPaise: fixture.price.amountPaise,
        },
      ]);

      // Made again for the same session: the same bill, never a second.
      const [again] = await tx.execute<{ id: string | null }>(
        sql`select internal.make_session_bill(${draft.id}::uuid) as id`,
      );
      expect(again?.id).toBe(made?.id);
      expect(await sessionBills(tx, fixture.id)).toHaveLength(1);

      // The price master's amount when signed: a later price for the next session.
      await tx
        .update(priceItem)
        .set({ amountPaise: fixture.price.amountPaise + 10_000 })
        .where(eq(priceItem.id, fixture.price.id));
      await fixture.signed();
      expect((await sessionBills(tx, fixture.id)).map((row) => row.totalPaise)).toEqual([
        fixture.price.amountPaise,
        fixture.price.amountPaise + 10_000,
      ]);

      // Audited: the bill and its line, as whoever signed (here the tests' own actor).
      for (const [entity, id] of [
        ['bill', made?.id ?? ''],
        ['bill_line', lines[0]?.id ?? ''],
      ] as const) {
        const audited = await tx
          .select({ action: auditEvent.action, actor: auditEvent.actor })
          .from(auditEvent)
          .where(and(eq(auditEvent.entity, entity), eq(auditEvent.entityId, id)));
        expect(audited, entity).toEqual([{ action: 'insert', actor: 'system:tests' }]);
      }
    });
  });

  it('bills nothing with no choice, a package choice, or a package used for the session', async () => {
    await rolledBack(async (tx) => {
      const none = await paidPerSession(tx, null);
      await none.signed();
      expect(await sessionBills(tx, none.id), 'no choice').toEqual([]);
    });
    await rolledBack(async (tx) => {
      // DECISION BIL-10: a package episode with no usable package bills nothing for its sessions.
      const chosen = await paidPerSession(tx, 'package');
      await chosen.signed();
      expect(await sessionBills(tx, chosen.id), 'a package, none held').toEqual([]);
    });
    await rolledBack(async (tx) => {
      // Pay per session now, but a package bought earlier in the episode is still held: it is used.
      const fixture = await paidPerSession(tx);
      await tx.execute(sql`set local session_replication_role = replica`);
      const [offer] = await tx
        .insert(packageType)
        .values({ name: 'Test Held sessions', sessions: 2, pricePaise: 300000 })
        .returning({ id: packageType.id });
      const [earlier] = await tx
        .insert(patientPlanChoice)
        .values({
          episodeId: fixture.id,
          planOfCareId:
            (
              await tx
                .select({ id: planOfCare.id })
                .from(planOfCare)
                .where(eq(planOfCare.episodeId, fixture.id))
            )[0]?.id ?? '',
          choice: 'package',
          packageTypeId: offer?.id ?? '',
          sessionPriceItemId: fixture.price.id,
          recordedBy: deskHsr.id,
          recordedAt: new Date(Date.now() - 86_400_000),
        })
        .returning({ id: patientPlanChoice.id });
      const [bought] = await tx
        .insert(bill)
        .values({
          number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
          kind: 'package',
          status: 'paid',
          patientId: fixture.patientId,
          episodeId: fixture.id,
          centreId: centreIds.hsrLayout,
          planChoiceId: earlier?.id ?? '',
          totalPaise: 300000,
        })
        .returning({ id: bill.id });
      const [paid] = await tx
        .insert(payment)
        .values({
          billId: bought?.id ?? '',
          method: 'upi',
          amountPaise: 300000,
          recordedBy: deskHsr.id,
        })
        .returning({ id: payment.id });
      await tx.insert(patientPackage).values({
        patientId: fixture.patientId,
        episodeId: fixture.id,
        centreId: centreIds.hsrLayout,
        packageTypeId: offer?.id ?? '',
        billId: bought?.id ?? '',
        paymentId: paid?.id ?? '',
        name: 'Test Held sessions',
        sessionsTotal: 2,
        reschedulesLeft: 1,
        paidAt: new Date(),
        validUntil: addDays(today, 30),
      });
      await tx.execute(sql`set local session_replication_role = origin`);
      const used = await fixture.signed();
      const [row] = await tx
        .select({ packageId: treatmentSession.packageId })
        .from(treatmentSession)
        .where(eq(treatmentSession.id, used.id));
      expect(row?.packageId, 'the package was used').not.toBeNull();
      expect(await sessionBills(tx, fixture.id), 'a package session').toEqual([]);
    });
  });

  it('keeps one live bill per session visit, naming its visit, and nobody signed in makes one', async () => {
    await rolledBack(async (tx) => {
      const fixture = await paidPerSession(tx);
      const one = await fixture.signed();
      const insertSession = (
        sp: Tx,
        values: { appointmentId: string | null; planChoiceId: string | null },
      ) =>
        sp.insert(bill).values({
          number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
          kind: 'session',
          patientId: fixture.patientId,
          episodeId: fixture.id,
          centreId: centreIds.hsrLayout,
          totalPaise: 1000,
          ...values,
        });
      expect(
        await failure(tx, (sp) =>
          insertSession(sp, { appointmentId: one.appointmentId, planChoiceId: null }),
        ),
        'a second live bill',
      ).toBe('23505');
      expect(
        await failure(tx, (sp) => insertSession(sp, { appointmentId: null, planChoiceId: null })),
        'no visit',
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          insertSession(sp, { appointmentId: one.appointmentId, planChoiceId: fixture.choiceId }),
        ),
        'a plan choice',
      ).toBe('23514');
      for (const actor of [deskHsr, superAdmin]) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, actor);
            await sp.execute(sql`select internal.make_session_bill(${one.id}::uuid)`);
          }),
          actor.email,
        ).toBe('42501');
      }
    });
  });
});

describe('pay as you go balances', () => {
  it('sum each patient’s unpaid bills and count their unpaid sessions; paying one lowers both', async () => {
    await rolledBack(async (tx) => {
      const fixture = await paidPerSession(tx);
      for (let count = 0; count < 4; count += 1) await fixture.signed();
      const amount = fixture.price.amountPaise;
      await becomeStaff(tx, deskHsr);
      expect(await patientUnpaid(tx, fixture.patientId)).toEqual({
        unpaidPaise: 4 * amount,
        unpaidBills: 4,
        unpaidSessions: 4,
      });
      const row = (await ytpBalances(tx)).find((entry) => entry.patientId === fixture.patientId);
      expect(row).toMatchObject({
        centreName: 'HSR Layout',
        unpaidPaise: 4 * amount,
        unpaidBills: 4,
        unpaidSessions: 4,
      });
      const [first] = await sessionBills(tx, fixture.id);
      await recordPayment(tx, { billId: first?.id ?? '', method: 'cash' });
      expect(await patientUnpaid(tx, fixture.patientId)).toEqual({
        unpaidPaise: 3 * amount,
        unpaidBills: 3,
        unpaidSessions: 3,
      });
    });
  });

  it('are read by those who see amounts at the centre: the desk there, Finance, the Super Admin', async () => {
    await rolledBack(async (tx) => {
      const fixture = await paidPerSession(tx);
      await fixture.signed();
      const reads = async (actor: StaffMember) => {
        await asSystem(tx);
        await becomeStaff(tx, actor);
        const balance = (await ytpBalances(tx)).some(
          (entry) => entry.patientId === fixture.patientId,
        );
        return { balance, owed: (await patientUnpaid(tx, fixture.patientId)).unpaidSessions };
      };
      for (const reader of [deskHsr, finance, superAdmin]) {
        expect(await reads(reader), reader.email).toEqual({ balance: true, owed: 1 });
      }
      for (const outsider of [deskKoramangala, manager, physioHsr, fixture.physio]) {
        expect(await reads(outsider), outsider.email).toEqual({ balance: false, owed: 0 });
      }
    });
  });

  it('count a patient once across the centres the reader sees, on Finance and on Today alike', async () => {
    await rolledBack(async (tx) => {
      const fixture = await paidPerSession(tx);
      await fixture.signed();
      await fixture.signed();
      // Two more unpaid session bills at Koramangala, placed directly.
      for (let count = 0; count < 2; count += 1) {
        const elsewhere = await visit(tx, {
          centreId: centreIds.koramangala,
          physio: fixture.physio,
          type: 'session',
          day: addDays(today, -2 - count),
          status: 'completed',
          patientId: fixture.patientId,
        });
        await tx.insert(bill).values({
          number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
          kind: 'session',
          patientId: fixture.patientId,
          centreId: centreIds.koramangala,
          appointmentId: elsewhere.id,
          totalPaise: 1000,
        });
      }
      // Today's visit at HSR Layout, for the board.
      await visit(tx, {
        centreId: centreIds.hsrLayout,
        physio: fixture.physio,
        type: 'session',
        day: today,
        status: 'booked',
        episodeId: fixture.id,
        patientId: fixture.patientId,
      });
      const seen = async (actor: StaffMember) => {
        await asSystem(tx);
        await becomeStaff(tx, actor);
        const balance = (await ytpBalances(tx)).find(
          (entry) => entry.patientId === fixture.patientId,
        );
        const row = (await todayBoard(tx, { centreId: centreIds.hsrLayout, date: today })).find(
          (entry) => entry.patientId === fixture.patientId,
        );
        return {
          centres: balance?.centreName ?? null,
          finance: balance?.unpaidSessions ?? 0,
          today: row?.unpaidSessions ?? null,
        };
      };
      expect(await seen(superAdmin)).toEqual({
        centres: 'HSR Layout, Koramangala',
        finance: 4,
        today: 4,
      });
      expect(await seen(deskHsr)).toEqual({ centres: 'HSR Layout', finance: 2, today: 2 });
      // Those who see no amounts count nothing on the board.
      expect(await seen(manager)).toEqual({ centres: null, finance: 0, today: 0 });
    });
  });
});
