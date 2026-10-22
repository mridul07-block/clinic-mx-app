import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearAllRateLimits } from './rate-limits';
import { accountsWithAuthenticator, addAuthenticator, clearTwoStep, testStaff } from './staff';

// Before the end to end tests (IAM-02): every test account starts with no authenticator app, and
// the shared accounts get a fresh one, so tests sign in with a code like real staff. The secrets
// go to e2e/.auth (git ignored). Needs the local Supabase stack, seeded with staff logins.
export default async function globalSetup() {
  // IAM-11: runs close together would otherwise add up to a sign in or reset email limit.
  await clearAllRateLimits();
  for (const { email } of Object.values(testStaff)) await clearTwoStep(email);

  const secrets: Record<string, string> = {};
  for (const { email } of accountsWithAuthenticator) {
    secrets[email] = await addAuthenticator(email);
  }
  // Read back by staff.ts (twoStepSecret).
  mkdirSync(join(import.meta.dirname, '.auth'), { recursive: true });
  writeFileSync(
    join(import.meta.dirname, '.auth', 'two-step.json'),
    JSON.stringify(secrets, null, 2),
  );
}
