import 'server-only';
import {
  conditionsWithoutPatientContent,
  insertAiPatientContentDraft,
  liveKbVersionId,
  regionPhases,
  type Db,
} from '@clinic-mx/db';
import {
  aiPatientContentInputSchema,
  aiTaskConfigSchema,
  namesBlockedProvider,
  patientContentDraftSchema,
  patientContentInput,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { writePatientContent } from './gateway';
import { outboundAllowed, textsOf } from './gateway/guard';
import type { AiTransport } from './gateway/transport';

/**
 * Writes patient content drafts with AI, once (AI-07; TAD section 7: "One time patient content |
 * Best available, once | Reviewed and approved by clinicians before use"). An operator runs it
 * from the command line (`pnpm ai:patient-content`) with the model and its pinned hosts. Each
 * condition of the live knowledge base version with neither a draft nor approved content gets one
 * call, sent only that condition's own knowledge base text and its region's phases; a valid answer
 * becomes a draft written by the server (source `ai`), which a consultant who treats patients
 * reads, edits and approves before any patient sees it. Nothing a clinician wrote is ever touched.
 * Every call goes through the gateway: zero data retention, pinning, the identifier guard, logged
 * to `ai_run`, counted against its own budget (`ai.patient_content_budget_paise`), never the daily
 * cap; at the budget the run stops, and running again carries on with what is left.
 */
export class PatientContentGenerationError extends Error {
  override name = 'PatientContentGenerationError';
}

export interface GenerationOptions {
  model: string;
  providers: readonly string[];
  /** Only these conditions (stable IDs); all that need content when absent. */
  conditions?: readonly string[];
  /** At most this many calls. */
  limit?: number;
  /** Checks what would be sent, and calls no model. */
  dryRun?: boolean;
  transport?: AiTransport | null;
  log?: (line: string) => void;
}

export interface GenerationResult {
  /** Conditions that needed content when the run started (after `conditions`). */
  needed: number;
  /** Drafts written; in a dry run, conditions whose input passed every check. */
  written: number;
  /** Calls with no valid answer; those conditions stay without content. */
  unavailable: number;
  /** A clinician started a draft meanwhile; never overwritten. */
  skipped: number;
  /** The budget was reached and the run stopped. */
  capped: boolean;
}

const saveDraft = systemService({
  component: 'ai',
  input: patientContentDraftSchema,
  run: (tx, draft) => insertAiPatientContentDraft(tx, draft),
});

export async function generatePatientContent(
  db: Db,
  options: GenerationOptions,
): Promise<GenerationResult> {
  const kbVersionId = await liveKbVersionId(db);
  if (!kbVersionId) throw new PatientContentGenerationError('No knowledge base is imported yet.');
  const config = aiTaskConfigSchema
    .extend({ model: z.string(), providers: z.array(z.string().min(1)).min(1).max(3) })
    .safeParse({
      ...(await getSetting('ai.task_write_patient_content')),
      model: options.model,
      providers: [...options.providers],
    });
  if (!config.success) {
    throw new PatientContentGenerationError('Name an OpenRouter model and one to three hosts.');
  }
  if (namesBlockedProvider(config.data.providers, await getSetting('ai.blocked_providers'))) {
    throw new PatientContentGenerationError('That host is a blocked provider.');
  }

  let conditions = await conditionsWithoutPatientContent(db, kbVersionId);
  if (options.conditions) {
    const wanted = new Set(options.conditions);
    const found = new Set(conditions.map((c) => c.conditionId));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new PatientContentGenerationError(
        `Not in the live knowledge base, or already has content: ${missing.join(', ')}.`,
      );
    }
    conditions = conditions.filter((c) => wanted.has(c.conditionId));
  }
  const result: GenerationResult = {
    needed: conditions.length,
    written: 0,
    unavailable: 0,
    skipped: 0,
    capped: false,
  };
  const phases = await regionPhases(db, kbVersionId);
  const log = options.log ?? (() => undefined);

  for (const condition of conditions.slice(0, options.limit ?? conditions.length)) {
    const input = patientContentInput(condition, phases[condition.region] ?? []);
    if (options.dryRun) {
      const sendable =
        aiPatientContentInputSchema.safeParse(input).success && outboundAllowed(textsOf(input));
      if (sendable) result.written += 1;
      else result.unavailable += 1;
      continue;
    }
    const answer = await writePatientContent(db, {
      kbVersionId,
      input,
      config: config.data,
      transport: options.transport,
    });
    if (answer.status === 'unavailable') {
      if (answer.reason === 'capped') {
        result.capped = true;
        break;
      }
      result.unavailable += 1;
      if (answer.reason === 'not_configured') {
        throw new PatientContentGenerationError('Set OPENROUTER_API_KEY first.');
      }
      continue;
    }
    const saved = await saveDraft(db, { conditionId: condition.conditionId, ...answer.output });
    if (saved) result.written += 1;
    else result.skipped += 1;
    log(
      `${String(result.written + result.unavailable + result.skipped)} of ${String(result.needed)}`,
    );
  }
  return result;
}
