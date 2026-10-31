import { createClient } from '@supabase/supabase-js';
import { createDb } from '../client';
import { DemoSetupError } from './context';
import { DemoRefusedError, demoPatientCount, fillDemo, TRIGGERS_REFUSED } from './fill';
import { demoTarget } from './guard';
import { canSwitchTriggers, removeDemo } from './remove';
import { systemActor, withActor } from '../audit';

// `pnpm demo:fill` and `pnpm demo:remove` (docs/runbooks/demo-data.md), through
// scripts/demo-data.mjs: generated demo patients on the local stack or staging, never anywhere
// else. Prints counts only, never an address, a secret or a name.
const action = process.argv[2];
if (action !== 'fill' && action !== 'remove') throw new Error('Say fill or remove.');
const checked = demoTarget(process.env);
if ('refused' in checked) {
  console.error(`Refused: ${checked.refused}`);
  process.exit(1);
}
const { target } = checked;
const url = process.env.DIRECT_DATABASE_URL ?? '';
const { db, close } = createDb(url, { max: 1 });
try {
  if (action === 'fill') {
    const started = Date.now();
    const counts = await fillDemo(db);
    console.log(`Demo data on ${target}:`, JSON.stringify(counts, null, 2));
    console.log(
      `${await demoPatientCount(db)} demo patients in all; took ${Math.round((Date.now() - started) / 1000)} s.`,
    );
  } else {
    if (!(await canSwitchTriggers(db))) throw new DemoRefusedError(TRIGGERS_REFUSED);
    const { files, ...counts } = await withActor(db, systemActor('demo'), (tx) => removeDemo(tx));
    console.log(`Demo data removed from ${target}:`, JSON.stringify(counts, null, 2));
    console.log(await removeFiles(files));
  }
} catch (error) {
  if (error instanceof DemoRefusedError || error instanceof DemoSetupError) {
    console.error(`Refused: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await close();
}

/** Takes the removed documents' files out of the private `documents` bucket. */
async function removeFiles(files: string[]): Promise<string> {
  if (files.length === 0) return 'No document files to remove.';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return `${String(files.length)} document files left in storage (no SUPABASE_URL or service key).`;
  }
  const storage = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from('documents');
  let removed = 0;
  for (let i = 0; i < files.length; i += 100) {
    const { data, error } = await storage.remove(files.slice(i, i + 100));
    if (error) return `${String(removed)} document files removed; storage refused the rest.`;
    removed += data.length;
  }
  return `${String(removed)} document files removed from storage.`;
}
