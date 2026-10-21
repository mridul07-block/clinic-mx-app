import { createDb } from '../client';
import { seedLoginConfig, seedStaffLogins } from './logins';
import { parseSeedTarget, seed } from './seed';

// `pnpm db:seed`: seeds the database at DIRECT_DATABASE_URL, and staff logins when the Supabase
// URL, service role key and seed password are set. Prints counts only, never a URL or secret.
const target = parseSeedTarget(process.env.CLINIC_MX_SEED_TARGET);
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');

const { db, close } = createDb(url, { max: 1 });
try {
  const counts = await seed(db);
  const logins = seedLoginConfig(process.env);
  console.log(
    `Seeded ${target}:`,
    counts,
    typeof logins === 'string' ? logins : await seedStaffLogins(db, logins),
  );
} finally {
  await close();
}
