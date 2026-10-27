import { addDays, istDate, istInstant, type EpisodeStatus } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { kpiDaily } from '../kpis';
import { episode, patientPlanChoice, payment, planOfCare, priceItem } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import {
  asSystem,
  claimsOf,
  episodeThrough,
  healthForm,
  knowledgeVersion,
  note,
  paidBill,
  referred,
  visit,
} from './fake-figures';
import { becomeStaff, testPatient, testPhysio } from './fake-schedule';

// DSH-01: the figures, counted live from the records by centre and IST day, for the people and
// centres allowed to see them. Each test reads the figures before and after adding generated
// records, so rows already in the database never matter; everything is rolled back. CI database
// only.
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
const manager = member('manager@clinicmx.test');
const finance = member('finance@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
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

/** The Postgres error code a statement failed with, inside a savepoint. */
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
const past = addDays(today, -3);

type Figures = Map<string, { n: number; d: number | null }>;
const at = (centreId: string | null, day: string, metric: string) =>
  `${centreId ?? 'all'}|${day}|${metric}`;

/** The figures `staff` sees from `from` to `to`, keyed by centre, day and figure. */
async function figuresAs(tx: Tx, staff: StaffMember, from: string, to: string) {
  await becomeStaff(tx, staff);
  const rows = await kpiDaily(tx, from, to);
  await asSystem(tx);
  const figures: Figures = new Map();
  for (const row of rows) {
    figures.set(at(row.centreId, row.day, row.metric), {
      n: row.numerator,
      d: row.denominator,
    });
  }
  return figures;
}

/** What changed for one figure between two readings: [numerator, denominator]. */
function change(before: Figures, after: Figures, key: string): [number, number] {
  const a = before.get(key);
  const b = after.get(key);
  return [(b?.n ?? 0) - (a?.n ?? 0), (b?.d ?? 0) - (a?.d ?? 0)];
}

describe('the figures by centre and day', () => {
  it('counts the visit figures on the day of the visit, at its centre', async () => {
    await rolledBack(async (tx) => {
      const kb = await knowledgeVersion(tx);
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout, centreIds.koramangala],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const before = await figuresAs(tx, superAdmin, past, today);
      const hsr = centreIds.hsrLayout;
      const minute = 60_000;

      // A first consultation, signed the same day, its form submitted before the booked start.
      const first = await episodeThrough(tx, hsr, ['awaiting_consultation']);
      const one = await visit(tx, {
        centreId: hsr,
        physio,
        type: 'consultation',
        day: past,
        status: 'completed',
        episodeId: first.id,
        patientId: first.patientId,
      });
      await healthForm(tx, one, new Date(one.startsAt.getTime() - 10 * minute));
      await note(tx, {
        appointmentId: one.id,
        episodeId: first.id,
        physio,
        kbVersionId: kb,
        signedAt: new Date(one.startsAt.getTime() + 30 * minute),
      });
      // A later consultation in the same episode: not an initial assessment; left as a draft.
      const again = await visit(tx, {
        centreId: hsr,
        physio,
        type: 'consultation',
        day: past,
        status: 'checked_in',
        episodeId: first.id,
        patientId: first.patientId,
      });
      await note(tx, { appointmentId: again.id, episodeId: first.id, physio, kbVersionId: kb });
      // A first consultation signed the next day; its form submitted after the booked start.
      const late = await episodeThrough(tx, hsr, ['awaiting_consultation']);
      const two = await visit(tx, {
        centreId: hsr,
        physio,
        type: 'consultation',
        day: past,
        status: 'completed',
        episodeId: late.id,
        patientId: late.patientId,
      });
      await healthForm(tx, two, new Date(two.startsAt.getTime() + 5 * minute));
      await note(tx, {
        appointmentId: two.id,
        episodeId: late.id,
        physio,
        kbVersionId: kb,
        signedAt: new Date(two.startsAt.getTime() + 26 * 60 * minute),
      });
      // A no show, and a past visit nobody marked.
      await visit(tx, { centreId: hsr, physio, type: 'session', day: past, status: 'no_show' });
      await visit(tx, { centreId: hsr, physio, type: 'session', day: past, status: 'booked' });
      // At Koramangala: a first consultation not signed yet.
      const kor = await episodeThrough(tx, centreIds.koramangala, ['awaiting_consultation']);
      const three = await visit(tx, {
        centreId: centreIds.koramangala,
        physio,
        type: 'consultation',
        day: past,
        status: 'in_progress',
        episodeId: kor.id,
        patientId: kor.patientId,
      });
      await note(tx, { appointmentId: three.id, episodeId: kor.id, physio, kbVersionId: kb });

      const after = await figuresAs(tx, superAdmin, past, today);
      const on = (metric: string, centreId: string = hsr) =>
        change(before, after, at(centreId, past, metric));
      expect(on('red_flag_documentation')).toEqual([2, 2]);
      expect(on('red_flag_documentation', centreIds.koramangala)).toEqual([0, 1]);
      expect(on('notes_signed_same_day')).toEqual([1, 3]);
      expect(on('no_show_rate')).toEqual([1, 4]);
      expect(on('health_form_before_consultation')).toEqual([1, 3]);
      expect(on('consultations')).toEqual([2, 0]);
    });
  });

  it('counts conversion and acceptance on the day a plan is proposed, completion on discharge', async () => {
    await rolledBack(async (tx) => {
      const kb = await knowledgeVersion(tx);
      const hsr = centreIds.hsrLayout;
      const consultant = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const before = await figuresAs(tx, superAdmin, today, today);
      const proposed: EpisodeStatus[] = ['awaiting_consultation', 'plan_proposed'];

      // Paid and Active, after choosing Pay per session.
      const paid = await episodeThrough(tx, hsr, proposed);
      const choiceVisit = await visit(tx, {
        centreId: hsr,
        physio: consultant,
        type: 'consultation',
        day: today,
        status: 'checked_in',
        episodeId: paid.id,
        patientId: paid.patientId,
      });
      const consultationId = await note(tx, {
        appointmentId: choiceVisit.id,
        episodeId: paid.id,
        physio: consultant,
        kbVersionId: kb,
      });
      const [plan] = await tx
        .insert(planOfCare)
        .values({
          episodeId: paid.id,
          consultationId,
          version: 1,
          goals: [{ text: 'Walk without pain', patient: true }],
          homeProgramme: [],
          reviewDate: addDays(today, 42),
          treatingPhysioId: consultant.id,
          createdBy: consultant.id,
        })
        .returning({ id: planOfCare.id });
      const [sessionItem] = await tx
        .select({ id: priceItem.id })
        .from(priceItem)
        .where(eq(priceItem.key, 'rehabilitation_session'));
      // The newest choice counts: No thanks first, then Pay per session.
      for (const choice of ['no_thanks', 'per_session'] as const) {
        await tx.insert(patientPlanChoice).values({
          episodeId: paid.id,
          planOfCareId: plan?.id ?? '',
          choice,
          sessionPriceItemId: choice === 'per_session' ? sessionItem?.id : null,
          recordedBy: superAdmin.id,
        });
      }
      await tx.update(episode).set({ status: 'active' }).where(eq(episode.id, paid.id));
      // Proposed, not taken up.
      await episodeThrough(tx, hsr, proposed);
      // A red flag referral on hold: never proposed, so not counted.
      await episodeThrough(tx, hsr, ['awaiting_consultation', 'on_hold']);
      // Referred after the plan was proposed: On hold, so not counted either.
      const heldAfter = await episodeThrough(tx, hsr, proposed);
      await claimsOf(tx, consultant);
      await referred(tx, heldAfter.id, consultant, kb);
      await asSystem(tx);
      // Discharged after treatment: as recovered, and for another reason.
      const recovered = await episodeThrough(tx, hsr, [...proposed, 'active']);
      const stopped = await episodeThrough(tx, hsr, [...proposed, 'active']);
      // Discharged before treatment began: not in completion.
      const untreated = await episodeThrough(tx, hsr, proposed);
      await claimsOf(tx, consultant);
      const discharge = async (id: string, reason: 'goals_achieved' | 'patient_choice') =>
        tx
          .update(episode)
          .set({ status: 'discharged', dischargeReason: reason, closedAt: new Date() })
          .where(eq(episode.id, id));
      await discharge(recovered.id, 'goals_achieved');
      await discharge(stopped.id, 'patient_choice');
      await discharge(untreated.id, 'patient_choice');
      await asSystem(tx);

      const after = await figuresAs(tx, superAdmin, today, today);
      const on = (metric: string) => change(before, after, at(hsr, today, metric));
      // Proposed: paid, not taken up, recovered, stopped, untreated. Active: paid, recovered, stopped.
      expect(on('consultation_conversion')).toEqual([3, 5]);
      expect(on('plan_acceptance')).toEqual([1, 5]);
      expect(on('treatment_completion')).toEqual([1, 2]);
    });
  });

  it('leaves opening entries out of conversion', async () => {
    await rolledBack(async (tx) => {
      const hsr = centreIds.hsrLayout;
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const before = await figuresAs(tx, superAdmin, today, today);
      const opened = await episodeThrough(tx, hsr, [
        'awaiting_consultation',
        'plan_proposed',
        'active',
      ]);
      await claimsOf(tx, superAdmin);
      await tx.execute(sql`insert into opening_entry (patient_id, episode_id, centre_id, physio_id,
        sessions_left, valid_until)
        values (${opened.patientId}, ${opened.id}, ${hsr}, ${physio.id}, 6, ${addDays(today, 30)})`);
      await asSystem(tx);
      const after = await figuresAs(tx, superAdmin, today, today);
      expect(change(before, after, at(hsr, today, 'consultation_conversion'))).toEqual([0, 0]);
      expect(change(before, after, at(hsr, today, 'active_patients'))).toEqual([1, 0]);
    });
  });

  it('counts a patient treated at two centres at each, and once in all', async () => {
    await rolledBack(async (tx) => {
      const before = await figuresAs(tx, superAdmin, today, today);
      const knee = await episodeThrough(tx, centreIds.hsrLayout, [
        'awaiting_consultation',
        'plan_proposed',
        'active',
      ]);
      await episodeThrough(
        tx,
        centreIds.koramangala,
        ['awaiting_consultation', 'plan_proposed', 'active', 'under_review'],
        knee.patientId,
      );
      const after = await figuresAs(tx, superAdmin, today, today);
      const on = (centreId: string | null) =>
        change(before, after, at(centreId, today, 'active_patients'))[0];
      expect([on(centreIds.hsrLayout), on(centreIds.koramangala), on(null)]).toEqual([1, 1, 1]);
    });
  });

  it('rebuilds active patients at the end of each day from the status history', async () => {
    await rolledBack(async (tx) => {
      const hsr = centreIds.hsrLayout;
      const from = addDays(today, -6);
      const before = await figuresAs(tx, superAdmin, from, today);
      const [row] = await tx
        .insert(episode)
        .values({ patientId: await testPatient(tx), centreId: hsr })
        .returning({ id: episode.id });
      // Its history: Active from 5 days ago, On hold from 3 days ago, Under review from 2 days
      // ago; today it is Intake pending again (its real row, written now).
      const history: [number, EpisodeStatus][] = [
        [-5, 'active'],
        [-3, 'on_hold'],
        [-2, 'under_review'],
      ];
      for (const [days, status] of history) {
        await tx.execute(sql`insert into audit_event (actor, action, entity, entity_id, after, at)
          values ('system:tests', 'update', 'episode', ${row?.id ?? ''},
            jsonb_build_object('status', ${status}::text),
            ${istInstant(addDays(today, days), 12 * 60).toISOString()}::timestamptz)`);
      }
      const after = await figuresAs(tx, superAdmin, from, today);
      const on = (days: number) =>
        change(before, after, at(hsr, addDays(today, days), 'active_patients'))[0];
      expect([-6, -5, -4, -3, -2, -1, 0].map(on)).toEqual([0, 1, 1, 0, 1, 1, 0]);
    });
  });

  it('counts payments not undone as revenue, on the day recorded', async () => {
    await rolledBack(async (tx) => {
      const hsr = centreIds.hsrLayout;
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const before = await figuresAs(tx, finance, today, today);
      await paidBill(tx, hsr, physio, 150_000);
      const undone = await paidBill(tx, hsr, physio, 90_000);
      await tx
        .update(payment)
        .set({ undoneAt: new Date(), undoneBy: deskHsr.id, undoReason: 'Recorded twice' })
        .where(eq(payment.id, undone));
      const after = await figuresAs(tx, finance, today, today);
      expect(change(before, after, at(hsr, today, 'revenue'))).toEqual([150_000, 0]);
    });
  });
});

describe('who sees the figures', () => {
  it('gives each person only their figures and centres, and refuses everyone else', async () => {
    await rolledBack(async (tx) => {
      const from = addDays(today, -30);
      const metrics = (figures: Figures) =>
        new Set([...figures.keys()].map((key) => key.split('|')[2]));
      const centres = (figures: Figures) =>
        new Set(
          [...figures.keys()].map((key) => key.split('|')[0]).filter((centre) => centre !== 'all'),
        );
      // At HSR Layout, which the manager sees: a no show, an Active episode and a payment.
      const hsr = centreIds.hsrLayout;
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      await visit(tx, { centreId: hsr, physio, type: 'session', day: past, status: 'no_show' });
      await episodeThrough(tx, hsr, ['awaiting_consultation', 'plan_proposed', 'active']);
      await paidBill(tx, hsr, physio, 120_000);
      // A visit at Whitefield, a centre the manager does not see.
      const whitefield = await testPhysio(tx, {
        centreIds: [centreIds.whitefield],
        createdBy: superAdmin.id,
      });
      await visit(tx, {
        centreId: centreIds.whitefield,
        physio: whitefield,
        type: 'session',
        day: past,
        status: 'no_show',
      });

      const managerSees = await figuresAs(tx, manager, from, today);
      expect(manager.centreIds).not.toContain(centreIds.whitefield);
      expect(metrics(managerSees).has('revenue')).toBe(false);
      expect(metrics(managerSees).has('no_show_rate')).toBe(true);
      expect(managerSees.has(at(null, today, 'active_patients'))).toBe(true);
      expect(centres(managerSees).size).toBeGreaterThan(0);
      for (const centreId of centres(managerSees)) {
        expect(manager.centreIds).toContain(centreId);
      }
      const financeSees = await figuresAs(tx, finance, from, today);
      expect([...metrics(financeSees)]).toEqual(['revenue']);
      expect(financeSees.get(at(hsr, today, 'revenue'))?.n).toBeGreaterThanOrEqual(120_000);
      const all = await figuresAs(tx, superAdmin, from, today);
      expect(metrics(all).has('active_patients')).toBe(true);
      expect(centres(all).has(centreIds.whitefield)).toBe(true);

      for (const someone of [deskHsr, physioHsr]) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, someone);
            await kpiDaily(sp, today, today);
          }),
        ).toBe('42501');
      }
      // A period too long, or the wrong way round.
      for (const [start, end] of [
        [addDays(today, -400), today],
        [today, addDays(today, -1)],
      ] as const) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, superAdmin);
            await kpiDaily(sp, start, end);
          }),
        ).toBe('22023');
      }
    });
  });
});

describe('the episode’s milestones', () => {
  it('stamps the first plan proposal and activation once, and nobody sets them', async () => {
    await rolledBack(async (tx) => {
      const hsr = centreIds.hsrLayout;
      const early = new Date('2026-01-01T00:00:00Z');
      const [row] = await tx
        .insert(episode)
        .values({ patientId: await testPatient(tx), centreId: hsr, activatedAt: early })
        .returning({ id: episode.id, activatedAt: episode.activatedAt });
      expect(row?.activatedAt).toBeNull();
      const id = row?.id ?? '';
      const read = async () =>
        (
          await tx
            .select({ proposed: episode.planProposedAt, activated: episode.activatedAt })
            .from(episode)
            .where(eq(episode.id, id))
        )[0];
      for (const status of ['awaiting_consultation', 'plan_proposed', 'active'] as const) {
        await tx.update(episode).set({ status }).where(eq(episode.id, id));
      }
      const stamped = await read();
      expect(stamped?.proposed).toBeInstanceOf(Date);
      expect(stamped?.activated).toBeInstanceOf(Date);
      // Stamps earlier than this transaction's own time, so a second stamp would show.
      const first = { proposed: new Date('2026-02-01T05:00:00Z'), activated: early };
      await tx.execute(sql`alter table episode disable trigger episode_milestones`);
      await tx
        .update(episode)
        .set({ planProposedAt: first.proposed, activatedAt: first.activated })
        .where(eq(episode.id, id));
      await tx.execute(sql`alter table episode enable trigger episode_milestones`);
      // Paused and back, or a direct change: the first stamps stay.
      await tx
        .update(episode)
        .set({ status: 'on_hold', pausedFrom: 'active' })
        .where(eq(episode.id, id));
      await tx
        .update(episode)
        .set({ status: 'active', pausedFrom: null })
        .where(eq(episode.id, id));
      await tx
        .update(episode)
        .set({ activatedAt: new Date(), planProposedAt: null })
        .where(eq(episode.id, id));
      expect(await read()).toEqual(first);
    });
  });
});
