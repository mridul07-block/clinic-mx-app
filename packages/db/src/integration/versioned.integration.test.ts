import { sql } from 'drizzle-orm';
import { integer, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../client';
import { RecordNotFoundError, updateVersioned } from '../versioned';

// Runs against the CI database only. A throwaway schema holds a table shaped like any table
// that takes autosaved drafts: an id and a version.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const first = createDb(url, { max: 1 });
const second = createDb(url, { max: 1 });

const probe = pgSchema('fnd08_probe');
const note = probe.table('note', {
  id: uuid('id').primaryKey().defaultRandom(),
  text: text('text').notNull(),
  version: integer('version').notNull().default(1),
});

async function newNote(text: string) {
  const [row] = await first.db.insert(note).values({ text }).returning();
  if (!row) throw new Error('insert failed');
  return row;
}

beforeAll(async () => {
  await first.db.execute(sql`create schema if not exists fnd08_probe`);
  await first.db.execute(sql`
    create table if not exists fnd08_probe.note (
      id uuid primary key default gen_random_uuid(),
      text text not null,
      version integer not null default 1
    )`);
});

afterAll(async () => {
  await first.db.execute(sql`drop schema if exists fnd08_probe cascade`);
  await Promise.all([first.close(), second.close()]);
});

describe('updateVersioned', () => {
  it('saves against the current version and bumps it', async () => {
    const row = await newNote('first');
    expect(await updateVersioned(first.db, note, row.id, 1, { text: 'second' })).toEqual({
      status: 'saved',
      version: 2,
    });
    expect(await updateVersioned(first.db, note, row.id, 2, { text: 'third' })).toEqual({
      status: 'saved',
      version: 3,
    });
  });

  it('refuses a stale version and returns what is saved', async () => {
    const row = await newNote('saved on the tablet');
    await updateVersioned(first.db, note, row.id, 1, { text: 'changed on the phone' });
    const result = await updateVersioned(first.db, note, row.id, 1, { text: 'offline edit' });
    expect(result).toMatchObject({
      status: 'conflict',
      version: 2,
      row: { text: 'changed on the phone' },
    });
  });

  it('lets exactly one of two simultaneous saves on the same version win', async () => {
    const row = await newNote('start');
    const results = await Promise.all([
      updateVersioned(first.db, note, row.id, 1, { text: 'from device A' }),
      updateVersioned(second.db, note, row.id, 1, { text: 'from device B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'saved']);
    const [stored] = await first.db
      .select()
      .from(note)
      .where(sql`${note.id} = ${row.id}`);
    expect(stored?.version).toBe(2);
  });

  it('reports a record that does not exist', async () => {
    await expect(
      updateVersioned(first.db, note, crypto.randomUUID(), 1, { text: 'x' }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});
