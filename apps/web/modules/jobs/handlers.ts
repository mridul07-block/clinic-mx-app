import type { JobHandlers } from '@clinic-mx/db';
import { z } from 'zod';

/**
 * Every job kind the tick can run (TAD section 8). Each ticket that adds a job adds its handler
 * here; handlers must be safe to run twice, because a job may run again after a crash.
 */
export const jobHandlers: JobHandlers = {
  /** Does nothing: proves the queue end to end on an environment (docs/runbooks/jobs.md). */
  'system.ping': { payload: z.object({}), run: () => Promise.resolve() },
};
