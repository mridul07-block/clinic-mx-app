import { parseArgs } from 'node:util';
import { patientContentSpend } from '@clinic-mx/db';
import { appDb } from '../lib/db';
import {
  generatePatientContent,
  PatientContentGenerationError,
} from '../modules/ai/patient-content-generation';

// Patient content written by AI, once (AI-07): `pnpm ai:patient-content --model <vendor/model>
// --provider <host> [--condition <ID> ...] [--limit <n>] [--dry-run]`. Writes drafts for the
// conditions with no content; a consultant approves each before patients see it. Only counts and
// the run's recorded cost are printed (docs/runbooks/patient-content.md).
const usage =
  'Usage: pnpm ai:patient-content --model <vendor/model> --provider <host> [--provider <host>] [--condition <ID> ...] [--limit <n>] [--dry-run]';

function options() {
  try {
    return parseArgs({
      options: {
        model: { type: 'string' },
        provider: { type: 'string', multiple: true },
        condition: { type: 'string', multiple: true },
        limit: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
    }).values;
  } catch {
    throw new PatientContentGenerationError(usage);
  }
}

async function main() {
  const values = options();
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (!values.model || (limit !== undefined && (!Number.isInteger(limit) || limit < 1))) {
    throw new PatientContentGenerationError(usage);
  }
  const db = appDb();
  const before = await patientContentSpend(db);
  const result = await generatePatientContent(db, {
    model: values.model,
    providers: values.provider ?? [],
    conditions: values.condition,
    limit,
    dryRun: values['dry-run'],
    log: (line) => {
      console.log(line);
    },
  });
  console.log(
    `${values['dry-run'] ? 'Dry run, nothing sent: ' : ''}${String(result.needed)} conditions need content; ${String(result.written)} ${values['dry-run'] ? 'ready to send' : 'drafts written'}, ${String(result.unavailable)} unavailable, ${String(result.skipped)} skipped.`,
  );
  if (result.capped) {
    console.log('Stopped at ai.patient_content_budget_paise. Raise it to carry on.');
    process.exitCode = 2;
  }
  if (result.failing) {
    console.log(
      'Stopped: too many calls in a row gave no valid answer (ai.patient_content_stop_after_failures). Check the host with pnpm ai:check.',
    );
    process.exitCode = 2;
  }
  if (!values['dry-run']) {
    // As the hosts reported it; a timed out call is billed without its cost coming back.
    const cost = Number((await patientContentSpend(db)) - before) / 1e6;
    console.log(`This run cost $${cost.toFixed(4)} as recorded.`);
  }
}

main()
  .then(() => process.exit())
  .catch((error: unknown) => {
    // Only the kind of error and its database code: never its text, which may hold content.
    const code = (error as { cause?: { code?: unknown } }).cause?.code;
    console.error(
      error instanceof PatientContentGenerationError
        ? error.message
        : `The run stopped (${error instanceof Error ? error.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}).`,
    );
    process.exit(1);
  });
