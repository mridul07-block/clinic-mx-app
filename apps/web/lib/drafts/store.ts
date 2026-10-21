import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * Drafts kept on the device (FND-08) in IndexedDB, so an edit survives a reload, a dropped
 * connection or a locked phone. One draft per record and screen, keyed by
 * `scope:kind:id`; `scope` is the signed in staff member, so a shared tablet keeps each person's
 * drafts apart, and sign out clears them (`clearDrafts`).
 */

export interface DraftRecord<T = unknown> {
  key: string;
  scope: string;
  /** What is being edited, for example "consultation-subjective". */
  kind: string;
  /** The record's id. */
  id: string;
  value: T;
  /** The record version the edit started from. */
  baseVersion: number;
  updatedAt: number;
  /** Set when the server refused the save because the record changed meanwhile. */
  conflict?: { version: number; value: T };
}

interface DraftsSchema extends DBSchema {
  drafts: { key: string; value: DraftRecord; indexes: { scope: string } };
}

let database: Promise<IDBPDatabase<DraftsSchema>> | undefined;

function db() {
  database ??= openDB<DraftsSchema>('clinic-mx-drafts', 1, {
    upgrade(upgrade) {
      const drafts = upgrade.createObjectStore('drafts', { keyPath: 'key' });
      drafts.createIndex('scope', 'scope');
    },
  });
  return database;
}

export const draftKey = (scope: string, kind: string, id: string) => `${scope}:${kind}:${id}`;

export async function putDraft<T>(draft: DraftRecord<T>): Promise<void> {
  await (await db()).put('drafts', draft);
}

export async function getDraft<T>(key: string): Promise<DraftRecord<T> | undefined> {
  return (await (await db()).get('drafts', key)) as DraftRecord<T> | undefined;
}

export async function deleteDraft(key: string): Promise<void> {
  await (await db()).delete('drafts', key);
}

/** Every draft waiting to be saved for one staff member. */
export async function listDrafts(scope: string): Promise<DraftRecord[]> {
  return (await db()).getAllFromIndex('drafts', 'scope', scope);
}

/** Removes every draft of one staff member: called on sign out (IAM-01). */
export async function clearDrafts(scope: string): Promise<void> {
  const store = (await db()).transaction('drafts', 'readwrite').store;
  for await (const cursor of store.index('scope').iterate(scope)) await cursor.delete();
}
