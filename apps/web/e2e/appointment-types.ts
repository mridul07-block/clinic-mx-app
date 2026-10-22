import {
  appointmentType,
  createDb,
  physioAppointmentLength,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { and, eq, inArray, like } from 'drizzle-orm';

// Appointment types for end to end tests (SET-03). Tests that change them hold the
// `e2e appointment types` lock, take a snapshot first and put it back afterwards: types a test
// added ("E2E …") and physio lengths set since are removed (the audit trail keeps them).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

export interface AppointmentTypeSnapshot {
  types: (typeof appointmentType.$inferSelect)[];
  lengths: (typeof physioAppointmentLength.$inferSelect)[];
}

/** The types and physio lengths as they are now. */
export async function snapshotAppointmentTypes(): Promise<AppointmentTypeSnapshot> {
  return {
    types: await db().select().from(appointmentType),
    lengths: await db().select().from(physioAppointmentLength),
  };
}

/** Puts the snapshot back: test types and new physio lengths go, the rest as they were. */
export async function restoreAppointmentTypes(snapshot: AppointmentTypeSnapshot): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const kept = new Set(
      snapshot.lengths.map((row) => `${row.staffUserId}/${row.appointmentTypeId}`),
    );
    for (const row of await tx.select().from(physioAppointmentLength)) {
      const where = and(
        eq(physioAppointmentLength.staffUserId, row.staffUserId),
        eq(physioAppointmentLength.appointmentTypeId, row.appointmentTypeId),
      );
      if (!kept.has(`${row.staffUserId}/${row.appointmentTypeId}`)) {
        await tx.delete(physioAppointmentLength).where(where);
      }
    }
    for (const row of snapshot.lengths) {
      await tx
        .update(physioAppointmentLength)
        .set({ minutes: row.minutes })
        .where(
          and(
            eq(physioAppointmentLength.staffUserId, row.staffUserId),
            eq(physioAppointmentLength.appointmentTypeId, row.appointmentTypeId),
          ),
        );
    }
    const added = (
      await tx
        .select({ id: appointmentType.id })
        .from(appointmentType)
        .where(like(appointmentType.name, 'E2E %'))
    ).map((row) => row.id);
    if (added.length) await tx.delete(appointmentType).where(inArray(appointmentType.id, added));
    for (const { id, name, minutes, active } of snapshot.types) {
      await tx
        .update(appointmentType)
        .set({ name, minutes, active })
        .where(eq(appointmentType.id, id));
    }
  });
}
