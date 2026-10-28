import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { claimsForStaff } from '../access';
import { aiSheetGate } from '../ai-gate';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { KB_IMPORT_ACTOR } from '../knowledge/apply';
import { latestKnowledgeVersion } from '../knowledge';
import { auditEvent, kbVersion, setting } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';

// AI-09 done when: the AI sheet is switched on only after the blind test passes and the legal
// check clears. Here, against the CI database (each case rolled back): the Super Admin switches
// it on with both records, audited; nobody else can; the row itself refuses "on" without them;
// and the gate is on only for the knowledge base version it was switched on for.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
const desk = member('desk.hsr@clinicmx.test');
const finance = member('finance@clinicmx.test');
const physio = member('physio.hsr@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

class Rollback extends Error {}
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** Becomes a signed in staff member inside the transaction (their claims and role). */
async function becomes(tx: Tx, actor: StaffMember) {
  await tx.execute(sql`reset role`);
  const claims = JSON.stringify({ role: 'authenticated', clinic: claimsForStaff(actor) });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`select set_config('audit.actor', ${`staff:${actor.id}`}, true)`);
  await tx.execute(sql`set local role authenticated`);
}

/** The Postgres error code a statement failed with, inside a savepoint; undefined if none. */
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

const records = {
  blindTest: { date: '2026-10-20', reference: 'Blind test report v1' },
  legalCheck: { date: '2026-10-21', reference: 'Opinion 12/2026' },
};

async function live(tx: Tx) {
  const version = await latestKnowledgeVersion(tx);
  if (!version) throw new Error('The knowledge base is not imported.');
  return version;
}

const switchOn = (tx: Tx, version: { id: string; number: number }) =>
  tx
    .update(setting)
    .set({
      value: {
        on: true,
        ...records,
        since: new Date().toISOString(),
        kbVersionId: version.id,
        kbVersionNumber: version.number,
      },
      updatedBy: `staff:${superAdmin.id}`,
    })
    .where(eq(setting.key, 'ai.preparation_sheet'))
    .returning({ key: setting.key });

describe('the AI preparation sheet gate', () => {
  it('starts off', async () => {
    const [row] = await db
      .select({ value: setting.value })
      .from(setting)
      .where(eq(setting.key, 'ai.preparation_sheet'));
    expect(row?.value).toEqual({ on: false });
    expect((await aiSheetGate(db)).state).toEqual({ on: false, reason: 'off' });
  });

  it('is switched on by the Super Admin with both records, audited, for the live version', async () => {
    await rolledBack(async (tx) => {
      const version = await live(tx);
      await becomes(tx, superAdmin);
      expect(await switchOn(tx, version)).toHaveLength(1);
      await tx.execute(sql`reset role`);
      expect((await aiSheetGate(tx)).state).toEqual({
        on: true,
        kbVersionId: version.id,
        kbVersionNumber: version.number,
      });
      const [event] = await tx
        .select({ before: auditEvent.before, after: auditEvent.after })
        .from(auditEvent)
        .where(
          and(eq(auditEvent.entity, 'setting'), eq(auditEvent.actor, `staff:${superAdmin.id}`)),
        )
        .orderBy(sql`${auditEvent.id} desc`)
        .limit(1);
      expect(event?.before).toMatchObject({ value: { on: false } });
      expect(event?.after).toMatchObject({ value: { on: true, ...records } });

      // A newer knowledge base version goes live: off until a new blind test is recorded.
      await tx.insert(kbVersion).values({
        number: version.number + 1,
        source: { files: [{ name: 'test.xlsx', sha256: 'test' }] },
        report: {},
        createdBy: KB_IMPORT_ACTOR,
      });
      expect((await aiSheetGate(tx)).state).toEqual({
        on: false,
        reason: 'knowledge_base_changed',
        switchedOnFor: version.number,
      });
    });
  });

  it('cannot be switched by anyone but the Super Admin', async () => {
    await rolledBack(async (tx) => {
      const version = await live(tx);
      for (const someone of [manager, physio, desk, finance]) {
        await becomes(tx, someone);
        expect(await switchOn(tx, version), someone.email).toEqual([]);
      }
      // Velyx support is read only.
      expect(
        await failure(tx, async (sp) => {
          await becomes(sp, support);
          await sp.execute(sql`set local transaction_read_only = on`);
          await switchOn(sp, version);
        }),
      ).toBe('25006');
      await tx.execute(sql`reset role`);
      expect((await aiSheetGate(tx)).state).toEqual({ on: false, reason: 'off' });
    });
  });

  it('refuses "on" without both records, even from the owner', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`select set_config('audit.actor', 'system:tests', true)`);
      const update = (value: unknown) => (sp: Tx) =>
        sp.update(setting).set({ value }).where(eq(setting.key, 'ai.preparation_sheet'));
      const version = await live(tx);
      const kb = { kbVersionId: version.id, kbVersionNumber: version.number };
      expect(await failure(tx, update({ on: true }))).toBe('23514');
      expect(await failure(tx, update({ on: true, blindTest: records.blindTest, ...kb }))).toBe(
        '23514',
      );
      expect(
        await failure(
          tx,
          update({
            on: true,
            ...records,
            legalCheck: { date: '2026-10-21', reference: ' ' },
            ...kb,
          }),
        ),
      ).toBe('23514');
      expect(await failure(tx, update({ on: true, ...records }))).toBe('23514');
      expect(await failure(tx, update({ on: 'yes' }))).toBe('23514');
      expect(await failure(tx, update({ on: false }))).toBeUndefined();
    });
  });
});
