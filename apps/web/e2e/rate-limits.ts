import { clearRateLimit, createDb, rateLimit } from '@clinic-mx/db';
import type { Page } from '@playwright/test';

// Rate limits for end to end tests (IAM-11). Global setup clears the test database's counters, so
// runs never add up to a limit; rate-limits.spec.ts gives each test a network of its own through
// x-real-ip, the header Vercel sets (locally nothing sets it, so the browser's value is used).

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Every counter in the test database (never run against staging). */
export async function clearAllRateLimits(): Promise<void> {
  await db().delete(rateLimit);
}

/** Forgets one email's failed sign ins, as deleting its rows would in the runbook. */
export async function clearSignInLimit(email: string): Promise<void> {
  await clearRateLimit(db(), 'sign_in_per_email', email);
}

/** A documentation address (RFC 5737) for this test alone. */
export function newNetwork(): string {
  const byte = () => Math.floor(Math.random() * 254) + 1;
  return `198.51.${byte()}.${byte()}`;
}

/** Makes `page` come from its own network. */
export async function fromNetwork(page: Page, network = newNetwork()): Promise<string> {
  await page.setExtraHTTPHeaders({ 'x-real-ip': network });
  return network;
}
