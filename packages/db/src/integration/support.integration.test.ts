import { and, eq, gt, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimsForStaff, withStaffAccess } from '../access';
import { recordAccessEvent, setAuditContext, staffActor, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  currentStaffClaims,
  staffForSignIn,
  supportLoginWithoutGrant,
  type StaffMember,
} from '../identity';
import { auditEvent, centre, setting, staffUser, staffUserCentre, supportGrant } from '../schema';
import { seedCentres, seedStaff, seedStaffCentres } from '../seed/data';
import { endStaffSessions } from '../staff';
import {
  activeGrant,
  endSupportGrant,
  endSupportSessions,
  insertSupportGrant,
  logSupportRequest,
  supportGrantHistory,
  supportLogins,
} from '../support';

// IAM-08 done when: time limited grant by Super Admin; every action under it logged. A Velyx
// support login has a claim only while a grant is active, and is read only twice over: its
// transactions are read only, and restrictive policies refuse its writes. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
const tests = systemActor('tests');

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
const support = member('support.velyx@clinicmx.test');

type Transaction = Parameters<Parameters<typeof withStaffAccess>[2]>[0];

/**
 * As the support login under row level security, but without the read only transaction, so the
 * restrictive policies are tested on their own.
 */
const asSupportClaimsOnly = <R>(work: (tx: Transaction) => Promise<R>) =>
  db.transaction(async (tx) => {
    await setAuditContext(tx, { actor: staffActor(support.id) });
    const claims = JSON.stringify({ role: 'authenticated', clinic: claimsForStaff(support) });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return work(tx);
  });

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

const READ_ONLY = '25006';
const REFUSED = '42501';

async function endEveryGrant() {
  await withActor(db, tests, (tx) =>
    tx
      .update(supportGrant)
      .set({ endsAt: sql`now()` })
      .where(and(sql`${supportGrant.startsAt} < now()`, gt(supportGrant.endsAt, sql`now()`))),
  );
}

async function grant(hours = 1) {
  return withStaffAccess(db, { actor: superAdmin }, (tx) =>
    insertSupportGrant(tx, { grantedBy: superAdmin.id, hours, reason: 'Integration test' }),
  );
}

// The support login needs a Supabase Auth link for its claims; one is made when there is none.
let supportLogin = '';
let madeLink = false;
beforeAll(async () => {
  await endEveryGrant();
  const [row] = await db
    .select({ authUserId: staffUser.authUserId })
    .from(staffUser)
    .where(eq(staffUser.id, support.id));
  supportLogin = row?.authUserId ?? crypto.randomUUID();
  if (!row?.authUserId) {
    madeLink = true;
    await withActor(db, tests, (tx) =>
      tx.update(staffUser).set({ authUserId: supportLogin }).where(eq(staffUser.id, support.id)),
    );
  }
});
afterAll(async () => {
  await endEveryGrant();
  if (madeLink) {
    await withActor(db, tests, (tx) =>
      tx.update(staffUser).set({ authUserId: null }).where(eq(staffUser.id, support.id)),
    );
  }
  await close();
});

describe('a Velyx support login', () => {
  it('has no claim and cannot sign in while support access is off', async () => {
    expect(await currentStaffClaims(db, supportLogin)).toBeNull();
    expect(await staffForSignIn(db, supportLogin)).toBeUndefined();
    expect(await supportLoginWithoutGrant(db, supportLogin)).toBe(true);
  });

  it('signs in, as read only Velyx support, while a grant is active, and not after', async () => {
    const { id } = await grant();
    try {
      expect(await currentStaffClaims(db, supportLogin)).toEqual(claimsForStaff(support));
      expect(claimsForStaff(support).support).toBe(true);
      expect(await staffForSignIn(db, supportLogin)).toMatchObject({
        id: support.id,
        role: 'super_admin',
        treatsPatients: false,
        support: true,
      });
      expect(await supportLoginWithoutGrant(db, supportLogin)).toBe(false);
    } finally {
      await withStaffAccess(db, { actor: superAdmin }, (tx) => endSupportGrant(tx, id));
    }
    expect(await currentStaffClaims(db, supportLogin)).toBeNull();
    expect(await staffForSignIn(db, supportLogin)).toBeUndefined();
  });

  it('is listed among the support logins, and other staff are not', async () => {
    const logins = await withStaffAccess(db, { actor: superAdmin }, (tx) => supportLogins(tx));
    expect(logins.map((login) => login.id)).toContain(support.id);
    expect(logins.map((login) => login.id)).not.toContain(superAdmin.id);
  });

  it('must be a Super Admin without ticks', async () => {
    expect(
      await failure(
        withActor(db, tests, (tx) =>
          tx.update(staffUser).set({ role: 'finance' }).where(eq(staffUser.id, support.id)),
        ),
      ),
    ).toBe('23514');
  });
});

describe('grants', () => {
  it('are made and ended by the Super Admin, audited as them', async () => {
    const made = await grant(2);
    const active = await withStaffAccess(db, { actor: superAdmin }, (tx) => activeGrant(tx));
    expect(active).toMatchObject({ id: made.id, reason: 'Integration test' });
    expect(active?.grantedByName).toBe('Test Super Admin');
    const hours = (made.endsAt.getTime() - (active?.startsAt.getTime() ?? 0)) / 3_600_000;
    expect(hours).toBeCloseTo(2, 5);

    expect(
      await withStaffAccess(db, { actor: superAdmin }, (tx) => endSupportGrant(tx, made.id)),
    ).toBe(true);
    // Ending twice changes nothing.
    expect(
      await withStaffAccess(db, { actor: superAdmin }, (tx) => endSupportGrant(tx, made.id)),
    ).toBe(false);
    expect(await withStaffAccess(db, { actor: superAdmin }, (tx) => activeGrant(tx))).toBe(
      undefined,
    );

    const events = await db
      .select({ action: auditEvent.action, actor: auditEvent.actor })
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'support_grant'), eq(auditEvent.entityId, made.id)))
      .orderBy(auditEvent.id);
    expect(events).toEqual([
      { action: 'insert', actor: staffActor(superAdmin.id) },
      { action: 'update', actor: staffActor(superAdmin.id) },
    ]);
  });

  it('are refused to every other role, and in someone else’s name, by the database', async () => {
    expect(
      await failure(
        withStaffAccess(db, { actor: manager }, (tx) =>
          insertSupportGrant(tx, { grantedBy: manager.id, hours: 1, reason: 'x' }),
        ),
      ),
    ).toBe(REFUSED);
    expect(
      await failure(
        withStaffAccess(db, { actor: superAdmin }, (tx) =>
          insertSupportGrant(tx, { grantedBy: manager.id, hours: 1, reason: 'x' }),
        ),
      ),
    ).toBe(REFUSED);
  });

  it('keep what support asked for under them, for the Super Admin to read', async () => {
    const made = await grant();
    try {
      for (const path of ['/app/staff', '/app/support-access']) {
        await logSupportRequest(db, {
          actor: staffActor(support.id),
          grantId: made.id,
          path,
          kind: path === '/app/staff' ? 'page' : 'action',
        });
      }
      const [latest] = await withStaffAccess(db, { actor: superAdmin }, (tx) =>
        supportGrantHistory(tx, { grants: 1 }),
      );
      expect(latest?.id).toBe(made.id);
      expect(
        latest?.activity.map(({ staffName, path, kind }) => ({ staffName, path, kind })),
      ).toEqual([
        { staffName: 'Test Velyx Support', path: '/app/support-access', kind: 'action' },
        { staffName: 'Test Velyx Support', path: '/app/staff', kind: 'page' },
      ]);
    } finally {
      await withStaffAccess(db, { actor: superAdmin }, (tx) => endSupportGrant(tx, made.id));
    }
  });
});

describe('read only, twice over', () => {
  let grantId = '';
  beforeAll(async () => {
    grantId = (await grant()).id;
  });
  afterAll(async () => {
    await withStaffAccess(db, { actor: superAdmin }, (tx) => endSupportGrant(tx, grantId));
  });

  it('reads what the Super Admin reads', async () => {
    const [staff, settings, grants] = await withStaffAccess(db, { actor: support }, (tx) =>
      Promise.all([
        tx.select({ id: staffUser.id }).from(staffUser),
        tx.select({ key: setting.key }).from(setting),
        tx.select({ id: supportGrant.id }).from(supportGrant),
      ]),
    );
    expect(staff.map((s) => s.id)).toEqual(expect.arrayContaining([superAdmin.id, manager.id]));
    expect(settings.length).toBeGreaterThan(10);
    expect(grants.map((g) => g.id)).toContain(grantId);
  });

  it('its transaction is read only: Postgres refuses every write', async () => {
    const asSupport = <R>(work: (tx: Transaction) => Promise<R>) =>
      failure(withStaffAccess(db, { actor: support }, work));
    expect(
      await asSupport((tx) =>
        insertSupportGrant(tx, { grantedBy: support.id, hours: 1, reason: 'x' }),
      ),
    ).toBe(READ_ONLY);
    expect(
      await asSupport((tx) =>
        tx.update(staffUser).set({ name: 'Changed' }).where(eq(staffUser.id, manager.id)),
      ),
    ).toBe(READ_ONLY);
    expect(
      await asSupport((tx) => tx.update(setting).set({ value: 1 }).where(eq(setting.key, 'x'))),
    ).toBe(READ_ONLY);
    // The SECURITY DEFINER writers refuse the support claim before they would write.
    expect([READ_ONLY, REFUSED]).toContain(
      await asSupport((tx) => endStaffSessions(tx, manager.id)),
    );
    expect([READ_ONLY, REFUSED]).toContain(
      await asSupport((tx) =>
        recordAccessEvent(tx, { action: 'two_step_reset', staffUserId: manager.id }),
      ),
    );
  });

  it('restrictive policies refuse its writes even outside a read only transaction', async () => {
    expect(
      await failure(
        asSupportClaimsOnly((tx) =>
          insertSupportGrant(tx, { grantedBy: support.id, hours: 1, reason: 'x' }),
        ),
      ),
    ).toBe(REFUSED);
    expect(
      await failure(
        asSupportClaimsOnly((tx) =>
          tx.insert(centre).values({
            name: 'Support test centre',
            code: 'ST',
            appointmentPrefix: 'ST',
            colour: seedCentres[0]?.colour ?? '',
          }),
        ),
      ),
    ).toBe(REFUSED);
    // Updates and deletes find no row they may touch.
    const changed = await asSupportClaimsOnly(async (tx) => ({
      staff: await tx
        .update(staffUser)
        .set({ name: 'Changed' })
        .where(eq(staffUser.id, manager.id))
        .returning({ id: staffUser.id }),
      settings: await tx
        .update(setting)
        .set({ value: sql`${setting.value}` })
        .returning({ key: setting.key }),
      assignments: await tx
        .delete(staffUserCentre)
        .where(eq(staffUserCentre.staffUserId, manager.id))
        .returning({ id: staffUserCentre.staffUserId }),
      grants: await tx
        .update(supportGrant)
        .set({ endsAt: sql`now()` })
        .where(eq(supportGrant.id, grantId))
        .returning({ id: supportGrant.id }),
    }));
    expect(changed).toEqual({ staff: [], settings: [], assignments: [], grants: [] });
  });

  it('the SECURITY DEFINER writers refuse its claim', async () => {
    expect(await failure(asSupportClaimsOnly((tx) => endStaffSessions(tx, manager.id)))).toBe(
      REFUSED,
    );
    expect(await failure(asSupportClaimsOnly((tx) => endSupportSessions(tx)))).toBe(REFUSED);
    expect(
      await failure(
        asSupportClaimsOnly((tx) =>
          recordAccessEvent(tx, { action: 'two_step_reset', staffUserId: manager.id }),
        ),
      ),
    ).toBe(REFUSED);
  });

  it('only the Super Admin ends support sessions', async () => {
    expect(
      await withStaffAccess(db, { actor: superAdmin }, (tx) => endSupportSessions(tx)),
    ).toBeGreaterThanOrEqual(0);
    expect(
      await failure(withStaffAccess(db, { actor: manager }, (tx) => endSupportSessions(tx))),
    ).toBe(REFUSED);
  });
});
