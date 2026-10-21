import { createDb } from '../client';
import { parseSeedTarget, seed } from './seed';

// `pnpm db:seed`: seeds the database at DIRECT_DATABASE_URL. Prints counts only, never the URL.
const target = parseSeedTarget(process.env.CLINIC_MX_SEED_TARGET);
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');

const { db, close } = createDb(url, { max: 1 });
try {
  const counts = await seed(db);
  console.log(`Seeded ${target}:`, counts);
} finally {
  await close();
}
