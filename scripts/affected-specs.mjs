/* eslint-disable security/detect-non-literal-fs-filename -- reads only files of this repository. */
// Which browser tests a change needs, for `pnpm ci:quick` (docs/runbooks/local-gate.md). Prints
// "full: why" when only the whole suite is safe, or the spec files, one per line, or nothing when
// no browser test can be affected. Anything it cannot place asks for the whole suite: a guess
// never skips a test.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Always run: signing in, the menus, access, and the look of every page's frame. */
export const alwaysRun = [
  'smoke.spec.ts',
  'navigation.spec.ts',
  'permissions.spec.ts',
  'design.spec.ts',
];

/** Above this many specs a change touches nearly everything, so run it all. */
const TOO_MANY_SPECS = 40;

const noBrowserEffect = /^docs\/|\.md$|\.test\.tsx?$|^\.github\/|^LICENSE|^scripts\/affected-specs/;

/** Whatever every page or test stands on. */
const everythingStandsOn = [
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /(^|\/)package\.json$/,
  /^supabase\//,
  /^packages\/db\//,
  /^packages\/schemas\//,
  /^packages\/ui\/src\/(styles|cn|token|index)/,
  /^scripts\//,
  /^apps\/web\/(lib|public)\//,
  /^apps\/web\/(proxy|next\.config|playwright\.config|instrumentation|sentry)/,
  /^apps\/web\/modules\/(auth|access|settings|navigation)\//,
  /^apps\/web\/app\/layout\.tsx$/,
  /^apps\/web\/app\/\(staff\)\/app\/\(signed-in\)\/[^/]*\.tsx$/,
  /^apps\/web\/e2e\/(?!.*\.spec\.ts$)/,
  /^apps\/web\/components\/(side-nav|nav-shell|nav-icons|phone-tab-bar|person-menu|forms|tag)\b/,
];

const staffArea = /^apps\/web\/app\/\(staff\)\/app\/\(signed-in\)\/([^/]+)\//;
const patientPage = /^apps\/web\/app\/\(patient\)\//;
const authPage = /^apps\/web\/app\/\(staff\)\/app\/\(auth\)\//;
const importable =
  /^(apps\/web\/(components|modules)|apps\/web\/app|packages\/ui\/src\/components)\/.*\.tsx?$/;

const noExtension = (path) => path.replace(/\.tsx?$/, '');
const importPattern = /(?:from\s+|import\(\s*|^import\s+)['"]([^'"]+)['"]/gm;

/** The source path an import names, without its extension, or null for a package. */
function importedPath(importer, name) {
  const kit = '@clinic-mx/ui/components/';
  if (name.startsWith(kit)) return `packages/ui/src/components/${name.slice(kit.length)}`;
  if (!name.startsWith('.')) return null;
  return noExtension(posix.normalize(posix.join(posix.dirname(importer), name)));
}

/** Every file's importers, from the imports it really has. */
function importersOf(sources) {
  const importers = new Map();
  for (const [path, text] of sources) {
    for (const match of text.matchAll(importPattern)) {
      const target = importedPath(path, match[1]);
      if (target) importers.set(target, [...(importers.get(target) ?? []), path]);
    }
  }
  return importers;
}

/** The pages a source file reaches through what imports it, directly or not. */
function pagesReaching(file, importers) {
  const seen = new Set([file]);
  const queue = [file];
  while (queue.length > 0) {
    const current = noExtension(queue.shift());
    for (const path of [
      ...(importers.get(current) ?? []),
      ...(importers.get(current.replace(/\/index$/, '')) ?? []),
    ]) {
      if (!seen.has(path)) {
        seen.add(path);
        queue.push(path);
      }
    }
  }
  return [...seen].filter((path) => staffArea.test(path) || patientPage.test(path));
}

function specsForPage(path, specs) {
  if (patientPage.test(path)) {
    return [...specs].filter(([, text]) => text.includes('/p/')).map(([name]) => name);
  }
  const area = staffArea.exec(path)?.[1];
  if (!area || area.startsWith('(')) return [];
  // A folder is often the plural of its spec: consultations, consultation.spec.ts.
  const stem = area.replace(/s$/, '');
  return [...specs]
    .filter(([name, text]) => name.startsWith(stem) || text.includes(`/app/${area}`))
    .map(([name]) => name);
}

/**
 * @param changed files changed, relative to the repository root, with forward slashes
 * @param specs Map of spec file name to its text
 * @param sources Map of source path to its text, for following imports
 * @returns {{ full: string } | { specs: string[] }}
 */
export function selectSpecs(changed, specs, sources) {
  const files = changed.filter((file) => !noBrowserEffect.test(file));
  if (files.length === 0) return { specs: [] };
  const chosen = new Set(alwaysRun);
  const importers = importersOf(sources);
  for (const file of files) {
    if (/^apps\/web\/e2e\/[^/]+\.spec\.ts$/.test(file)) {
      chosen.add(basename(file));
      continue;
    }
    if (/^apps\/web\/e2e\/__screenshots__\//.test(file)) {
      const spec = file.split('/').find((part) => part.endsWith('.spec.ts'));
      if (spec) chosen.add(spec);
      continue;
    }
    if (everythingStandsOn.some((pattern) => pattern.test(file))) return { full: file };
    if (authPage.test(file)) {
      chosen.add('auth.spec.ts');
      chosen.add('two-step.spec.ts');
      continue;
    }
    if (!importable.test(file)) return { full: file };
    const pages = pagesReaching(file, importers);
    const found = pages.flatMap((page) => specsForPage(page, specs));
    if (found.length === 0) return { full: `no test found for ${file}` };
    for (const name of found) chosen.add(name);
  }
  if (chosen.size > TOO_MANY_SPECS) return { full: `${String(chosen.size)} specs affected` };
  return { specs: [...chosen].filter((name) => specs.has(name)).sort() };
}

function readTree(root, keep, into = new Map()) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', 'test-results', '__screenshots__'].includes(entry.name)) {
        readTree(path, keep, into);
      }
    } else if (keep.test(path)) {
      into.set(path, readFileSync(path, 'utf8'));
    }
  }
  return into;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] ?? 'origin/main';
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const changed = [
    ...git('diff', '--name-only', `${base}...HEAD`).split('\n'),
    ...git('status', '--porcelain', '--untracked-files=all')
      .split('\n')
      .map((line) => line.slice(3)),
  ].filter(Boolean);
  const e2e = 'apps/web/e2e';
  const specs = new Map(
    readdirSync(e2e)
      .filter((name) => name.endsWith('.spec.ts'))
      .map((name) => [name, readFileSync(join(e2e, name), 'utf8')]),
  );
  const keep = /\.tsx?$/;
  const sources = new Map();
  for (const root of [
    'apps/web/app',
    'apps/web/components',
    'apps/web/modules',
    'packages/ui/src/components',
  ]) {
    readTree(root, keep, sources);
  }
  const result = selectSpecs([...new Set(changed)], specs, sources);
  if ('full' in result) console.log(`full: ${result.full}`);
  else if (result.specs.length > 0) console.log(result.specs.join('\n'));
}
/* eslint-enable security/detect-non-literal-fs-filename -- end of the file reads */
