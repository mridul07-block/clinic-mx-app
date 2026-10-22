import { addDays } from '@clinic-mx/schemas';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  appointment,
  centre,
  patient,
  roster,
  slotHold,
  staffUser,
  staffUserCentre,
} from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import {
  SlotRefusedError,
  bookAppointment,
  datesWithFreeSlots,
  freeSlots,
  placeHold,
} from '../slots';
import { on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// SCH-04 done when: overbooking is impossible under concurrent tests, and a free slot query
// answers in under 2 s. The concurrent bookings commit on a pool of 10 connections (a rolled back
// transaction cannot race itself); everything they make is generated and removed afterwards. The
// speed test loads a year of appointments in a transaction that is rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 10 });

const superAdminId = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';
const tests = systemActor('tests');
const physios: StaffMember[] = [];
const patients: string[] = [];
let session = '';
let treadmill = '';
let treadmills = 0;

beforeAll(async () => {
  await withActor(db, tests, async (tx) => {
    session = await typeId(tx, 'session');
    treadmill = await typeId(tx, 'zero_gravity_treadmill');
    const [place] = await tx
      .select({ treadmills: centre.treadmills })
      .from(centre)
      .where(eq(centre.id, centreIds.hsrLayout));
    treadmills = place?.treadmills ?? 0;
    for (let i = 0; i < treadmills + 2; i++) {
      physios.push(
        await testPhysio(tx, { centreIds: [centreIds.hsrLayout], createdBy: superAdminId }),
      );
    }
    for (let i = 0; i < 10; i++) patients.push(await testPatient(tx));
  });
});

afterAll(async () => {
  const ids = physios.map((p) => p.id);
  await withActor(db, tests, async (tx) => {
    if (ids.length > 0) {
      await tx.delete(appointment).where(inArray(appointment.physioId, ids));
      await tx.delete(slotHold).where(inArray(slotHold.physioId, ids));
      await tx.delete(roster).where(inArray(roster.staffUserId, ids));
      await tx.delete(staffUserCentre).where(inArray(staffUserCentre.staffUserId, ids));
      await tx.delete(staffUser).where(inArray(staffUser.id, ids));
    }
    if (patients.length > 0) await tx.delete(patient).where(inArray(patient.id, patients));
  });
  await close();
});

const physio = (index: number) => {
  const found = physios[index];
  if (!found) throw new Error(`no physio ${index}`);
  return found;
};

/** Books at once on separate connections; how many won, and every loser's reason. */
async function race(
  attempts: { physioId: string; startsAt: Date; appointmentTypeId?: string; holder?: string }[],
) {
  const results = await Promise.allSettled(
    attempts.map((attempt, index) =>
      withActor(db, tests, (tx) =>
        bookAppointment(tx, {
          centreId: centreIds.hsrLayout,
          appointmentTypeId: session,
          holder: `test:race:${index}`,
          patientId: patients[index % patients.length] ?? '',
          channel: 'whatsapp',
          step: 15,
          now: new Date(),
          ...attempt,
        }),
      ),
    ),
  );
  const refusals = results.flatMap((r) =>
    r.status === 'rejected'
      ? [r.reason instanceof SlotRefusedError ? r.reason.refusal : String(r.reason)]
      : [],
  );
  return { won: results.filter((r) => r.status === 'fulfilled').length, refusals };
}

/** The physio's appointments that keep their slot, in time order. */
async function booked(physioId: string) {
  return db
    .select({ startsAt: appointment.startsAt, endsAt: appointment.endsAt })
    .from(appointment)
    .where(eq(appointment.physioId, physioId))
    .orderBy(appointment.startsAt);
}

describe('concurrent booking', () => {
  it('gives one slot to exactly one of 10 people booking it at once', async () => {
    const { won, refusals } = await race(
      Array.from({ length: 10 }, () => ({ physioId: physio(0).id, startsAt: on(600) })),
    );
    expect(won).toBe(1);
    expect(refusals).toEqual(Array.from({ length: 9 }, () => 'taken'));
    expect(await booked(physio(0).id)).toHaveLength(1);
  });

  it('never overlaps two appointments of a physio, whatever the starts', async () => {
    const starts = [540, 555, 570, 585, 615, 630, 645, 660, 675, 690];
    await race(starts.map((minutes) => ({ physioId: physio(1).id, startsAt: on(minutes) })));
    const rows = await booked(physio(1).id);
    expect(rows.length).toBeGreaterThan(0);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]?.startsAt.getTime()).toBeGreaterThanOrEqual(
        rows[i - 1]?.endsAt.getTime() ?? 0,
      );
    }
  });

  it('gives each treadmill to one physio at a time', async () => {
    const { won } = await race(
      physios.map((p) => ({ physioId: p.id, startsAt: on(750), appointmentTypeId: treadmill })),
    );
    expect(won).toBe(treadmills);
  });

  it('keeps a held slot for its holder while others try to book it', async () => {
    const holder = 'test:race:holder';
    await withActor(db, tests, (tx) =>
      placeHold(tx, {
        centreId: centreIds.hsrLayout,
        physioId: physio(2).id,
        appointmentTypeId: session,
        startsAt: on(540),
        holder,
        holdMinutes: 5,
        step: 15,
        now: new Date(),
      }),
    );
    const others = await race(
      Array.from({ length: 5 }, () => ({ physioId: physio(2).id, startsAt: on(540) })),
    );
    expect(others).toEqual({ won: 0, refusals: Array.from({ length: 5 }, () => 'taken') });
    const mine = await race([{ physioId: physio(2).id, startsAt: on(540), holder }]);
    expect(mine.won).toBe(1);
  });
});

describe('speed', () => {
  it('answers a free slot query in under 2 seconds with a year of appointments', async () => {
    class Rollback extends Error {}
    const timings: Record<string, number> = {};
    try {
      await withActor(db, tests, async (tx) => {
        const team: string[] = [];
        for (let i = 0; i < 15; i++) {
          const member = await testPhysio(tx, {
            centreIds: [centreIds.koramangala],
            blocks: [{ starts: 8 * 60, ends: 20 * 60 }],
            rosterFrom: addDays(testDate, -400),
            createdBy: superAdminId,
          });
          team.push(member.id);
        }
        const patientId = await testPatient(tx);
        // Eight 45 minute sessions a day per physio, 08:00 to 15:45, for a year and a month:
        // about 47,000 appointments, above the PRD's 2,850 a month.
        await tx.execute(sql`
          insert into appointment (number, patient_id, centre_id, physio_id, appointment_type_id,
            starts_at, ends_at, channel)
          select '', ${patientId}::uuid, ${centreIds.koramangala}::uuid, p, ${session}::uuid,
            d + make_interval(hours => 8 + h), d + make_interval(hours => 8 + h, mins => 45),
            'whatsapp'
          from unnest(${`{${team.join(',')}}`}::uuid[]) as p,
            generate_series(${on(0, addDays(testDate, -365)).toISOString()}::timestamptz,
              ${on(0, addDays(testDate, 30)).toISOString()}::timestamptz, interval '1 day') as d,
            generate_series(0, 7) as h`);
        await tx.execute(sql`analyze appointment`);
        const [counted] = await tx.execute<{ count: number }>(
          sql`select count(*)::int as count from appointment`,
        );
        expect(counted?.count).toBeGreaterThan(40000);

        let started = performance.now();
        const day = await freeSlots(tx, {
          centreId: centreIds.koramangala,
          appointmentTypeId: session,
          date: testDate,
          step: 15,
          now: new Date(),
        });
        timings.day = performance.now() - started;
        expect(day.filter((p) => team.includes(p.physioId))).toHaveLength(15);

        started = performance.now();
        const dates = await datesWithFreeSlots(tx, {
          centreId: centreIds.koramangala,
          appointmentTypeId: session,
          from: testDate,
          days: 30,
          step: 15,
          now: new Date(),
        });
        timings.month = performance.now() - started;
        expect(dates).toHaveLength(30);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    console.info(
      `free slots: one day ${Math.round(timings.day ?? 0)} ms, 30 days ${Math.round(timings.month ?? 0)} ms`,
    );
    expect(timings.day).toBeLessThan(2000);
    expect(timings.month).toBeLessThan(2000);
  }, 120_000);
});
