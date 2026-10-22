import { createDb } from '../client';
import { AlreadyImportedError, applyKnowledge } from './apply';
import { buildKnowledge, KnowledgeImportError } from './build';
import { readConditionIds, WORKBOOK_FOLDER_PATH, writeConditionIds, writeReport } from './paths';
import { buildReport, reportMarkdown } from './report';
import { readWorkbooks } from './workbook';

// `pnpm kb:import`: reads the nine workbooks, checks them and writes the import report (no
// database). `--assign` gives new rows IDs in the ID file; `--apply` records the result as the next
// knowledge base version, a draft, at DIRECT_DATABASE_URL. Prints counts only, never a URL.
// See docs/runbooks/knowledge-base.md.

const args = new Set(process.argv.slice(2));
const assign = args.has('--assign');
const apply = args.has('--apply');

try {
  const workbooks = await readWorkbooks(WORKBOOK_FOLDER_PATH);
  const built = buildKnowledge(workbooks, await readConditionIds(), { assign });
  if (assign) await writeConditionIds(built.ids);
  const report = buildReport(workbooks, built);
  await writeReport(reportMarkdown(report));
  console.log(
    `Read ${report.totals.listings} rows: ${report.totals.conditions} conditions, ` +
      `${report.totals.merged} merged; ${built.assigned.length} IDs assigned; ` +
      `${built.unmatched.length} IDs matched no row. Report: docs/knowledge-base/import-report.md`,
  );

  if (apply) {
    const url = process.env.DIRECT_DATABASE_URL;
    if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
    const { db, close } = createDb(url, { max: 1 });
    try {
      const version = await db.transaction((tx) => applyKnowledge(tx, built, report));
      console.log(`Recorded knowledge base version ${version.number} as a draft.`);
    } finally {
      await close();
    }
  }
} catch (error) {
  if (error instanceof KnowledgeImportError || error instanceof AlreadyImportedError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
