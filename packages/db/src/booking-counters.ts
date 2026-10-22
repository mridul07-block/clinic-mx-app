import { eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { bookingCounter, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * A patient's reschedules asked by them and verified no shows (SCH-09). The database's trigger
 * on appointment counts; nothing here adds to them.
 */
export interface BookingCounterEntry {
  reschedules: number;
  noShows: number;
  /** When the block was last lifted, and by whom. */
  liftedAt: Date | null;
  liftedByName: string | null;
}

const liftedBy = alias(staffUser, 'lifted_by_staff');

/** The patient's counts, as the reader may see them; zeros when nothing was counted yet. */
export async function bookingCounterOf(
  db: DbOrTransaction,
  patientId: string,
): Promise<BookingCounterEntry> {
  const [row] = await db
    .select({
      reschedules: bookingCounter.reschedules,
      noShows: bookingCounter.noShows,
      liftedAt: bookingCounter.liftedAt,
      liftedByName: liftedBy.name,
    })
    .from(bookingCounter)
    .leftJoin(liftedBy, eq(liftedBy.id, bookingCounter.liftedBy))
    .where(eq(bookingCounter.patientId, patientId));
  return row ?? { reschedules: 0, noShows: 0, liftedAt: null, liftedByName: null };
}

/**
 * Lets a blocked patient book themselves again: both counts to zero, with who and when. Inside
 * the caller's transaction; false when there was nothing counted to lift.
 */
export async function liftBookingBlock(
  tx: DbOrTransaction,
  change: { patientId: string; liftedBy: string; now: Date },
): Promise<boolean> {
  const rows = await tx
    .update(bookingCounter)
    .set({
      reschedules: 0,
      noShows: 0,
      liftedAt: change.now,
      liftedBy: change.liftedBy,
      updatedAt: sql`now()`,
    })
    .where(eq(bookingCounter.patientId, change.patientId))
    .returning({ id: bookingCounter.id });
  return rows.length > 0;
}
