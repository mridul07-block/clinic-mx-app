import { addDays } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { episodeSessionCounts, recordPlanBooking } from '../plan-sessions';
import { appointment, episode, job, planBooking } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { bookAppointment, seriesFit } from '../slots';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// SCH-11: Book plan sessions in the database. The series check loads the span once and offers
// alternatives clear of the series itself; a series is recorded only into an Active episode at
// its centre by those who book there, its appointments carry its id with the series' physio and
// type, the link never changes, and one WhatsApp plan sessions list is queued per series. Every
// test runs in a transaction that is rolled back. CI database only.
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
const deskHsr = member('desk.hsr@clinicmx.test');
const deskWhitefield = member('desk.whitefield@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');
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

const asOwner = (tx: Tx) => tx.execute(sql`reset role`);

/** A patient with an episode at HSR Layout moved to `status` the way the machine allows. */
async function testEpisode(tx: Tx, status: 'plan_proposed' | 'active') {
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  const path = ['awaiting_consultation', 'plan_proposed', 'active'] as const;
  for (const next of path.slice(0, path.indexOf(status) + 1)) {
    await tx.update(episode).set({ status: next }).where(eq(episode.id, episodeId));
  }
  return { patientId, episodeId };
}

const minutesOn = (date: string, instant: Date | undefined) =>
  instant ? (instant.getTime() - on(0, date).getTime()) / 60000 : undefined;

describe('Book plan sessions', () => {
  it('checks a series in one load: a clash gets that day and the next, clear of the series', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const session = await typeId(tx, 'session');
      const patientId = await testPatient(tx);
      const second = addDays(testDate, 1);
      const third = addDays(testDate, 2);
      await tx.insert(appointment).values({
        number: '',
        patientId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        startsAt: on(570, second),
        endsAt: on(660, second),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
      });
      await becomeStaff(tx, deskHsr);
      const rows = await seriesFit(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        starts: [on(600), on(600, second), on(600, third)],
        step: 15,
        now: new Date(),
        alternatives: 3,
      });
      expect(rows.map((row) => row.check.ok)).toEqual([true, false, true]);
      const clash = rows[1];
      expect(clash?.check).toEqual({ ok: false, refusal: 'taken' });
      expect(clash?.sameDay.map((slot) => minutesOn(second, slot.startsAt))).toHaveLength(3);
      // The third day's own session holds 10:00: the nearest the next day is 9:15 or 10:45.
      expect([555, 645]).toContain(minutesOn(third, clash?.nextDay?.startsAt));
    });
  });

  it('books a series as the desk: its appointments carry it and one list is queued', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const session = await typeId(tx, 'session');
      const { patientId, episodeId } = await testEpisode(tx, 'active');
      await becomeStaff(tx, deskHsr);
      const planBookingId = await recordPlanBooking(tx, {
        episodeId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        fromDate: testDate,
        weekdays: [1, 3],
        time: '10:00',
        bookedBy: deskHsr.id,
      });
      for (const date of [testDate, addDays(testDate, 2)]) {
        await bookAppointment(tx, {
          centreId: centreIds.hsrLayout,
          physioId: physio.id,
          appointmentTypeId: session,
          startsAt: on(600, date),
          holder: `plan-series:${deskHsr.id}`,
          patientId,
          episodeId,
          channel: 'front_desk',
          bookedBy: deskHsr.id,
          planBookingId,
          step: 15,
          now: new Date(),
        });
      }
      expect(await episodeSessionCounts(tx, episodeId, ['session'])).toEqual({
        booked: 2,
        done: 0,
      });
      const [series] = await tx.select().from(planBooking).where(eq(planBooking.id, planBookingId));
      expect(series?.weekdays).toEqual([1, 3]);
      const [first] = await tx
        .select({ id: appointment.id })
        .from(appointment)
        .where(eq(appointment.planBookingId, planBookingId))
        .limit(1);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(appointment)
            .set({ planBookingId: null })
            .where(eq(appointment.id, first?.id ?? '')),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) => sp.delete(planBooking).where(eq(planBooking.id, planBookingId))),
      ).toBe('42501');

      await asOwner(tx);
      const queued = await tx
        .select({ kind: job.kind, payload: job.payload })
        .from(job)
        .where(eq(job.idempotencyKey, ['whatsapp.plan_sessions_list', planBookingId].join(':')));
      expect(queued).toEqual([{ kind: 'whatsapp.plan_sessions_list', payload: { planBookingId } }]);
    });
  });

  it('records a series only into an Active episode, at a centre the person books for', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const session = await typeId(tx, 'session');
      const active = await testEpisode(tx, 'active');
      const proposed = await testEpisode(tx, 'plan_proposed');
      const series = (episodeId: string, bookedBy: string) => ({
        episodeId,
        centreId: centreIds.hsrLayout,
        physioId: physio.id,
        appointmentTypeId: session,
        fromDate: testDate,
        weekdays: [2],
        time: '10:00',
        bookedBy,
      });
      for (const actor of [deskWhitefield, physioHsr, support]) {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        expect(
          await failure(tx, (sp) => recordPlanBooking(sp, series(active.episodeId, actor.id))),
        ).toBe('42501');
        expect(await tx.select().from(planBooking)).toEqual([]);
      }
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      expect(
        await failure(tx, (sp) => recordPlanBooking(sp, series(proposed.episodeId, deskHsr.id))),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) => recordPlanBooking(sp, series(active.episodeId, superAdmin.id))),
      ).toBe('42501');
      const id = await recordPlanBooking(tx, series(active.episodeId, deskHsr.id));
      // The series' appointments have its physio: another physio is refused.
      const other = await (async () => {
        await asOwner(tx);
        const person = await testPhysio(tx, {
          centreIds: [centreIds.hsrLayout],
          createdBy: superAdmin.id,
        });
        await becomeStaff(tx, deskHsr);
        return person;
      })();
      expect(
        await failure(tx, (sp) =>
          bookAppointment(sp, {
            centreId: centreIds.hsrLayout,
            physioId: other.id,
            appointmentTypeId: session,
            startsAt: on(600),
            holder: `plan-series:${deskHsr.id}`,
            patientId: active.patientId,
            episodeId: active.episodeId,
            channel: 'front_desk',
            bookedBy: deskHsr.id,
            planBookingId: id,
            step: 15,
            now: new Date(),
          }),
        ),
      ).toBe('23514');
      expect((await tx.select().from(planBooking)).map((row) => row.id)).toEqual([id]);
    });
  });
});
