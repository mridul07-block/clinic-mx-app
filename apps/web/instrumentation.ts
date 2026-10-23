import * as Sentry from '@sentry/nextjs';
import { monitoringOptions } from './lib/monitoring/options';

// Error reports from the server and the edge (FND-12). Read straight from the environment, not
// through serverEnv(), so a bad variable elsewhere never stops the app from starting.
export function register(): void {
  Sentry.init(
    monitoringOptions({
      dsn: process.env.SENTRY_DSN || undefined,
      environment: process.env.VERCEL_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    }),
  );
}

// Errors thrown while rendering or in server actions and route handlers.
export const onRequestError = Sentry.captureRequestError;
