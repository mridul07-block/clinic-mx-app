import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'live-relay',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The relay's tests start it locally with wrangler (no Cloudflare account needed).
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
