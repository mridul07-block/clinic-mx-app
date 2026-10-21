import {
  auditEvent,
  completePatientLinkRow,
  createDb,
  insertPatientLink,
  patientLink,
  revokeMyPlanLinks,
  signPatientLink,
  systemActor,
  withActor,
  type NewPatientLink,
} from '@clinic-mx/db';
import { and, eq } from 'drizzle-orm';

// Patient links for end to end tests (IAM-09), made from the test runner the way the service
// makes them: a patient_link row, then its id signed with PATIENT_LINK_SECRET. Patient,
// appointment and episode ids are generated (rule 12: no real patient data).

const tests = systemActor('tests');
let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};
const secret = () => {
  const value = process.env.PATIENT_LINK_SECRET;
  if (!value) throw new Error('PATIENT_LINK_SECRET is not set for the end to end tests.');
  return value;
};

export interface TestLink {
  id: string;
  patientId: string;
  path: string;
  expiresAt: Date;
}

/** A link for a generated patient, valid for an hour unless `expiresAt` says otherwise. */
export async function testLink(
  values: Partial<NewPatientLink> & Pick<NewPatientLink, 'purpose'>,
): Promise<TestLink> {
  const subject =
    values.purpose === 'health_form'
      ? { appointmentId: crypto.randomUUID() }
      : { episodeId: crypto.randomUUID() };
  const link = {
    patientId: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000),
    ...subject,
    ...values,
  };
  const row = await withActor(db(), tests, (tx) => insertPatientLink(tx, link));
  const token = signPatientLink(
    { linkId: row.id, purpose: link.purpose, expiresAt: row.expiresAt },
    secret(),
  );
  return { id: row.id, patientId: link.patientId, path: `/p/${token}`, expiresAt: row.expiresAt };
}

/** A link that ended a minute ago (made two hours ago, so the row's own check holds). */
export async function expiredLink(purpose: NewPatientLink['purpose']): Promise<TestLink> {
  const link = await testLink({ purpose });
  const ended = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
  await withActor(db(), tests, (tx) =>
    tx
      .update(patientLink)
      .set({ createdAt: new Date(Date.now() - 7_200_000), expiresAt: ended })
      .where(eq(patientLink.id, link.id)),
  );
  const token = signPatientLink({ linkId: link.id, purpose, expiresAt: ended }, secret());
  return { ...link, path: `/p/${token}`, expiresAt: ended };
}

/** A new My plan link for the same patient, stopping the older ones, as WhatsApp reissues it. */
export async function reissuedMyPlan(patientId: string): Promise<TestLink> {
  const link = await testLink({ purpose: 'my_plan', patientId });
  await withActor(db(), tests, (tx) => revokeMyPlanLinks(tx, patientId, link.id));
  return link;
}

/** Marks a single use link submitted, as a form does. */
export async function submitLink(id: string): Promise<void> {
  await withActor(db(), tests, (tx) => completePatientLinkRow(tx, id));
}

/** How many times the patient opened the link, from the audit trail. */
export async function linkViews(link: TestLink): Promise<number> {
  const rows = await db()
    .select({ id: auditEvent.id })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.action, 'view'),
        eq(auditEvent.entity, 'patient_link'),
        eq(auditEvent.entityId, link.id),
        eq(auditEvent.actor, `patient:${link.patientId}`),
      ),
    );
  return rows.length;
}
