import * as Sentry from '@sentry/nextjs';
import { monitoringOptions } from './lib/monitoring/options';

// Error reports from the browser (FND-12), sent to /monitoring on our own domain, never to
// sentry.io directly (next.config.ts `tunnelRoute`). A DSN is public by design.
Sentry.init(
  monitoringOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    environment: process.env.NEXT_PUBLIC_DEPLOY_ENV,
    release: process.env.NEXT_PUBLIC_BUILD_ID,
  }),
);
