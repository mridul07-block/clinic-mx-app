import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, generateKeyPair } from './age';
import { countCopyRows, fileEntries } from './manifest';
import { cronSql, withoutEmptyCopies, withoutPlatformGrants } from './restore';
import { compare } from './verify';

// FND-13: the pieces of a backup and its restore. Generated stand-in rows only.

const lines = (text: string) => Readable.from(text.split('\n')) as AsyncIterable<string>;
const collect = async (from: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const line of from) out.push(line);
  return out.join('\n');
};

const dump = [
  'SET session_replication_role = replica;',
  'COPY "public"."centre" ("id", "name") FROM stdin;',
  'c1\tTest Centre One',
  'c2\tTest Centre Two\\.\\\\. and a tab\\t inside',
  '\\.',
  '',
  'COPY "storage"."buckets_vectors" ("id") FROM stdin;',
  '\\.',
  '',
  'COPY "auth"."users" ("id", "email") FROM stdin;',
  'u1\ttest.one@example.com',
  '\\.',
  "SELECT pg_catalog.setval('public.seq', 3, true);",
].join('\n');

describe('countCopyRows', () => {
  it('counts each table, empty ones too; an escaped \\. inside a value is a row', () => {
    expect(countCopyRows(dump)).toEqual({
      '"public"."centre"': 2,
      '"storage"."buckets_vectors"': 0,
      '"auth"."users"': 1,
    });
  });

  it('refuses a dump cut off inside a table', () => {
    expect(() => countCopyRows('COPY "public"."centre" ("id") FROM stdin;\nc1')).toThrow(
      'ends inside the rows of "public"."centre"',
    );
  });
});

describe('restore script filters', () => {
  it('drops empty tables and keeps every row of the others', async () => {
    const kept = await collect(withoutEmptyCopies(lines(dump)));
    expect(kept).not.toContain('buckets_vectors');
    expect(countCopyRows(kept)).toEqual({ '"public"."centre"': 2, '"auth"."users"': 1 });
    expect(kept).toContain("SELECT pg_catalog.setval('public.seq', 3, true);");
  });

  it('drops grants to Supabase roles and keeps our own roles', async () => {
    const roles = [
      'CREATE ROLE "clinic_patient";',
      'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
      'GRANT "clinic_patient" TO "authenticator";',
    ].join('\n');
    expect(await collect(withoutPlatformGrants(lines(roles)))).toBe(
      'CREATE ROLE "clinic_patient";\nGRANT "clinic_patient" TO "authenticator";',
    );
  });

  it('writes cron schedules back, quoting commands that hold the quote', () => {
    const sql = cronSql([
      { jobname: 'jobs-tick', schedule: '* * * * *', command: 'SELECT internal.jobs_tick()' },
      { jobname: 'odd', schedule: '0 1 * * *', command: 'SELECT $cron$x$cron$' },
    ]);
    expect(sql).toContain(
      'select cron.schedule($cron$jobs-tick$cron$, $cron$* * * * *$cron$, $cron$SELECT internal.jobs_tick()$cron$);',
    );
    expect(sql).toContain('$cron_$SELECT $cron$x$cron$$cron_$');
    expect(cronSql([])).toBe('');
  });
});

describe('files and verification', () => {
  let dir = '';
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('lists files with sizes and hashes, and reports what a restore lost', async () => {
    dir = await mkdtemp(join(tmpdir(), 'backup-test-'));
    await mkdir(join(dir, 'files', 'signatures', 'p1'), { recursive: true });
    await writeFile(join(dir, 'files', 'signatures', 'p1', 'a.png'), 'stand-in image');
    await writeFile(join(dir, 'files', 'reports.txt'), 'x');
    const files = await fileEntries(join(dir, 'files'));
    expect(files.map((f) => f.path)).toEqual(['reports.txt', 'signatures/p1/a.png']);
    expect(files[1]?.size).toBe(14);
    expect(files[1]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await fileEntries(join(dir, 'nothing-here'))).toEqual([]);

    const manifest = { tables: { '"public"."centre"': 2, '"auth"."users"': 1 }, files };
    expect(compare(manifest, { tables: { ...manifest.tables }, files })).toEqual([]);
    expect(
      compare(manifest, {
        tables: { '"public"."centre"': 1 },
        files: files.slice(1).map((file) => ({ ...file, sha256: '0'.repeat(64) })),
      }),
    ).toEqual([
      '"public"."centre": 1 rows, expected 2',
      '"auth"."users": missing after restore',
      'file reports.txt: missing',
      'file signatures/p1/a.png: contents differ',
    ]);
  });
});

describe('encryption', () => {
  it('only the matching private key reads a copy', async () => {
    const work = await mkdtemp(join(tmpdir(), 'backup-age-'));
    try {
      const owner = await generateKeyPair();
      const stranger = await generateKeyPair();
      expect(owner.recipient).toMatch(/^age1[0-9a-z]+$/);
      expect(owner.identity).toMatch(/^AGE-SECRET-KEY-1/);
      await writeFile(join(work, 'plain'), dump);
      await encryptFile(join(work, 'plain'), join(work, 'copy.age'), owner.recipient);
      expect(await readFile(join(work, 'copy.age'), 'utf8')).not.toContain('Test Centre');
      await decryptFile(join(work, 'copy.age'), join(work, 'back'), owner.identity);
      expect(await readFile(join(work, 'back'), 'utf8')).toBe(dump);
      await expect(
        decryptFile(join(work, 'copy.age'), join(work, 'nope'), stranger.identity),
      ).rejects.toThrow();
      await expect(encryptFile(join(work, 'plain'), join(work, 'x'), 'not-a-key')).rejects.toThrow(
        'not an age public key',
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
