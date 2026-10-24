import { expect, type APIRequestContext } from '@playwright/test';

// The job queue for end to end tests (ALT-06): local and CI databases have no scheduler, so a test
// runs the due jobs itself through the tick, as the scheduler does on staging. The secret is a
// test value playwright.config.ts gives the server; staging's own is never used here.
export const TEST_JOBS_SECRET = 'e2e-only-jobs-secret-never-on-a-deployment';

/** Runs every due job once, as one tick of the scheduler. */
export async function runDueJobs(request: APIRequestContext): Promise<void> {
  const ticked = await request.post('/api/jobs/tick', {
    headers: { authorization: `Bearer ${TEST_JOBS_SECRET}` },
  });
  expect(ticked.status()).toBe(200);
}
