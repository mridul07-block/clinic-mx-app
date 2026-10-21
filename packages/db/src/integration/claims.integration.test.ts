import { eq, sql } from 'drizzle-orm';
import { seesAllCentres, staffRoles } from '@clinic-mx/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { currentStaffClaims } from '../identity';
import { staffUser } from '../schema';
import { centreIds, seedStaff } from '../seed/data';

// IAM-03: role, ticks and centres in every token, from internal.staff_claims through the custom
// access token hook, and the readers row level security will use. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
const tests = systemActor('tests');

const byEmail = (email: string) => {
  const member = seedStaff.find((s) => s.email === email);
  if (!member?.id) throw new Error(`seed has no ${email}`);
  return member.id;
};
const physio = byEmail('physio.whitefield@clinicmx.test');
const finance = byEmail('finance@clinicmx.test');
const login = { [physio]: crypto.randomUUID(), [finance]: crypto.randomUUID() };
const loginOf = (staffUserId: string) => login[staffUserId] ?? '';

const setStaff = (staffUserId: string, values: Partial<typeof staffUser.$inferInsert>) =>
  withActor(db, tests, (tx) =>
    tx.update(staffUser).set(values).where(eq(staffUser.id, staffUserId)),
  );

const original = new Map<string, typeof staffUser.$inferSelect>();
beforeAll(async () => {
  for (const id of [physio, finance]) {
    const [row] = await db.select().from(staffUser).where(eq(staffUser.id, id));
    if (!row) throw new Error('seed staff row missing');
    original.set(id, row);
    await setStaff(id, { authUserId: loginOf(id) });
  }
});
afterAll(async () => {
  for (const [id, row] of original) {
    await setStaff(id, {
      authUserId: row.authUserId,
      active: row.active,
      accessEndsAt: row.accessEndsAt,
    });
  }
  await close();
});

describe('staff claims', () => {
  it('carry role, ticks and assigned centres', async () => {
    expect(await currentStaffClaims(db, loginOf(physio))).toEqual({
      staff_id: physio,
      role: 'physiotherapist',
      treats_patients: true,
      consultant: true,
      all_centres: false,
      centres: [centreIds.whitefield],
    });
  });

  it('give Super Admin and Finance every centre by role', async () => {
    expect(await currentStaffClaims(db, loginOf(finance))).toMatchObject({
      role: 'finance',
      all_centres: true,
      centres: [],
    });
  });

  it('are null for a deactivated member, an ended one, or a login with no staff member', async () => {
    await setStaff(physio, { active: false });
    expect(await currentStaffClaims(db, loginOf(physio))).toBeNull();
    await setStaff(physio, { active: true, accessEndsAt: new Date(Date.now() - 1000) });
    expect(await currentStaffClaims(db, loginOf(physio))).toBeNull();
    await setStaff(physio, { accessEndsAt: null });
    expect(await currentStaffClaims(db, crypto.randomUUID())).toBeNull();
  });
});

describe('centres by role', () => {
  // IAM-04: the guard (seesAllCentres) and row level security (all_centres) agree for every role.
  it('match seesAllCentres for every role', async () => {
    const { role: originalRole } = original.get(physio) ?? {};
    try {
      for (const role of staffRoles) {
        await setStaff(physio, { role });
        const claims = await currentStaffClaims(db, loginOf(physio));
        expect(claims, role).toMatchObject({ role, all_centres: seesAllCentres(role) });
      }
    } finally {
      await setStaff(physio, { role: originalRole });
    }
  });
});

describe('the access token hook', () => {
  const run = (userId: string) =>
    db.execute<{ event: { user_id: string; claims: Record<string, unknown> } }>(sql`
      select internal.custom_access_token_hook(jsonb_build_object(
        'user_id', ${userId}::text,
        'authentication_method', 'password',
        'claims', jsonb_build_object('sub', ${userId}::text, 'aal', 'aal2', 'role', 'authenticated')
      )) as event`);

  it('adds the clinic claim and keeps every standard claim', async () => {
    const [row] = await run(loginOf(physio));
    expect(row?.event.claims).toMatchObject({
      sub: loginOf(physio),
      aal: 'aal2',
      role: 'authenticated',
      clinic: { staff_id: physio, role: 'physiotherapist', centres: [centreIds.whitefield] },
    });
  });

  it('leaves the claim out for a login that is not an active staff member', async () => {
    const [row] = await run(crypto.randomUUID());
    expect(row?.event.claims).not.toHaveProperty('clinic');
    expect(row?.event.claims).toMatchObject({ role: 'authenticated' });
  });

  it('cannot be called through the Supabase API roles, nor can staff_claims', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const call of [
        sql`select internal.custom_access_token_hook('{}'::jsonb)`,
        sql`select internal.staff_claims(${loginOf(physio)}::uuid)`,
      ]) {
        await expect(
          db.transaction(async (tx) => {
            await tx.execute(sql`select set_config('role', ${role}, true)`);
            await tx.execute(call);
          }),
        ).rejects.toThrow();
      }
    }
  });

  it('can be called by Supabase Auth', async () => {
    const rows = await db.execute<{ allowed: boolean }>(sql`
      select has_function_privilege('supabase_auth_admin',
        'internal.custom_access_token_hook(jsonb)', 'execute') as allowed`);
    expect(rows[0]?.allowed).toBe(true);
  });
});

describe('claim readers for row level security', () => {
  const asSignedIn = async (claims: unknown) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('role', 'authenticated', true)`);
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`,
      );
      const rows = await tx.execute<{
        role: string | null;
        treats: boolean;
        consultant: boolean;
        centres: string[];
        sees_hsr: boolean;
        sees_whitefield: boolean;
      }>(sql`
        select internal.jwt_staff_role() as role,
               internal.jwt_treats() as treats,
               internal.jwt_consultant() as consultant,
               internal.jwt_centre_ids()::text[] as centres,
               internal.jwt_sees_centre(${centreIds.hsrLayout}::uuid) as sees_hsr,
               internal.jwt_sees_centre(${centreIds.whitefield}::uuid) as sees_whitefield`);
      return rows[0];
    });

  it('read the signed in person’s role, ticks and centres', async () => {
    const clinic = await currentStaffClaims(db, loginOf(physio));
    expect(await asSignedIn({ role: 'authenticated', clinic })).toEqual({
      role: 'physiotherapist',
      treats: true,
      consultant: true,
      centres: [centreIds.whitefield],
      sees_hsr: false,
      sees_whitefield: true,
    });
  });

  it('let Super Admin and Finance see every centre', async () => {
    const clinic = await currentStaffClaims(db, loginOf(finance));
    expect(await asSignedIn({ role: 'authenticated', clinic })).toMatchObject({
      role: 'finance',
      sees_hsr: true,
      sees_whitefield: true,
    });
  });

  it('grant nothing to a token without the claim', async () => {
    expect(await asSignedIn({ role: 'authenticated' })).toEqual({
      role: null,
      treats: false,
      consultant: false,
      centres: [],
      sees_hsr: false,
      sees_whitefield: false,
    });
  });
});
