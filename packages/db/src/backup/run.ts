import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { createDb } from '../client';
import { decryptFile, encryptFile, generateKeyPair } from './age';
import { downloadAllFiles, storageAdmin, uploadFiles } from './files';
import { buildManifest, countCopyRows, fileEntries, type Manifest } from './manifest';
import { cronSql, restoreScript, type CronJob } from './restore';
import { compare, verifyRestore } from './verify';

// Backups (FND-13, docs/runbooks/backups.md). One entry point for the nightly workflow and the
// monthly restore test:
//
//   take <work>                dump the database, cron schedules and stored files; write the manifest
//   verify-restore <work>      restore into the throwaway stack and check it against the manifest
//   seal <work> <out>          tar, encrypt to BACKUP_AGE_RECIPIENT, remove the plain copy
//   restore-test <copy.age>    decrypt with BACKUP_AGE_IDENTITY_FILE, check, restore, verify, time it
//   keygen <identity file>     a new key pair: the private key to the file, the public key printed
//
// Prints counts, names and times only, never what a row or file holds.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
/** The throwaway Supabase project restores are proven in (ports 553xx, no migrations). */
// Relative to the repository root, where commands run (the root's path may hold a space).
const stack = 'packages/db/src/backup/stack';
const stackContainer = 'supabase_db_clinic-mx-restore';
const stackDbUrl = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (docs/runbooks/backups.md)`);
  return value;
}

type RunOptions = {
  /** Lines streamed to its stdin, or a file piped to it whole. */
  input?: AsyncIterable<string> | { file: string };
  /** Keep stdout and return it, rather than passing it through. */
  capture?: boolean;
  /** Write stdout to this file. */
  output?: string;
  /** Extra environment for the command. */
  env?: Record<string, string>;
  /** Where it runs; the repository root unless given. */
  cwd?: string;
};

/** Runs a command from the repository root. Fails on a non-zero exit. */
function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  return new Promise((done, failed) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      // Only pnpm is a script on Windows; a shell there would split quoted arguments.
      shell: process.platform === 'win32' && command === 'pnpm',
      stdio: [
        options.input ? 'pipe' : 'ignore',
        options.capture || options.output ? 'pipe' : 'inherit',
        'inherit',
      ],
    });
    let captured = '';
    if (options.output) child.stdout?.pipe(createWriteStream(options.output));
    else child.stdout?.on('data', (chunk: Buffer) => (captured += chunk.toString()));
    const { input } = options;
    if (input && child.stdin) {
      const source =
        'file' in input
          ? createReadStream(input.file)
          : Readable.from(
              (async function* () {
                for await (const line of input) yield `${line}\n`;
              })(),
            );
      // A command may stop reading early (pg_restore --list reads only the archive's contents
      // list); its exit code decides, not the broken pipe.
      child.stdin.on('error', () => undefined);
      source.pipe(child.stdin);
    }
    child.on('error', failed);
    child.on('close', (code) => {
      if (code === 0) done(captured);
      else
        failed(new Error(`${command} ${args.slice(0, 2).join(' ')} exited with ${String(code)}`));
    });
  });
}

const supabase = (args: string[], capture = false) =>
  run('pnpm', ['exec', 'supabase', ...args], { capture });

async function take(work: string) {
  const url = required('BACKUP_DATABASE_URL');
  const kind = (process.env.BACKUP_KIND ?? 'nightly') as Manifest['kind'];
  await mkdir(work, { recursive: true });
  await supabase(['db', 'dump', '--db-url', url, '--role-only', '-f', join(work, 'roles.sql')]);
  await supabase(['db', 'dump', '--db-url', url, '-f', join(work, 'schema.sql')]);
  await supabase([
    'db',
    'dump',
    '--db-url',
    url,
    '--data-only',
    '--use-copy',
    '-f',
    join(work, 'data.sql'),
  ]);

  const client = postgres(url, { max: 1, prepare: false });
  try {
    const jobs = await client<
      CronJob[]
    >`select jobname, schedule, command from cron.job order by jobname`;
    await writeFile(join(work, 'cron.sql'), cronSql([...jobs]));
    console.log('cron schedules:', jobs.length);
  } finally {
    await client.end();
  }

  const files = await downloadAllFiles(
    storageAdmin(required('BACKUP_SUPABASE_URL'), required('BACKUP_SUPABASE_SERVICE_ROLE_KEY')),
    join(work, 'files'),
  );
  console.log('stored files by bucket:', JSON.stringify(files));

  if (kind === 'weekly') {
    // Standard Postgres archive for another host (TAD: fallback host within 2 days), by the
    // restore stack's own pg_dump 17. The address reaches the container through its environment,
    // never its command line; a local database is the host as seen from inside the container.
    const fromContainer = url.replace(/@(127\.0\.0\.1|localhost):/, '@host.docker.internal:');
    await run(
      'docker',
      [
        'exec',
        '-e',
        'BACKUP_SOURCE_URL',
        stackContainer,
        'sh',
        '-c',
        'pg_dump --format=custom --no-owner --no-privileges "$BACKUP_SOURCE_URL"',
      ],
      { output: join(work, 'database.dump'), env: { BACKUP_SOURCE_URL: fromContainer } },
    );
  }

  const cliVersion = (await supabase(['--version'], true)).trim().split('\n')[0] ?? '';
  const manifest = await buildManifest(work, {
    environment: process.env.BACKUP_ENVIRONMENT ?? 'local',
    kind,
    cliVersion,
  });
  await writeFile(join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const rows = Object.values(manifest.tables).reduce((sum, n) => sum + n, 0);
  console.log(
    `${kind} backup taken: ${String(Object.keys(manifest.tables).length)} tables, ${String(rows)} rows, ${String(manifest.files.length)} files`,
  );
}

async function verifyRestoreOf(work: string): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')) as Manifest;
  await supabase(['db', 'reset', '--workdir', stack]);
  const started = Date.now();
  const problems: string[] = [];
  await run(
    'docker',
    [
      'exec',
      '-i',
      stackContainer,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--single-transaction',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    {
      input: restoreScript({
        roles: join(work, 'roles.sql'),
        schema: join(work, 'schema.sql'),
        data: join(work, 'data.sql'),
        cron: join(work, 'cron.sql'),
      }),
      capture: true,
    },
  );
  const status = JSON.parse(await supabase(['status', '--workdir', stack, '-o', 'json'], true)) as {
    API_URL: string;
    SERVICE_ROLE_KEY: string;
  };
  const { db, close } = createDb(stackDbUrl, { max: 1 });
  try {
    const types = await db.execute<{ path: string; type: string | null }>(
      sql`select bucket_id || '/' || name as path, metadata ->> 'mimetype' as type from storage.objects`,
    );
    const contentTypes = new Map(
      types.flatMap((row) => (row.type ? [[row.path, row.type] as const] : [])),
    );
    await uploadFiles(
      storageAdmin(status.API_URL, status.SERVICE_ROLE_KEY),
      join(work, 'files'),
      manifest.files,
      contentTypes,
    );
    problems.push(...(await verifyRestore(db, work, manifest)));
  } finally {
    await close();
  }
  if (existsSync(join(work, 'database.dump'))) {
    const listed = await run('docker', ['exec', '-i', stackContainer, 'pg_restore', '--list'], {
      input: { file: join(work, 'database.dump') },
      capture: true,
    }).catch(() => '');
    const entries = listed.split('\n').filter((line) => line && !line.startsWith(';')).length;
    if (entries === 0) problems.push('database.dump: pg_restore could not read the archive');
    else console.log('weekly archive readable by pg_restore:', entries, 'entries');
  }
  const tables = Object.keys(manifest.tables).length;
  console.log(
    `restored in ${String(Math.round((Date.now() - started) / 1000))} s: ${String(tables)} tables and ${String(manifest.files.length)} files checked, ${String(problems.length)} problems`,
  );
  for (const problem of problems) console.log('  problem:', problem);
  return problems;
}

async function seal(work: string, out: string) {
  const tarball = `${out}.tar.gz`;
  // The archive is named relative to its folder: GNU tar reads "C:..." as a remote host.
  await run('tar', ['-czf', basename(tarball), '-C', work, '.'], { cwd: dirname(tarball) });
  await encryptFile(tarball, out, required('BACKUP_AGE_RECIPIENT'));
  await rm(tarball, { force: true });
  await rm(work, { recursive: true, force: true });
  console.log('sealed:', out);
}

async function restoreTest(copy: string) {
  const identity = await readFile(required('BACKUP_AGE_IDENTITY_FILE'), 'utf8');
  const started = Date.now();
  const scratch = await mkdtemp(join(tmpdir(), 'clinic-mx-restore-'));
  try {
    const tarball = join(scratch, 'copy.tar.gz');
    await decryptFile(copy, tarball, identity);
    const work = join(scratch, 'work');
    await mkdir(work);
    await run('tar', ['-xzf', basename(tarball), '-C', work], { cwd: scratch });
    const manifest = JSON.parse(await readFile(join(work, 'manifest.json'), 'utf8')) as Manifest;
    console.log(`copy: ${manifest.kind} of ${manifest.environment}, taken ${manifest.takenAt}`);
    const inCopy = compare(manifest, {
      tables: countCopyRows(await readFile(join(work, 'data.sql'), 'utf8')),
      files: await fileEntries(join(work, 'files')),
    });
    if (inCopy.length > 0)
      throw new Error(`The copy does not match its manifest: ${inCopy.join('; ')}`);
    const problems = await verifyRestoreOf(work);
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(
      `restore test ${problems.length === 0 ? 'PASSED' : 'FAILED'} in ${minutes} minutes (target: 4 hours)`,
    );
    if (problems.length > 0) process.exitCode = 1;
  } finally {
    // The plain copy holds patient data: never left behind.
    await rm(scratch, { recursive: true, force: true });
  }
}

async function keygen(file: string) {
  if (existsSync(file)) throw new Error(`${file} exists; refusing to overwrite a key`);
  const { identity, recipient } = await generateKeyPair();
  await writeFile(file, `${identity}\n`, { mode: 0o600, flag: 'wx' });
  console.log('private key written to', file, '(keep it offline; never commit or share it)');
  console.log('public key (BACKUP_AGE_RECIPIENT):', recipient);
}

const [command, first = '', second = ''] = process.argv.slice(2);
const commands: Record<string, () => Promise<unknown>> = {
  take: () => take(resolve(first)),
  'verify-restore': async () => {
    if ((await verifyRestoreOf(resolve(first))).length > 0) process.exitCode = 1;
  },
  seal: () => seal(resolve(first), resolve(second)),
  'restore-test': () => restoreTest(resolve(first)),
  keygen: () => keygen(resolve(first)),
};
const chosen = command ? commands[command] : undefined;
if (!chosen || !first) {
  console.error(`Usage: backup <${Object.keys(commands).join('|')}> <path> [out]`);
  process.exit(2);
}
await chosen();
