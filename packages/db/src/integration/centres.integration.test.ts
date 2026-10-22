import { and, eq, sql } from 'drizzle-orm';
import type { CentreColour } from '@clinic-mx/schemas';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import {
  activeCentreWithColour,
  centreNameTaken,
  insertCentre,
  setCentreActive,
  updateCentre,
} from '../centres';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { auditEvent, centre } from '../schema';
import { centreIds, seedCentres, seedStaff, seedStaffCentres } from '../seed/data';

// SET-01: centres in the database. Each chart colour belongs to one active centre; only the
// Super Admin adds or changes centres, under row level security; every change is audited. Every
// test runs in a transaction that is rolled back, so the seed centres never change. CI only.
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
const manager = member('manager@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/**
 * Runs `work` as a staff member under RLS (withStaffAccess, as the app does), in a transaction
 * that is always rolled back.
 */
async function rolledBack(actor: StaffMember, work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withStaffAccess(db, { actor }, async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The Postgres error code a statement failed with, inside a savepoint. */
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const teal = seedCentres[2]?.colour ?? '';
const details = (name: string, colour: string) => ({
  colour: colour as CentreColour,
  name,
  address: '100 Feet Rd, Indiranagar, Bengaluru 560038',
  phone: '+918041234567',
  mapLink: 'https://maps.app.goo.gl/abc123',
});

describe('centres', () => {
  it('give each colour to one active centre; deactivating frees it', async () => {
    await rolledBack(superAdmin, async (tx) => {
      expect(await failure(tx, (sp) => insertCentre(sp, details('Indiranagar', teal)))).toBe(
        '23505',
      );
      expect((await activeCentreWithColour(tx, teal))?.name).toBe('Whitefield');
      expect(await setCentreActive(tx, centreIds.whitefield, false)).toBe(true);
      expect(await setCentreActive(tx, centreIds.whitefield, false)).toBe(false);
      const id = await insertCentre(tx, details('Indiranagar', teal));
      // Whitefield cannot come back while teal is taken.
      expect(await failure(tx, (sp) => setCentreActive(sp, centreIds.whitefield, true))).toBe(
        '23505',
      );
      expect(await setCentreActive(tx, id, false)).toBe(true);
      expect(await setCentreActive(tx, centreIds.whitefield, true)).toBe(true);
    });
  });

  it('are changed by the Super Admin, and every change is audited', async () => {
    await rolledBack(superAdmin, async (tx) => {
      expect(
        await updateCentre(tx, centreIds.hsrLayout, {
          ...details('HSR Layout', seedCentres[0]?.colour ?? ''),
          address: 'Changed for a test',
        }),
      ).toBe(true);
      const [event] = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'centre'), eq(auditEvent.entityId, centreIds.hsrLayout)))
        .orderBy(sql`${auditEvent.id} desc`)
        .limit(1);
      expect(event).toEqual({ actor: `staff:${superAdmin.id}`, action: 'update' });
      expect(await centreNameTaken(tx, 'hsr layout')).toBe(true);
      expect(await centreNameTaken(tx, 'hsr layout', centreIds.hsrLayout)).toBe(false);
    });
  });

  it('are not changed or added by anyone else', async () => {
    await rolledBack(manager, async (tx) => {
      // Row level security hides the update (no row matches) and refuses the insert.
      expect(
        await updateCentre(
          tx,
          centreIds.hsrLayout,
          details('HSR Layout', seedCentres[0]?.colour ?? ''),
        ),
      ).toBe(false);
      expect(await failure(tx, (sp) => setCentreActive(sp, centreIds.hsrLayout, false))).toBe(
        undefined,
      );
      const [row] = await tx
        .select({ active: centre.active })
        .from(centre)
        .where(eq(centre.id, centreIds.hsrLayout));
      expect(row?.active).toBe(true);
      expect(await failure(tx, (sp) => insertCentre(sp, details('Indiranagar', teal)))).toBe(
        '42501',
      );
    });
  });
});
