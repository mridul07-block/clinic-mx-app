import {
  centre,
  createDb,
  insertGuardian,
  insertPatient,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import type { GuardianRelationship } from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';

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
  values: { name?: string; phone?: string; centreCode?: string; dateOfBirth?: string } = {},
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
