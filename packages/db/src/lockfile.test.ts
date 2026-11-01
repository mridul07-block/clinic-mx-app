import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// UIX-02: a new dependency can change how one of drizzle-orm's optional peers resolves, and pnpm
// then installs a second drizzle-orm. Two copies break `instanceof` and type identity between
// apps/web and packages/db. The lockfile must hold exactly one, shared by every importer.

const lockfile = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'pnpm-lock.yaml'),
  'utf8',
);

describe('pnpm-lock.yaml', () => {
  it('resolves drizzle-orm once, the same for every package that uses it', () => {
    const resolved = new Set(
      [...lockfile.matchAll(/^ {2}drizzle-orm@([^\s:]+\(.+\)):$/gm)].map(([, key]) => key),
    );
    expect([...resolved]).toHaveLength(1);

    const used = [
      ...lockfile.matchAll(/^ {6}drizzle-orm:\n {8}specifier: .+\n {8}version: (.+)$/gm),
    ].map(([, version]) => version);
    expect(used.length).toBeGreaterThanOrEqual(2);
    expect(new Set(used)).toEqual(resolved);
  });
});
