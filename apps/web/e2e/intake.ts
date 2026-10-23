import {
  appointment,
  auditEvent,
  createDb,
  intakeResponse,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { and, eq } from 'drizzle-orm';

// The health form in the database for end to end tests (INT-04): what a visit's form saved and
// who the audit says saved it; and a check in undone, as the desk's Undo does. Generated
// patients only (rule 12).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** A visit's health form as saved, and the actors of its audit rows. */
export async function savedForm(appointmentId: string) {
  const [form] = await db()
    .select({
      id: intakeResponse.id,
      formVersion: intakeResponse.formVersion,
      answers: intakeResponse.answers,
      doneScreens: intakeResponse.doneScreens,
    })
    .from(intakeResponse)
    .where(eq(intakeResponse.appointmentId, appointmentId));
  if (!form) return undefined;
  const audit = await db()
    .select({ actor: auditEvent.actor })
    .from(auditEvent)
    .where(and(eq(auditEvent.entity, 'intake_response'), eq(auditEvent.entityId, form.id)));
  return { ...form, actors: [...new Set(audit.map((a) => a.actor))] };
}

/** Undoes a check in, back to Booked, as the desk's Undo check in does the same day. */
export async function undoCheckInOf(appointmentId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(appointment)
      .set({ status: 'booked', arrivedAt: null, checkedInBy: null })
      .where(eq(appointment.id, appointmentId)),
  );
}
