import 'server-only';
import { createDb, type Db } from '@clinic-mx/db';
import { serverEnv } from './env';

/**
 * The app's database client, one per server instance, over the Supabase transaction pooler
 * (DATABASE_URL). The connection closes when idle, so a frozen serverless instance holds none.
 */
let client: Db | undefined;

/**
 * The settings cache's own client. With one app connection, a settings load during an open
 * transaction would wait for that transaction to end, and the transaction for the load: the save
 * never finishes. On its own connection the load never waits on a save.
 */
let settingsClient: Db | undefined;

function connect(): Db {
  const url = serverEnv().DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set, so the database cannot be reached.');
  return createDb(url, { max: 1, idleTimeoutSeconds: 20 }).db;
}

export function appDb(): Db {
  client ??= connect();
  return client;
}

export function settingsDb(): Db {
  settingsClient ??= connect();
  return settingsClient;
}
