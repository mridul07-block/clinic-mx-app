import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * What a backup holds (FND-13, docs/runbooks/backups.md): each table's row count, read from the
 * dump itself, and each stored file's size and hash. Table names, counts and hashes only: no row
 * or file contents, so the manifest is kept unencrypted beside the encrypted copy.
 */
export type Manifest = {
  takenAt: string;
  environment: string;
  kind: 'nightly' | 'weekly';
  cliVersion: string;
  tables: Record<string, number>;
  files: FileEntry[];
};

export type FileEntry = { path: string; size: number; sha256: string };

const copyStart = /^COPY ("[^"]+"\."[^"]+") /;

/**
 * Rows per table in a `pg_dump` data file in COPY form. In COPY text each row is one line (line
 * breaks inside values are written `\n`) and a block ends at a line that is exactly `\.`; a value
 * holding `\.` is written `\\.`, so it never ends a block.
 */
export function countCopyRows(dataSql: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let table: string | null = null;
  for (const line of dataSql.split('\n')) {
    if (table === null) {
      const start = copyStart.exec(line);
      if (start?.[1]) {
        table = start[1];
        counts[table] = 0;
      }
    } else if (line === '\\.' || line === '\\.\r') {
      table = null;
    } else {
      counts[table] = (counts[table] ?? 0) + 1;
    }
  }
  if (table !== null) throw new Error(`The data file ends inside the rows of ${table}`);
  return counts;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Every file under `dir`, with forward slash paths relative to it, sorted. */
export async function fileEntries(dir: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const walk = async (folder: string) => {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        entries.push({
          path: relative(dir, path).split(sep).join('/'),
          size: (await stat(path)).size,
          sha256: await sha256File(path),
        });
      }
    }
  };
  await walk(dir).catch((error: unknown) => {
    // No folder means no files (a project without stored files).
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildManifest(
  work: string,
  details: Pick<Manifest, 'environment' | 'kind' | 'cliVersion'>,
): Promise<Manifest> {
  return {
    takenAt: new Date().toISOString(),
    ...details,
    tables: countCopyRows(await readFile(join(work, 'data.sql'), 'utf8')),
    files: await fileEntries(join(work, 'files')),
  };
}
