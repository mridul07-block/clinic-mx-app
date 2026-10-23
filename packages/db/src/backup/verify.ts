import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import { fileEntries, type Manifest } from './manifest';

/**
 * Checks a restore against its manifest (FND-13): every table holds the rows the dump held, and
 * every stored file is there with its hash. Returns the differences, by table or file name only,
 * never row contents; an empty list means the restore is whole.
 */
export function compare(
  manifest: Pick<Manifest, 'tables' | 'files'>,
  restored: { tables: Record<string, number>; files: Manifest['files'] },
): string[] {
  const problems: string[] = [];
  for (const [table, rows] of Object.entries(manifest.tables)) {
    const found = restored.tables[table];
    if (found === undefined) problems.push(`${table}: missing after restore`);
    else if (found !== rows)
      problems.push(`${table}: ${String(found)} rows, expected ${String(rows)}`);
  }
  const files = new Map(restored.files.map((file) => [file.path, file]));
  for (const file of manifest.files) {
    const found = files.get(file.path);
    if (!found) problems.push(`file ${file.path}: missing`);
    else if (found.sha256 !== file.sha256) problems.push(`file ${file.path}: contents differ`);
  }
  return problems;
}

/** Row counts of the manifest's tables in a restored database. */
export async function restoredCounts(db: Db, tables: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await db
      .execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${table}`))
      .catch(() => [undefined]);
    if (row) counts[table] = row.n;
  }
  return counts;
}

export async function verifyRestore(db: Db, work: string, manifest: Manifest) {
  return compare(manifest, {
    tables: await restoredCounts(db, Object.keys(manifest.tables)),
    files: await fileEntries(join(work, 'files')),
  });
}
