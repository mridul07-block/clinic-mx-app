import { defineProject } from 'vitest/config';

// `pnpm --filter @clinic-mx/db test:integration`: tests against the database at
// DIRECT_DATABASE_URL, one file at a time because they share it.
export default defineProject({
  test: {
    name: 'db-integration',
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    fileParallelism: false,
  },
});
