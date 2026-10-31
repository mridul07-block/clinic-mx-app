import { sql, TransactionRollbackError } from 'drizzle-orm';
import type { Db } from '../client';
import type { DbOrTransaction } from '../versioned';
import { DEMO_EMAIL_DOMAIN } from './names';

type Tx = DbOrTransaction;

/**
 * Takes the demo data away again (docs/runbooks/demo-data.md): every demo patient (marked by the
 * email domain) and every row that points at one, however indirectly, found through the
 * database's own foreign keys, plus the tasks and queued jobs whose details name any of them. The
 * set up (hours, fees, packages, exercises, tablets) stays. Rows that must be kept but point at a
 * removed one (a tablet showing a demo patient's link) have that link cleared instead.
 *
 * The rows are deleted with triggers off for this transaction (`session_replication_role =
 * replica`, as a restore runs), because signed notes and the like refuse to be deleted on purpose.
 * Before it commits, every foreign key into the tables touched is checked for rows left pointing at
 * a removed one, and the removal goes in the audit log as one entry with its counts; the audit log
 * keeps every earlier event about the rows.
 */

/** Tables whose rows are kept: a link from them to a demo row is cleared, never followed. */
const kept = new Set([
  'centre',
  'staff_user',
  'staff_user_centre',
  'kiosk_device',
  'roster',
  'staff_leave',
  'setting',
  'price_item',
  'package_type',
  'package_type_item',
  'discount_preset',
  'exercise',
  'appointment_type',
  'whatsapp_template',
]);

interface ForeignKey {
  child: string;
  column: string;
  parent: string;
  childHasId: boolean;
}

async function foreignKeys(tx: Tx): Promise<ForeignKey[]> {
  const rows = await tx.execute<{
    child: string;
    column: string;
    parent: string;
    child_has_id: boolean;
  }>(sql`
    select child.relname as child, att.attname as column, parent.relname as parent,
      exists (
        select 1 from pg_attribute id_column
        where id_column.attrelid = c.conrelid and id_column.attname = 'id'
          and id_column.atttypid = 'uuid'::regtype and not id_column.attisdropped
      ) as child_has_id
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
    join pg_attribute parent_att on parent_att.attrelid = c.confrelid
      and parent_att.attnum = c.confkey[1]
    where c.contype = 'f' and ns.nspname = 'public' and cardinality(c.conkey) = 1
      and parent_att.attname = 'id'
  `);
  return rows.map((row) => ({
    child: row.child,
    column: row.column,
    parent: row.parent,
    childHasId: row.child_has_id,
  }));
}

export interface RemoveCounts {
  patients: number;
  rows: number;
  jobs: number;
  tables: Record<string, number>;
  /** The removed documents' files, for the caller to take out of storage. */
  files: string[];
}

export async function removeDemo(tx: Tx): Promise<RemoveCounts> {
  await tx.execute(sql`
    create temporary table demo_doomed (tbl text not null, id uuid not null, round int not null,
      primary key (tbl, id)) on commit drop
  `);
  await tx.execute(sql`
    insert into demo_doomed
    select 'patient', id, 0 from public.patient where email like ${`%@${DEMO_EMAIL_DOMAIN}`}
  `);
  const keys = await foreignKeys(tx);
  const patients = await count(tx, sql`select count(*)::int as n from demo_doomed`);
  if (patients === 0) return { patients: 0, rows: 0, jobs: 0, tables: {}, files: [] };

  // Everything that points at a doomed row, round by round, until nothing new is found.
  for (let round = 0; ; round++) {
    let found = 0;
    for (const key of keys) {
      if (!key.childHasId || kept.has(key.child)) continue;
      const added = await tx.execute(sql`
        insert into demo_doomed
        select ${key.child}, child.id, ${round + 1}
        from ${sql.identifier(key.child)} child
        where child.${sql.identifier(key.column)} in
          (select id from demo_doomed where tbl = ${key.parent} and round = ${round})
        on conflict do nothing
      `);
      found += added.count;
    }
    // Tasks whose details name a doomed row (an appointment, a choice, a feedback).
    const tasks = await tx.execute(sql`
      insert into demo_doomed
      select 'task', t.id, ${round + 1} from public.task t
      where exists (
        select 1 from jsonb_each_text(t.details) detail
        join demo_doomed d on d.id::text = detail.value and d.round = ${round}
      )
      on conflict do nothing
    `);
    found += tasks.count;
    if (found === 0) break;
    if (round > 30) throw new Error('The demo rows did not settle.');
  }

  // The documents' files are in storage; the caller removes them once this commits.
  const files = await tx.execute<{ path: string }>(sql`
    select file_path as path from public.document
    where id in (select id from demo_doomed where tbl = 'document')
  `);

  await tx.execute(sql`set local session_replication_role = replica`);
  const table = (name: string) => sql`${sql.identifier('public')}.${sql.identifier(name)}`;
  const tables: Record<string, number> = {};
  let rows = 0;
  for (const key of keys) {
    if (!kept.has(key.child)) continue;
    await tx.execute(sql`
      update ${table(key.child)} set ${sql.identifier(key.column)} = null
      where ${sql.identifier(key.column)} in (select id from demo_doomed where tbl = ${key.parent})
    `);
  }
  for (const key of keys) {
    if (key.childHasId || kept.has(key.child)) continue;
    await tx.execute(sql`
      delete from ${table(key.child)}
      where ${sql.identifier(key.column)} in (select id from demo_doomed where tbl = ${key.parent})
    `);
  }
  const doomedTables = await tx.execute<{ tbl: string; n: number }>(
    sql`select tbl, count(*)::int as n from demo_doomed group by tbl order by tbl`,
  );
  for (const { tbl, n } of doomedTables) {
    await tx.execute(sql`
      delete from ${table(tbl)} where id in (select id from demo_doomed where tbl = ${tbl})
    `);
    tables[tbl] = n;
    rows += n;
  }
  const jobs = await count(
    tx,
    sql`with gone as (
      delete from public.job j
      where exists (
        select 1 from jsonb_each_text(j.payload) value
        join demo_doomed d on d.id::text = value.value
      )
      returning 1
    ) select count(*)::int as n from gone`,
  );
  // With the checks off, prove nothing points at a removed row: every foreign key into the tables
  // rows were removed from, composite ones and ones to other columns included.
  const orphans = await danglingKeys(tx, Object.keys(tables));
  if (orphans.length > 0) {
    throw new Error(`Removing would leave rows pointing at removed ones: ${orphans.join(', ')}.`);
  }
  await tx.execute(sql`set local session_replication_role = origin`);

  // The removal itself, in the audit log: the deletes above ran with its trigger off.
  await tx.execute(sql`
    insert into public.audit_event (actor, action, entity, after)
    values ('system:demo', 'delete', 'demo_data',
      ${JSON.stringify({ patients, rows, jobs, tables })}::jsonb)
  `);
  return { patients, rows, jobs, tables, files: files.map((file) => file.path) };
}

/** Foreign keys into `parents` with a child row whose parent row is gone, by constraint name. */
async function danglingKeys(tx: Tx, parents: string[]): Promise<string[]> {
  if (parents.length === 0) return [];
  const constraints = await tx.execute<{
    name: string;
    child: string;
    parent: string;
    child_columns: string[];
    parent_columns: string[];
  }>(sql`
    select c.conname as name, child.relname as child, parent.relname as parent,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n
        order by k.i) as child_columns,
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n
        order by k.i) as parent_columns
    from pg_constraint c
    join pg_class child on child.oid = c.conrelid
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace ns on ns.oid = child.relnamespace
    where c.contype = 'f' and ns.nspname = 'public'
      and parent.relname = any(${`{${parents.join(',')}}`}::text[])
  `);
  const dangling: string[] = [];
  for (const key of constraints) {
    const matches = sql.join(
      key.child_columns.map(
        (column, i) =>
          sql`p.${sql.identifier(key.parent_columns[i] ?? '')} = c.${sql.identifier(column)}`,
      ),
      sql` and `,
    );
    const present = sql.join(
      key.child_columns.map((column) => sql`c.${sql.identifier(column)} is not null`),
      sql` and `,
    );
    const left = await count(
      tx,
      sql`select count(*)::int as n from public.${sql.identifier(key.child)} c
        where ${present} and not exists (
          select 1 from public.${sql.identifier(key.parent)} p where ${matches})`,
    );
    if (left > 0) dangling.push(key.name);
  }
  return dangling;
}

/**
 * Whether this login may turn triggers off for a transaction (`session_replication_role`), which
 * the back-dating and the removal need; asked by trying it, then rolling back.
 */
export async function canSwitchTriggers(db: Db): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      tx.rollback();
    });
  } catch (error) {
    return error instanceof TransactionRollbackError;
  }
  return true;
}

async function count(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await tx.execute<{ n: number }>(query);
  return row?.n ?? 0;
}
