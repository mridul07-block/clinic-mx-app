import { describe, expect, it } from 'vitest';
import { alwaysRun, selectSpecs } from './affected-specs.mjs';

const specs = new Map([
  ['smoke.spec.ts', ''],
  ['navigation.spec.ts', ''],
  ['permissions.spec.ts', ''],
  ['design.spec.ts', ''],
  ['today.spec.ts', "await page.goto('/app/today');"],
  ['check-in.spec.ts', "await page.goto('/app/today');"],
  ['prices.spec.ts', "await page.goto('/app/prices');"],
  ['my-plan.spec.ts', "await page.goto('/p/abc');"],
  ['auth.spec.ts', ''],
  ['two-step.spec.ts', ''],
]);
const area = 'apps/web/app/(staff)/app/(signed-in)';
const sources = new Map([
  [`${area}/today/page.tsx`, "import { loadToday } from '../../modules/front-desk/today';"],
  ['apps/web/modules/front-desk/today.ts', "import { x } from './helper';"],
  ['apps/web/modules/front-desk/helper.ts', ''],
  ['apps/web/components/orphan.tsx', ''],
]);
const pick = (...changed) => selectSpecs(changed, specs, sources);

// `pnpm ci:quick`: a change runs what it can reach, and anything unsure runs everything.
describe('which browser tests a change needs', () => {
  it('needs none for documents and unit tests', () => {
    expect(pick('docs/runbooks/auth.md', 'apps/web/modules/x.test.ts')).toEqual({ specs: [] });
  });

  it('runs the page’s specs, and the ones every run needs', () => {
    expect(pick(`${area}/prices/page.tsx`)).toEqual({
      specs: [...alwaysRun, 'prices.spec.ts'].sort(),
    });
  });

  it('follows imports from a module to the pages using it', () => {
    const result = pick('apps/web/modules/front-desk/helper.ts');
    expect(result).toEqual({ specs: [...alwaysRun, 'check-in.spec.ts', 'today.spec.ts'].sort() });
  });

  it('runs a changed spec, and the spec of a changed screenshot', () => {
    expect(pick('apps/web/e2e/prices.spec.ts')).toEqual({
      specs: [...alwaysRun, 'prices.spec.ts'].sort(),
    });
    expect(pick('apps/web/e2e/__screenshots__/win32/phone/today.spec.ts/a.png')).toEqual({
      specs: [...alwaysRun, 'today.spec.ts'].sort(),
    });
  });

  it('runs sign in specs for the sign in pages', () => {
    const result = pick('apps/web/app/(staff)/app/(auth)/sign-in/page.tsx');
    expect(result).toEqual({ specs: [...alwaysRun, 'auth.spec.ts', 'two-step.spec.ts'].sort() });
  });

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'supabase/migrations/1_x.sql',
    'packages/db/src/schema/x.ts',
    'packages/schemas/src/permissions.ts',
    'packages/ui/src/styles/theme.css',
    'apps/web/lib/env.ts',
    'apps/web/proxy.ts',
    'apps/web/modules/auth/session.ts',
    `${area}/layout.tsx`,
    'apps/web/e2e/staff.ts',
    'apps/web/components/side-nav.tsx',
  ])('runs everything for %s, which everything stands on', (file) => {
    expect(pick(file)).toEqual({ full: file });
  });

  it('runs everything when it cannot place a file or find its test', () => {
    expect(pick('something/new.txt')).toEqual({ full: 'something/new.txt' });
    expect(pick('apps/web/components/orphan.tsx')).toEqual({
      full: 'no test found for apps/web/components/orphan.tsx',
    });
  });

  it('runs everything when a change reaches too many specs', () => {
    const many = new Map([
      ...specs,
      ...Array.from({ length: 45 }, (_, index) => [`area${String(index)}.spec.ts`, "'/app/today'"]),
    ]);
    const result = selectSpecs([`${area}/today/page.tsx`], many, sources);
    expect(result).toHaveProperty('full');
  });
});
