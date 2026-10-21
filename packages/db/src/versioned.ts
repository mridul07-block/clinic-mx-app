import { and, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from './client';

/**
 * Saves that only succeed if nobody saved the record in between (FND-08). A table that takes
 * autosaved drafts has `id uuid` and `version integer not null default 1`; every save names the
 * version it started from and bumps it by one.
 */

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTransaction = Db | Transaction;

export type VersionedTable = PgTable & { id: PgColumn; version: PgColumn };

export type VersionedResult<Row> =
  { status: 'saved'; version: number } | { status: 'conflict'; version: number; row: Row };

export class RecordNotFoundError extends Error {
  constructor(id: string) {
    super(`Record ${id} does not exist`);
    this.name = 'RecordNotFoundError';
  }
}

export async function updateVersioned<T extends VersionedTable>(
  db: DbOrTransaction,
  table: T,
  id: string,
  baseVersion: number,
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- generic over any table, so the linter sees {}; each call site checks the real insert type
  values: Partial<T['$inferInsert']>,
): Promise<VersionedResult<T['$inferSelect']>> {
  // One statement: the version check and the write cannot be split by another save.
  const saved = await db
    .update(table)
    .set({ ...values, version: sql`${table.version} + 1` })
    .where(and(eq(table.id, id), eq(table.version, baseVersion)))
    .returning({ version: table.version });
  const [first] = saved as { version: number }[];
  if (first) return { status: 'saved', version: first.version };

  const rows = await db.select().from<PgTable>(table).where(eq(table.id, id));
  const [row] = rows as (T['$inferSelect'] & { version: number })[];
  if (!row) throw new RecordNotFoundError(id);
  return { status: 'conflict', version: row.version, row };
}
