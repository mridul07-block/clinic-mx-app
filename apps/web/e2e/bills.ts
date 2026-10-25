import { appointment, createDb, staffUser, systemActor, withActor } from '@clinic-mx/db';
import { eq, sql } from 'drizzle-orm';

// Bills for end to end tests (BIL-05): the database makes them, so tests set what makes them (a
// consultant's fee) and complete the visit as signing does. Bills go with the visit's physio in
// removeCalendarRows.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Sets a consultant's consultation fee to a price item, by its key, or to none. */
export async function consultantFee(staffId: string, itemKey: string | null): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(staffUser)
      .set({
        consultationPriceItemId: itemKey
          ? sql`(select id from price_item where key = ${itemKey})`
          : null,
      })
      .where(eq(staffUser.id, staffId)),
  );
}

/** Completes a checked in visit, as signing its consultation does; the fee bill follows. */
export async function completeVisit(appointmentId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), (tx) =>
    tx
      .update(appointment)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(appointment.id, appointmentId)),
  );
}
