import {
  centre,
  createDb,
  insertEpisode,
  insertGuardian,
  insertPatient,
  staffUser,
  updateEpisodeState,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import type { DischargeReason, EpisodeStatus, GuardianRelationship } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';

// Patients for end to end tests (SCH-01), made from the test runner. Generated details only
// (rule 12): "Test Patient" and a short id, on a +91 99 mobile with random digits. Patients are
// never deleted; each run makes its own.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** A random +91 99 mobile, as stored (E.164). */
export function fakeMobile(): string {
  return `+9199${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte % 10).join('')}`;
}

/** A generated name no other test uses. */
export function fakeName(label = 'Test Patient'): string {
  return `${label} ${crypto.randomUUID().slice(0, 8)}`;
}

/** Adds a generated patient at the centre with this code; returns their id and OP number. */
export async function testPatient(
  values: {
    name?: string;
    phone?: string;
    centreCode?: string;
    dateOfBirth?: string;
    sex?: 'female' | 'male' | 'other';
    occupation?: string;
  } = {},
): Promise<{ id: string; opNumber: string; name: string; phone: string }> {
  const [registering] = await db()
    .select({ id: centre.id })
    .from(centre)
    .where(eq(centre.code, values.centreCode ?? 'HSR'));
  if (!registering) throw new Error('The seed centres are missing.');
  const name = values.name ?? fakeName();
  const phone = values.phone ?? fakeMobile();
  const added = await withActor(db(), systemActor('tests'), (tx) =>
    insertPatient(tx, {
      name,
      phone,
      registeredCentreId: registering.id,
      ...(values.dateOfBirth ? { dateOfBirth: values.dateOfBirth } : {}),
      ...(values.sex ? { sex: values.sex } : {}),
      ...(values.occupation ? { occupation: values.occupation } : {}),
    }),
  );
  return { ...added, name, phone };
}

/** Adds a generated guardian to a patient (SCH-02); returns their name. */
export async function testGuardian(
  patientId: string,
  relationship: GuardianRelationship = 'mother',
): Promise<string> {
  const name = fakeName('Test Guardian');
  await withActor(db(), systemActor('tests'), (tx) =>
    insertGuardian(tx, patientId, { name, relationship, phone: fakeMobile() }),
  );
  return name;
}

/** A date of birth `years` years before today, in IST. */
export function bornYearsAgo(years: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
}

/**
 * Opens an episode at HSR Layout for a patient (SCH-03) and walks it through the machine's own
 * order to `status`: Intake pending, Awaiting consultation, Plan proposed, Active, then
 * Discharged with `reason` when asked, as the seeded Super Admin (a consultant who treats
 * patients: the database lets only such a person discharge, OUT-10).
 */
export async function testEpisode(
  patientId: string,
  status: Extract<
    EpisodeStatus,
    'intake_pending' | 'awaiting_consultation' | 'plan_proposed' | 'active' | 'discharged'
  >,
  reason: DischargeReason = 'goals_achieved',
): Promise<string> {
  const path: EpisodeStatus[] = [
    'intake_pending',
    'awaiting_consultation',
    'plan_proposed',
    'active',
    'discharged',
  ];
  return withActor(db(), systemActor('tests'), async (tx) => {
    const [hsr] = await tx.select({ id: centre.id }).from(centre).where(eq(centre.code, 'HSR'));
    if (!hsr) throw new Error('The seed centres are missing.');
    const id = await insertEpisode(tx, { patientId, centreId: hsr.id, bodyRegion: 'knee' });
    for (let step = 1; step <= path.indexOf(status); step++) {
      const from = path[step - 1] as EpisodeStatus;
      const to = path[step] as EpisodeStatus;
      if (to === 'discharged') {
        const [admin] = await tx
          .select({ id: staffUser.id })
          .from(staffUser)
          .where(eq(staffUser.email, 'super.admin@clinicmx.test'));
        const claims = JSON.stringify({ clinic: { staff_id: admin?.id } });
        await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      }
      await updateEpisodeState(
        tx,
        id,
        from,
        { status: to, pausedFrom: null },
        to === 'discharged' ? { reason } : undefined,
      );
    }
    return id;
  });
}
