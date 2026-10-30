import 'server-only';
import {
  canDisposeSheet,
  claimRecheck,
  consultationRecord,
  episodeNameWords,
  finishRecheck,
  knowledgeListings,
  knowledgeObjective,
  sheetForEpisode,
  type Db,
  type PreparationSheet,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  consultationSectionsSchema,
  recheckFindings,
  recordVersionSchema,
  validateRanking,
  type AiSheetUnavailableReason,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { settingsDb } from '../../lib/db';
import { staffService, systemService, type ServiceContext } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';
import { aiSheetPass, type AiSheetPass } from './gate';
import { recheckWithFindings } from './gateway';
import type { AiTransport } from './gateway/transport';
import { rowsFor } from './preparation-sheet';
import { AiSheetError } from './sheet';

/**
 * "Recheck with findings" (AI-04; PRD J3.5: "reranks the AI suggestions on demand"; TAD section 7:
 * steps 5 to 7 again "with the examination results, only when tapped"). The visit's consultant
 * taps it in their own unsigned consultation; the sheet's shortlist and must rule out stay as they
 * are, and the model ranks them again with the examination findings (special tests and measures in
 * the knowledge base's words, never free text). The recheck is its own run, kept beside the first
 * ranking; its suggestions are kept or dismissed on the sheet like the first. Behind the AI gate
 * (AI-09); never blocks the consultation. Recommended defaults chosen under the user's standing
 * approval, 29 October 2026 (DECISION AI-04).
 */
export type RecheckOutcome = 'ready' | 'unavailable' | 'busy' | 'already' | 'superseded';

const recheckInput = z.strictObject({
  consultationId: z.guid({ error: 'That consultation was not found.' }),
  baseVersion: recordVersionSchema,
});

interface Prepared {
  pass: AiSheetPass;
  episodeId: string;
  sheet: PreparationSheet;
  findings: string[];
}

/** Everything a recheck needs, checked as the consultant under row level security. */
const prepareRecheck = staffService({
  action: 'ai_prep.use',
  input: recheckInput,
  target: async (input, tx) => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found) throw new AiSheetError('That consultation was not found.');
    return { centreId: found.centreId, ownerId: found.physioId };
  },
  run: async (tx, input, actor): Promise<Prepared> => {
    const pass = await aiSheetPass(settingsDb());
    if (!pass) throw new AiSheetError('The AI preparation sheet is switched off.');
    const found = await consultationRecord(tx, input.consultationId);
    if (!found || found.physioId !== actor.id || found.status === 'signed') {
      throw new AiSheetError('Only the consultant of an unsigned consultation rechecks.');
    }
    if (found.version !== input.baseVersion) {
      throw new AiSheetError('Your latest changes are still saving. Try again.');
    }
    const sheet = await sheetForEpisode(tx, found.episodeId);
    if (!sheet?.case || sheet.shortlist.items.length === 0) {
      throw new AiSheetError('This episode has no preparation sheet to recheck.');
    }
    if (!(await canDisposeSheet(tx, sheet.id))) {
      throw new AiSheetError(
        'Only the consultant of the visit rechecks, until the consultation is signed.',
      );
    }
    if (pass.kbVersionId !== sheet.kbVersionId || found.kbVersionId !== sheet.kbVersionId) {
      throw new AiSheetError('The knowledge base changed since the sheet was made.');
    }
    const objective = consultationSectionsSchema.parse(found.sections).objective;
    const findings = recheckFindings(objective, await knowledgeObjective(tx, found.kbVersionId));
    if (findings.length === 0) {
      throw new AiSheetError('Record a special test result or a measure first.');
    }
    return { pass, episodeId: found.episodeId, sheet, findings };
  },
});

const claim = systemService({
  component: 'ai',
  input: z.custom<Parameters<typeof claimRecheck>[1]>(),
  run: (tx, recheck) => claimRecheck(tx, recheck),
});

const finish = systemService({
  component: 'ai',
  input: z.custom<{
    claim: Parameters<typeof finishRecheck>[1];
    result: Parameters<typeof finishRecheck>[2];
  }>(),
  run: (tx, { claim: held, result }) => finishRecheck(tx, held, result),
});

/** Reranks the sheet with the consultation's findings; never throws for the model. */
export async function recheckConsultation(
  context: ServiceContext,
  rawInput: unknown,
  options: { transport?: AiTransport | null } = {},
): Promise<RecheckOutcome> {
  const prepared = await prepareRecheck(context, rawInput);
  const db: Db = context.db;
  const { sheet, findings, episodeId } = prepared;
  const held = await claim(db, {
    sheetId: sheet.id,
    findings,
    by: context.actor.id,
    retryAfterSeconds: await getSetting('ai.sheet_retry_after_seconds'),
  });
  if (!held) {
    // Read again: another tap may have taken it since this one looked.
    const now = await sheetForEpisode(db, episodeId);
    return now?.recheck?.status === 'pending' ? 'busy' : 'already';
  }
  const done = async (result: Parameters<typeof finishRecheck>[2]): Promise<RecheckOutcome> =>
    (await finish(db, { claim: { sheetId: sheet.id, claimedAt: held.claimedAt }, result }))
      ? result.status
      : 'superseded';
  try {
    return await rerank(db, prepared, options, done);
  } catch (error) {
    // Never leave the claim held: the consultant can tap again at once.
    await done({ status: 'unavailable', reason: 'failed', aiRunId: null }).catch(() => undefined);
    throw error;
  }
}

async function rerank(
  db: Db,
  { pass, sheet, findings, episodeId }: Prepared,
  options: { transport?: AiTransport | null },
  done: (result: Parameters<typeof finishRecheck>[2]) => Promise<RecheckOutcome>,
): Promise<RecheckOutcome> {
  // The sheet's own shortlist, numbered as the sheet sent it.
  const rows = rowsFor(sheet.shortlist, await knowledgeListings(db, sheet.kbVersionId));
  const items = sheet.shortlist.items.filter((item) =>
    rows.some((row) => row.conditionId === item.conditionId),
  );
  if (!sheet.case) return done({ status: 'unavailable', reason: 'no_region', aiRunId: null });
  const counts = {
    top: await getSetting('ai.sheet_top_count'),
    alsoConsider: await getSetting('ai.sheet_also_consider_count'),
  };
  const result = await recheckWithFindings(db, pass, {
    case: sheet.case,
    rows,
    limit: counts.top + counts.alsoConsider,
    episodeId,
    findings,
    // The sheet's own similar cases (AI-05), as it sent them: steps 5 to 7 only run again.
    similar: sheet.similar ?? [],
    forbidden: await episodeNameWords(db, episodeId),
    transport: options.transport,
  });
  if (result.status !== 'ok') {
    const reason: AiSheetUnavailableReason = result.reason;
    return done({ status: 'unavailable', reason, aiRunId: result.runId });
  }
  const suggestions = validateRanking(items, result.output, counts);
  if (suggestions.length === 0) {
    return done({ status: 'unavailable', reason: 'no_valid_suggestions', aiRunId: result.runId });
  }
  return done({ status: 'ready', aiRunId: result.runId, suggestions });
}

/** The latest recheck as the consultation shows it: the knowledge base names, plain values. */
export interface RecheckView {
  status: 'pending' | 'ready' | 'unavailable';
  /** A pending recheck whose run stopped: the consultant may tap again. */
  stopped: boolean;
  findings: string[];
  readyAt: string | null;
  suggestions: {
    id: string;
    rank: number;
    section: 'top' | 'also_consider';
    name: string;
    reason: string;
  }[];
}

/** The recheck panel for a consultation: null unless its consultant may recheck it now. */
export async function loadRecheck(
  actor: StaffMember,
  consultationId: string,
): Promise<{ recheck: RecheckView | null; sheetHref: string } | null> {
  if (!can(actor, 'ai_prep.use') || actor.support) return null;
  const pass = await aiSheetPass(settingsDb());
  if (!pass) return null;
  const retryAfterSeconds = await getSetting('ai.sheet_retry_after_seconds');
  return asStaff(actor, async (tx) => {
    const found = await consultationRecord(tx, consultationId);
    if (!found || found.physioId !== actor.id || found.status === 'signed') return null;
    const sheet = await sheetForEpisode(tx, found.episodeId);
    if (!sheet?.case || sheet.shortlist.items.length === 0) return null;
    if (!(await canDisposeSheet(tx, sheet.id))) return null;
    // A recheck would be refused once the knowledge base moved on (prepareRecheck).
    if (pass.kbVersionId !== sheet.kbVersionId || found.kbVersionId !== sheet.kbVersionId) {
      return null;
    }
    const names = new Map(
      (await knowledgeListings(tx, sheet.kbVersionId)).map((l) => [
        `${l.conditionId}:${l.region}:${String(l.rowNumber)}`,
        l.name,
      ]),
    );
    const recheck = sheet.recheck;
    return {
      sheetHref: `/app/episodes/${found.episodeId}/preparation-sheet`,
      recheck: recheck
        ? {
            status: recheck.status,
            stopped:
              recheck.status === 'pending' &&
              Date.now() - recheck.claimedAt.getTime() > retryAfterSeconds * 1000,
            findings: recheck.findings,
            readyAt: recheck.readyAt?.toISOString() ?? null,
            suggestions: recheck.suggestions.map((s) => ({
              id: s.id,
              rank: s.rank,
              section: s.section,
              name:
                names.get(`${s.conditionId}:${s.region}:${String(s.rowNumber)}`) ?? s.conditionId,
              reason: s.reason,
            })),
          }
        : null,
    };
  });
}
