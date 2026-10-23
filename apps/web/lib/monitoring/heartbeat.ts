/** How long the tick waits for the uptime service before going on without it. */
const HEARTBEAT_TIMEOUT_MS = 3000;

/**
 * Tells the uptime service the job tick ran (FND-12). When pg_cron, Vercel, the function or the
 * database stops, the beats stop and Better Stack alerts the on call phone
 * (docs/runbooks/monitoring.md). A failed beat is ignored: monitoring never fails the tick, and a
 * missed beat alerts by itself.
 */
export async function sendHeartbeat(url: string | undefined): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
  } catch {
    // Unreachable or slow: the next tick tries again.
  }
}
