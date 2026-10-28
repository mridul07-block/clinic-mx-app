import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { appDb } from '../lib/db';
import {
  BlindTestError,
  compareBlindTest,
  makeSheets,
  runBlindTest,
} from '../modules/ai/blind-test';

// The blind test (AI-06): `pnpm ai:blind-test <run|sheets|compare> ...`. Only counts are printed;
// cases, outputs, sheets and the key stay in the --out folder, outside the repository
// (docs/runbooks/ai-blind-test.md).
const usage = `Usage:
  pnpm ai:blind-test run --cases <file> --candidates <file> --out <folder> [--kb-version <n>] [--dry-run]
  pnpm ai:blind-test sheets --cases <file> --out <folder> --scorers <n>
  pnpm ai:blind-test compare --cases <file> --out <folder>`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      cases: { type: 'string' },
      candidates: { type: 'string' },
      out: { type: 'string' },
      'kb-version': { type: 'string' },
      scorers: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const [command] = positionals;
  // Paths are the operator's, from where they ran the command (pnpm runs this in apps/web).
  const here = process.env.INIT_CWD ?? process.cwd();
  const path = (value: string | undefined) => (value ? resolve(here, value) : undefined);
  const [cases, out, candidates] = [path(values.cases), path(values.out), path(values.candidates)];
  if (!cases || !out) throw new BlindTestError(usage);
  for (const [name, file] of [
    ['--cases', cases],
    ['--candidates', candidates],
  ] as const) {
    if (file)
      await access(file).catch(() => {
        throw new BlindTestError(`${name}: the file cannot be read.`);
      });
  }
  const db = appDb();
  if (command === 'run') {
    if (!candidates) throw new BlindTestError(usage);
    const result = await runBlindTest(db, {
      casesPath: cases,
      candidatesPath: candidates,
      outDir: out,
      kbVersionNumber: values['kb-version'] ? Number(values['kb-version']) : undefined,
      dryRun: values['dry-run'],
      log: (line) => {
        console.log(line);
      },
    });
    if (result.capped) process.exitCode = 2;
  } else if (command === 'sheets') {
    const scorers = Number(values.scorers ?? '2');
    if (!Number.isInteger(scorers) || scorers < 1) throw new BlindTestError(usage);
    const made = await makeSheets(db, { casesPath: cases, outDir: out, scorers });
    console.log(
      `${String(made.sheets)} scoring sheets of ${String(made.rows)} rows; keep key.json from the scorers.`,
    );
  } else if (command === 'compare') {
    console.log(`Report written. ${await compareBlindTest(db, { casesPath: cases, outDir: out })}`);
  } else {
    throw new BlindTestError(usage);
  }
}

main()
  .then(() => process.exit())
  .catch((error: unknown) => {
    console.error(error instanceof BlindTestError ? error.message : 'The blind test stopped.');
    process.exit(1);
  });
