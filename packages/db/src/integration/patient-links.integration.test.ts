import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  completePatientLinkRow,
  findPatientLink,
  insertPatientLink,
  revokeMyPlanLinks,
  withPatientAccess,
  type PatientLinkAccess,
} from '../patient-links';
import { auditEvent, patientLink } from '../schema';
import { seedStaff } from '../seed/data';

// IAM-09: patient links in the database. The subject rules hold, every change is audited, and a
// patient page under row level security sees only its own link. CI database only. Links made
// here stay; patient ids are generated for each run.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);
const whatsapp = systemActor('whatsapp');

const inAnHour = () => new Date(Date.now() + 3_600_000);
const issue = (values: Partial<Parameters<typeof insertPatientLink>[1]> = {}) =>
  withActor(db, whatsapp, (tx) =>
    insertPatientLink(tx, {
      patientId: crypto.randomUUID(),
      purpose: 'my_plan',
      episodeId: crypto.randomUUID(),
      expiresAt: inAnHour(),
      ...values,
    }),
  );
const access = async (id: string): Promise<PatientLinkAccess> => {
  const row = await findPatientLink(db, id);
  if (!row) throw new Error('link not found');
  return { id: row.id, patientId: row.patientId, purpose: row.purpose };
};

/** The Postgres error code a query failed with. */
async function failure(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

describe('patient links', () => {
  it('are tied to exactly one appointment or episode, the right one for the purpose', async () => {
    const appointmentId = crypto.randomUUID();
    const episodeId = crypto.randomUUID();
    expect(await failure(issue({ purpose: 'health_form', appointmentId: undefined }))).toBe(
      '23514',
    );
    expect(await failure(issue({ purpose: 'health_form', episodeId: undefined }))).toBe('23514');
    expect(await failure(issue({ purpose: 'consent', appointmentId, episodeId }))).toBe('23514');
    expect(await failure(issue({ purpose: 'my_plan', appointmentId, episodeId: undefined }))).toBe(
      '23514',
    );
    await issue({ purpose: 'health_form', appointmentId, episodeId: undefined });
    await issue({ purpose: 'consent', appointmentId, episodeId: undefined });
    await issue({ purpose: 'feedback', episodeId });
  });

  it('keep the expiry to the second, as the token carries it', async () => {
    const { expiresAt } = await issue({ expiresAt: new Date('2030-01-01T10:00:00.987Z') });
    expect(expiresAt).toEqual(new Date('2030-01-01T10:00:00.000Z'));
  });

  it('are audited when issued and when stopped', async () => {
    const patientId = crypto.randomUUID();
    const older = await issue({ patientId });
    const newer = await issue({ patientId });
    expect(await withActor(db, whatsapp, (tx) => revokeMyPlanLinks(tx, patientId, newer.id))).toBe(
      1,
    );
    expect((await findPatientLink(db, older.id))?.revokedAt).toBeInstanceOf(Date);
    expect((await findPatientLink(db, newer.id))?.revokedAt).toBeNull();
    const events = await db
      .select({ action: auditEvent.action, actor: auditEvent.actor })
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'patient_link'), eq(auditEvent.entityId, older.id)))
      .orderBy(auditEvent.id);
    expect(events).toEqual([
      { action: 'insert', actor: whatsapp },
      { action: 'update', actor: whatsapp },
    ]);
  });

  it('accept one submission when single use', async () => {
    const link = await issue({ purpose: 'feedback' });
    expect(await withActor(db, whatsapp, (tx) => completePatientLinkRow(tx, link.id))).toBe(true);
    expect(await withActor(db, whatsapp, (tx) => completePatientLinkRow(tx, link.id))).toBe(false);
  });
});

describe('a patient page under row level security', () => {
  it('sees its own link and no other', async () => {
    const mine = await issue();
    const theirs = await issue();
    const seen = await withPatientAccess(db, { link: await access(mine.id) }, (tx) =>
      tx.select({ id: patientLink.id }).from(patientLink),
    );
    expect(seen).toEqual([{ id: mine.id }]);
    expect(seen.map((r) => r.id)).not.toContain(theirs.id);
  });

  it('changes nothing: no insert, update or delete', async () => {
    const mine = await issue();
    const link = await access(mine.id);
    const asPatient = <R>(work: Parameters<typeof withPatientAccess<R>>[2]) =>
      failure(withPatientAccess(db, { link }, work));
    expect(
      await asPatient((tx) =>
        tx
          .update(patientLink)
          .set({ revokedAt: sql`now()` })
          .where(eq(patientLink.id, mine.id)),
      ),
    ).toBe('42501');
    expect(await asPatient((tx) => tx.delete(patientLink).where(eq(patientLink.id, mine.id)))).toBe(
      '42501',
    );
    expect(
      await asPatient((tx) =>
        insertPatientLink(tx, {
          patientId: link.patientId,
          purpose: 'my_plan',
          episodeId: crypto.randomUUID(),
          expiresAt: inAnHour(),
        }),
      ),
    ).toBe('42501');
  });

  it('runs as the clinic_patient role with the patient as the audit actor', async () => {
    const mine = await issue();
    const link = await access(mine.id);
    const [row] = await withPatientAccess(db, { link }, (tx) =>
      tx.execute<{ role: string; actor: string }>(
        sql`select current_user as role, current_setting('audit.actor', true) as actor`,
      ),
    );
    expect(row).toEqual({ role: 'clinic_patient', actor: `patient:${link.patientId}` });
  });

  it('is the only way to read links: signed in staff see none', async () => {
    await issue();
    const seed = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test');
    if (!seed?.id) throw new Error('seed Super Admin missing');
    const superAdmin: StaffMember = {
      id: seed.id,
      email: seed.email,
      name: seed.name,
      role: seed.role,
      treatsPatients: seed.treatsPatients ?? false,
      consultant: seed.consultant ?? false,
      centreIds: [],
      support: false,
    };
    const seen = await withStaffAccess(db, { actor: superAdmin }, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(patientLink),
    );
    expect(seen[0]?.n).toBe(0);
  });
});
