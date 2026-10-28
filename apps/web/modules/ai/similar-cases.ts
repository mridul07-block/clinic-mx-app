import 'server-only';
import { similarCasePool, type DbOrTransaction } from '@clinic-mx/db';
import {
  candidateCase,
  istDate,
  similarCases,
  type AiSimilarCase,
  type CandidateCase,
} from '@clinic-mx/schemas';
import { getSetting } from '../settings/settings';
import { outboundAllowed, textsOf } from './gateway/guard';

/**
 * The similar confirmed cases for a preparation sheet (AI-05; TAD section 7 step 4): past episodes
 * of other patients, at any centre, whose diagnosis a consultant confirmed at review or discharge,
 * each read from its own latest submitted health form (its age at that form's date) and chosen by
 * `similarCases`. Only structured fields leave; a case the identifier guard would refuse is skipped
 * for the next one rather than holding the sheet back, and fewer than the minimum means none. Read by the
 * system; recommended defaults under the user's standing approval, 29 October 2026 (DECISION AI-05).
 */
export async function findSimilarCases(
  db: DbOrTransaction,
  current: { episodeId: string; patientId: string; case: CandidateCase },
  /** The shortlist rows as numbered for the model, to give each case its row. */
  rows: readonly { conditionId: string }[],
  /** The patient's own name words: never sent. */
  forbidden: readonly string[],
): Promise<AiSimilarCase[]> {
  const pool = (await similarCasePool(db, current.patientId)).map((row) => ({
    episodeId: row.episodeId,
    patientId: row.patientId,
    case: candidateCase(row.answers, row, istDate(row.submittedAt)),
    conditionId: row.conditionId,
    conditionName: row.conditionName,
    confirmedAt: row.confirmedAt,
  }));
  return similarCases(current, pool, rows, {
    min: await getSetting('ai.similar_cases_min'),
    max: await getSetting('ai.similar_cases_max'),
    allowed: (c) => outboundAllowed(textsOf(c), forbidden),
    stage: {
      acuteWeeksBelow: await getSetting('assessment.acute_weeks_below'),
      chronicWeeksAbove: await getSetting('assessment.chronic_weeks_above'),
    },
  });
}
