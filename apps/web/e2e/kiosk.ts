import { createDb, kioskDevice, sendLinkToKiosk, systemActor, withActor } from '@clinic-mx/db';
import { eq } from 'drizzle-orm';

// Clinic tablets for end to end tests (IAM-10). "Open on tablet" comes with the check in drawer
// (INT-02); until then the runner sends a form to a tablet with the same database function the
// send service uses.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** The tablet set up with this name (each test names its own). */
export async function tabletNamed(name: string): Promise<string> {
  const [row] = await db()
    .select({ id: kioskDevice.id })
    .from(kioskDevice)
    .where(eq(kioskDevice.name, name));
  if (!row) throw new Error(`No tablet named ${name}`);
  return row.id;
}

/** Sends a form to a tablet, as "Open on tablet" will. */
export async function sendToTablet(kioskId: string, linkId: string): Promise<void> {
  const sent = await withActor(db(), systemActor('tests'), (tx) =>
    sendLinkToKiosk(tx, kioskId, linkId),
  );
  if (!sent) throw new Error('The tablet is no longer a kiosk.');
}

/** The form on a tablet now, if any. */
export async function formOnTablet(kioskId: string): Promise<string | null> {
  const [row] = await db()
    .select({ linkId: kioskDevice.currentLinkId })
    .from(kioskDevice)
    .where(eq(kioskDevice.id, kioskId));
  return row?.linkId ?? null;
}
