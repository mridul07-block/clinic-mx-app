import 'server-only';
import { createDb, type Db } from '@clinic-mx/db';
import { serverEnv } from './env';

/**
 * The app's database client, one per server instance, over the Supabase transaction pooler
 * (DATABASE_URL). The connection closes when idle, so a frozen serverless instance holds none.
 */
let client: Db | undefined;

export function appDb(): Db {
  if (!client) {
    const url = serverEnv().DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set, so the database cannot be reached.');
    client = createDb(url, { max: 1, idleTimeoutSeconds: 20 }).db;
  }
  return client;
}
