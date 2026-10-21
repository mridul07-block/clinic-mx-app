import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../client';

// IAM-05: no table reaches the database without row level security policies, so a new table (the
// bills and packages of BIL-05 and BIL-08 among them) cannot skip them. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

// Tables only server work touches, with no policy for any person.
// job: the queue; jobs run on the server, never as a staff member.
const serverOnly = ['job'];

const names = async (query: ReturnType<typeof sql>) =>
  (await db.execute<{ name: string }>(query)).map((r) => r.name);

describe('row level security covers every table', () => {
  it('is on for every table in public', async () => {
    expect(
      await names(sql`
        select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
        order by 1`),
    ).toEqual([]);
  });

  it('has policies on every table, except the server only ones', async () => {
    expect(
      await names(sql`
        select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and not exists (
            select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
        order by 1`),
    ).toEqual(serverOnly);
  });

  it('gives policies to signed in staff only, never to anon or everyone', async () => {
    expect(
      await names(sql`
        select tablename || '.' || policyname as name from pg_policies
        where schemaname = 'public' and roles <> '{authenticated}'::name[]
        order by 1`),
    ).toEqual([]);
  });

  it('makes every view check the reader’s own access (security_invoker)', async () => {
    expect(
      await names(sql`
        select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('v', 'm')
          and not coalesce('security_invoker=true' = any (c.reloptions), false)
        order by 1`),
    ).toEqual([]);
  });

  it('keeps Velyx support read only on every table people reach (IAM-08)', async () => {
    // Each table with policies has a restrictive policy for every write command, so no permissive
    // policy a later table adds can let a support login write.
    expect(
      await names(sql`
        select c.relname || ':' || cmd.name as name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as cmd(name)
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and c.relname not in (${sql.join(
            serverOnly.map((table) => sql`${table}`),
            sql`, `,
          )})
          and not exists (
            select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
              and p.permissive = 'RESTRICTIVE' and p.cmd = cmd.name
              and p.policyname = 'support_read_only_' || lower(cmd.name))
        order by 1`),
    ).toEqual([]);
  });
});
