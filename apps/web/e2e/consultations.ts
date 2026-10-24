import { consultation, createDb } from '@clinic-mx/db';
import { eq } from 'drizzle-orm';

// Reading consultations back for the CLN-02 end to end tests; removed with removeCalendarRows.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** The visit's consultation as saved: its sections and version, or undefined. */
export async function savedConsultation(
  appointmentId: string,
): Promise<{ sections: Record<string, { notes?: string }>; version: number } | undefined> {
  const [row] = await db()
    .select({ sections: consultation.sections, version: consultation.version })
    .from(consultation)
    .where(eq(consultation.appointmentId, appointmentId));
  return (
    row && { sections: row.sections as Record<string, { notes?: string }>, version: row.version }
  );
}
