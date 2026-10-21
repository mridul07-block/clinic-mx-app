import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  clearKioskLink,
  findKioskByToken,
  hashKioskToken,
  insertKioskDevice,
  kioskDevices,
  newKioskToken,
  patientLinkState,
  sendLinkToKiosk,
  stopKioskDevice,
} from '../kiosk';
import { completePatientLinkRow, insertPatientLink } from '../patient-links';
import { auditEvent, kioskDevice } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';

// IAM-10: clinic tablets in the database. Only a token's hash is kept; every change is audited;
// staff with check in rights see and change only their centres' tablets; a reset takes off only
// the form still on the tablet. CI database only. Tablets and links made here stay.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}

const superAdmin = member('super.admin@clinicmx.test');
const finance = member('finance@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

const as = <R>(actor: StaffMember, work: Parameters<typeof withStaffAccess<R>>[2]) =>
  withStaffAccess(db, { actor }, work);

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

const setUp = async (actor = deskHsr, centreId: string = centreIds.hsrLayout) => {
  const token = newKioskToken();
  const { id } = await as(actor, (tx) =>
    insertKioskDevice(tx, {
      centreId,
      name: 'Front desk tablet',
      createdBy: actor.id,
      tokenHash: hashKioskToken(token),
    }),
  );
  return { id, token };
};
const healthForm = () =>
  withActor(db, systemActor('tests'), (tx) =>
    insertPatientLink(tx, {
      patientId: crypto.randomUUID(),
      purpose: 'health_form',
      appointmentId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
  );

describe('kiosk tablets', () => {
  it('keep only the hash of the tablet token and find the tablet by it', async () => {
    const { id, token } = await setUp();
    const [row] = await db.select().from(kioskDevice).where(eq(kioskDevice.id, id));
    expect(row?.tokenHash).toBe(hashKioskToken(token));
    expect(row?.tokenHash).not.toContain(token);
    expect((await findKioskByToken(db, token))?.centreName).toBe('HSR Layout');
    expect(await findKioskByToken(db, newKioskToken())).toBeUndefined();
  });

  it('audit set up, send, reset and stop, with the tablet as the actor of its reset', async () => {
    const { id } = await setUp();
    const link = await healthForm();
    expect(await as(deskHsr, (tx) => sendLinkToKiosk(tx, id, link.id))).toBe(true);
    expect(
      await withActor(db, systemActor(`kiosk.${id}`), (tx) => clearKioskLink(tx, id, link.id)),
    ).toBe(true);
    expect(await as(deskHsr, (tx) => stopKioskDevice(tx, id, deskHsr.id))).toBe(true);
    expect(await as(deskHsr, (tx) => stopKioskDevice(tx, id, deskHsr.id))).toBe(false);
    const events = await db
      .select({ action: auditEvent.action, actor: auditEvent.actor })
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'kiosk_device'), eq(auditEvent.entityId, id)))
      .orderBy(auditEvent.id);
    expect(events).toEqual([
      { action: 'insert', actor: `staff:${deskHsr.id}` },
      { action: 'update', actor: `staff:${deskHsr.id}` },
      { action: 'update', actor: `system:kiosk.${id}` },
      { action: 'update', actor: `staff:${deskHsr.id}` },
    ]);
  });

  it('take off only the form still on the tablet when it resets', async () => {
    const { id } = await setUp();
    const first = await healthForm();
    const second = await healthForm();
    await as(deskHsr, (tx) => sendLinkToKiosk(tx, id, first.id));
    await as(deskHsr, (tx) => sendLinkToKiosk(tx, id, second.id));
    const reset = (linkId: string) =>
      withActor(db, systemActor(`kiosk.${id}`), (tx) => clearKioskLink(tx, id, linkId));
    expect(await reset(first.id)).toBe(false);
    const [row] = await db.select().from(kioskDevice).where(eq(kioskDevice.id, id));
    expect(row?.currentLinkId).toBe(second.id);
    expect(await reset(second.id)).toBe(true);
  });

  it('take no form once stopped, and a stopped tablet holds none', async () => {
    const { id } = await setUp();
    const shown = await healthForm();
    await as(deskHsr, (tx) => sendLinkToKiosk(tx, id, shown.id));
    await as(deskHsr, (tx) => stopKioskDevice(tx, id, deskHsr.id));
    const [row] = await db.select().from(kioskDevice).where(eq(kioskDevice.id, id));
    expect(row?.currentLinkId).toBeNull();
    const later = await healthForm();
    expect(await as(deskHsr, (tx) => sendLinkToKiosk(tx, id, later.id))).toBe(false);
  });

  it('are seen and changed only by check in rights in their centres', async () => {
    const hsr = await setUp(deskHsr, centreIds.hsrLayout);
    const koramangala = await setUp(deskKoramangala, centreIds.koramangala);
    const seen = async (actor: StaffMember) =>
      (await as(actor, (tx) => kioskDevices(tx)))
        .map((d) => d.id)
        .filter((id) => id === hsr.id || id === koramangala.id)
        .sort();
    expect(await seen(deskHsr)).toEqual([hsr.id]);
    expect(await seen(deskKoramangala)).toEqual([koramangala.id]);
    expect(await seen(superAdmin)).toEqual([hsr.id, koramangala.id].sort());
    expect(await seen(physioHsr)).toEqual([]);
    expect(await seen(finance)).toEqual([]);

    // Another centre's tablet: not seen, so nothing changes; setting one up there is refused.
    expect(await as(deskHsr, (tx) => stopKioskDevice(tx, koramangala.id, deskHsr.id))).toBe(false);
    expect(await failure(setUp(deskHsr, centreIds.koramangala))).toBe('42501');
    expect(await failure(setUp(physioHsr, centreIds.hsrLayout))).toBe('42501');
    // Nobody records a tablet as set up by someone else.
    expect(
      await failure(
        as(deskHsr, (tx) =>
          insertKioskDevice(tx, {
            centreId: centreIds.hsrLayout,
            name: 'Tablet',
            createdBy: superAdmin.id,
            tokenHash: hashKioskToken(newKioskToken()),
          }),
        ),
      ),
    ).toBe('42501');
  });

  it('are read only to Velyx support', async () => {
    const { id } = await setUp();
    expect(['25006', '42501']).toContain(
      await failure(as(support, (tx) => stopKioskDevice(tx, id, support.id))),
    );
    const [row] = await db
      .select({ stoppedAt: kioskDevice.stoppedAt })
      .from(kioskDevice)
      .where(inArray(kioskDevice.id, [id]));
    expect(row?.stoppedAt).toBeNull();
  });

  it('learn a link’s purpose and state, never who it is for, with check in rights only', async () => {
    const link = await healthForm();
    expect(await as(deskHsr, (tx) => patientLinkState(tx, link.id))).toEqual({
      purpose: 'health_form',
      state: 'active',
    });
    await withActor(db, systemActor('tests'), (tx) => completePatientLinkRow(tx, link.id));
    expect(await as(deskHsr, (tx) => patientLinkState(tx, link.id))).toEqual({
      purpose: 'health_form',
      state: 'used',
    });
    expect(await as(physioHsr, (tx) => patientLinkState(tx, link.id))).toBeUndefined();
    expect(await as(deskHsr, (tx) => patientLinkState(tx, crypto.randomUUID()))).toBeUndefined();
  });
});
