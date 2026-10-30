import { defineConfig, devices } from '@playwright/test';
import { TEST_JOBS_SECRET } from './e2e/jobs';
import { TEST_BOOKING_FLOW_ID, testFlowPrivateKey } from './e2e/flows';
import { TEST_WHATSAPP_APP_SECRET, TEST_WHATSAPP_VERIFY_TOKEN } from './e2e/whatsapp';

const PORT = 3000;
const isCI = Boolean(process.env.CI);

// Every user flow is tested on a 360 px phone first, then on desktop (rule 7, rule 19).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Gives the shared test logins an authenticator app (IAM-02); needs the local Supabase stack.
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // Next.js directly, never through pnpm: pnpm 12.6 runs scripts in their own process
    // group, so Playwright's SIGKILL to the server's group misses them and the run hangs.
    // `next` resolves from node_modules/.bin, which pnpm adds to PATH for `test:e2e`.
    command: `next build && next start --port ${PORT}`,
    // Turns on the autosave test harness (/app/test-harness/...); never set on Vercel.
    // A stand-in browser DSN (FND-12): pages report errors to /monitoring, which the monitoring
    // test catches; organisation 0 does not exist, so anything else sent is refused by Sentry.
    // A test value for the job tick (ALT-06: e2e/jobs.ts runs the queue); over any in .env.local.
    // WhatsApp (WA-01, WA-02): never the real token, so nothing leaves even when .env.local has
    // one; test values for the webhook, so tests sign bodies as Meta would.
    env: {
      CLINIC_MX_TEST_HARNESS: '1',
      JOBS_SECRET: TEST_JOBS_SECRET,
      NEXT_PUBLIC_SENTRY_DSN: 'https://public@o0.ingest.de.sentry.io/0',
      WHATSAPP_ACCESS_TOKEN: '',
      WHATSAPP_APP_SECRET: TEST_WHATSAPP_APP_SECRET,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TEST_WHATSAPP_VERIFY_TOKEN,
      // WA-04: a key pair made for this run (e2e/flows.ts), so tests seal Flow screens as Meta.
      WHATSAPP_FLOW_PRIVATE_KEY: testFlowPrivateKey(),
      WHATSAPP_BOOKING_FLOW_ID: TEST_BOOKING_FLOW_ID,
      WHATSAPP_FLOW_MODE: 'draft',
    },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
