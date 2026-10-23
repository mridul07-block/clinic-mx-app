import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Turning a backup back into a database (FND-13), the way Supabase documents a CLI restore: roles,
 * then schema, then data with triggers off (`session_replication_role = replica`), in one
 * transaction that stops at the first error. Two things a fresh Supabase project refuses to the
 * `postgres` user are left out, because the project already has them:
 *
 * - grants to Supabase's own roles (`supabase_*`), such as SET on `log_min_messages`;
 * - empty tables, some of which (`storage.buckets_vectors`) only Supabase's roles may write.
 *
 * Then the cron schedules, which the data dump leaves out (`cron.sql`, written at backup time).
 */

/** Lines of a file, without line endings, streamed. */
export async function* fileLines(path: string): AsyncGenerator<string> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) yield line;
}

/** `roles.sql` less grants to Supabase's own roles, which a fresh project already has. */
export async function* withoutPlatformGrants(lines: AsyncIterable<string>): AsyncGenerator<string> {
  for await (const line of lines) {
    if (/^GRANT .* TO "supabase_[a-z_]+";$/.test(line)) continue;
    yield line;
  }
}

/** `data.sql` less the COPY blocks of empty tables; every row of every other table kept. */
export async function* withoutEmptyCopies(lines: AsyncIterable<string>): AsyncGenerator<string> {
  let header: string | null = null;
  let rows = 0;
  for await (const line of lines) {
    if (header === null) {
      if (line.startsWith('COPY ')) {
        header = line;
        rows = 0;
      } else yield line;
      continue;
    }
    if (line === '\\.') {
      if (rows > 0) yield line;
      header = null;
      continue;
    }
    if (rows === 0) yield header;
    rows += 1;
    yield line;
  }
}

export type CronJob = { jobname: string; schedule: string; command: string };

/** The cron schedules as SQL that puts them back, each command dollar quoted. */
export function cronSql(jobs: CronJob[]): string {
  const quote = (text: string) => {
    let tag = 'cron';
    while (text.includes(`$${tag}$`)) tag += '_';
    return `$${tag}$${text}$${tag}$`;
  };
  return jobs
    .map(
      (job) =>
        `select cron.schedule(${quote(job.jobname)}, ${quote(job.schedule)}, ${quote(job.command)});`,
    )
    .join('\n')
    .concat(jobs.length > 0 ? '\n' : '');
}

/** Everything psql runs for a restore, in order, streamed. */
export async function* restoreScript(files: {
  roles: string;
  schema: string;
  data: string;
  cron: string;
}): AsyncGenerator<string> {
  yield* withoutPlatformGrants(fileLines(files.roles));
  yield* fileLines(files.schema);
  yield 'SET session_replication_role = replica;';
  yield* withoutEmptyCopies(fileLines(files.data));
  yield 'SET session_replication_role = origin;';
  yield* fileLines(files.cron);
}
