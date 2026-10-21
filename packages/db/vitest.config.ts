import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Database tests need a running Postgres; they run in CI with vitest.integration.config.ts.
    exclude: ['src/**/*.integration.test.ts'],
  },
});
