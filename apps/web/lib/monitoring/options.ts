import { scrubBreadcrumb, scrubEvent } from './scrub';

type Where = {
  /** No DSN, nothing is sent: local runs, CI and tests. */
  dsn: string | undefined;
  environment: string | undefined;
  release: string | undefined;
};

const sessionIntegrations = new Set(['ProcessSession', 'BrowserSession']);

/**
 * Sentry options shared by the server, the edge and the browser (FND-12). Errors only: no
 * tracing and no session replay, which would record patient screens and addresses. Every event
 * and breadcrumb is scrubbed before it leaves (`./scrub`).
 */
export function monitoringOptions({ dsn, environment, release }: Where) {
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: environment ?? 'local',
    release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendTransaction: () => null,
    // Release health sessions carry the user (`did`) and never pass through beforeSend.
    integrations: (defaults: { name: string }[]) =>
      defaults.filter(({ name }) => !sessionIntegrations.has(name)),
  };
}
