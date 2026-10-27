import 'server-only';
import {
  baselineVersionOfEpisode,
  episodeRecord,
  finalTestOfEpisode,
  finalTestReadings,
  logClinicalView,
  patientRecord,
  reassessmentOfEpisode,
  recordFinalTest,
  staffTreatsNow,
  type DbOrTransaction,
  type EpisodeEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  finalTestSchema,
  reassessmentBlockers,
  reassessmentRecordings,
  takesFinalTest,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaffViewing } from '../access/staff-db';
import { dischargeView, type DischargeView } from './discharge';
import { ReviewError } from './errors';
import { readinessView, worksReadiness, type ReadinessView } from './readiness';
import {
  reassessedItems,
  reassessedRows,
  retestRows,
  type ReassessedItem,
  type ReassessedRow,
} from '../sessions/reassessment';

/**
 * The episode's Review and discharge screen (Frontend Specification "Physiotherapist"; OUT-07 adds
 * final testing, PRD J6.2; user decisions 27 October 2026): exactly the frozen baseline's measures
 * (OUT-01), with the session 4 reassessment's readings (OUT-05) beside them, retested once and
 * signed as written by anyone with the Consultant tick while the episode is Active or Under
 * review; OUT-10 discharges any episode from here. Read by clinicians (row level security); each
 * open is logged as a record view.
 */

export { ReviewError };

/** A baseline measure to retest, with what session 4 read. */
export interface ReviewItem extends ReassessedItem {
  session: string | null;
  sessionNotTested: string | null;
}

/** A baseline measure once retested: baseline, session 4, final, and the change to final. */
export type FinalTestRow = ReassessedRow & {
  session: string | null;
  sessionNotTested: string | null;
};

export interface ReviewScreen {
  episode: EpisodeEntry;
  patient: { id: string; name: string; opNumber: string };
  /** The reassessment session's number, when one was recorded. */
  sessionNumber: number | null;
  items: ReviewItem[];
  /** Once signed. */
  finalTest: { rows: FinalTestRow[]; by: string; at: Date } | null;
  /** Unsigned, with a baseline, the episode treated, and the reader signs as a consultant. */
  signs: boolean;
  /** OUT-08: the readiness panel and clearances; undefined before a region has criteria. */
  readiness: ReadinessView | undefined;
  /** The reader marks, overrides, records and signs on the panel. */
  worksReadiness: boolean;
  /** OUT-10: the discharge form; undefined once the episode is discharged. */
  discharge: DischargeView | undefined;
}

/** Final testing as it stands: the baseline items with session 4 beside them, and once signed. */
export interface FinalTesting {
  sessionNumber: number | null;
  items: ReviewItem[];
  finalTest: ReviewScreen['finalTest'];
}

/** The episode's final testing (OUT-07); the screen and the discharge report (OUT-11) read it. */
export async function finalTestingOf(
  tx: DbOrTransaction,
  episodeId: string,
): Promise<FinalTesting> {
  const version = await baselineVersionOfEpisode(tx, episodeId);
  const baseline = version ? await reassessedItems(tx, episodeId, version) : [];
  const reassessed = await reassessmentOfEpisode(tx, episodeId);
  const sessionRows = reassessed
    ? await reassessedRows(tx, baseline, reassessed.sessionId, reassessed.notTested)
    : [];
  const items = baseline.map((item): ReviewItem => {
    const row = sessionRows.find((r) => r.measure.key === item.measure.key);
    return { ...item, session: row?.now ?? null, sessionNotTested: row?.nowNotTested ?? null };
  });
  const signed = await finalTestOfEpisode(tx, episodeId);
  const readings = signed
    ? await finalTestReadings(
        tx,
        signed.id,
        items.map((item) => item.measure.key),
      )
    : [];
  return {
    sessionNumber: reassessed?.sessionNumber ?? null,
    items,
    finalTest: signed
      ? {
          rows: retestRows(items, readings, signed.notTested).map((row, index) => ({
            ...row,
            session: items[index]?.session ?? null,
            sessionNotTested: items[index]?.sessionNotTested ?? null,
          })),
          by: signed.signedByName,
          at: signed.signedAt,
        }
      : null,
  };
}

export async function loadReview(
  actor: StaffMember,
  episodeId: string,
): Promise<ReviewScreen | undefined> {
  if (!can(actor, 'clinical.read')) throw new NotAllowedError();
  return asStaffViewing(actor, async (tx) => {
    const episode = await episodeRecord(tx, episodeId);
    if (!episode) return undefined;
    const patient = await patientRecord(tx, episode.patientId);
    if (!patient) return undefined;
    const { sessionNumber, items, finalTest } = await finalTestingOf(tx, episodeId);
    await logClinicalView(tx, 'patient', patient.id);
    return {
      episode,
      patient: { id: patient.id, name: patient.name, opNumber: patient.opNumber },
      sessionNumber,
      items,
      finalTest,
      signs:
        !finalTest &&
        items.length > 0 &&
        takesFinalTest(episode.status) &&
        can(actor, 'consultant_records.sign'),
      readiness: await readinessView(tx, episodeId),
      worksReadiness: worksReadiness(actor, episode.status),
      discharge: await dischargeView(tx, actor, episode),
    };
  });
}

/**
 * Signs the episode's final testing as written, with the Consultant and Treats patients ticks
 * read now: each baseline measure recorded, both sides where paired, or Not tested with a reason.
 * Once per episode; never changed.
 */
export const signFinalTest = staffService({
  action: 'consultant_records.sign',
  input: finalTestSchema,
  run: async (tx, input, actor): Promise<{ status: 'signed' }> => {
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new ReviewError('Signing needs the Treats patients tick.');
    }
    const episode = await episodeRecord(tx, input.episodeId);
    if (!episode) throw new ReviewError('That episode was not found.');
    if (!takesFinalTest(episode.status)) {
      throw new ReviewError('Final testing is for an Active or Under review episode.');
    }
    if (await finalTestOfEpisode(tx, input.episodeId)) {
      throw new ReviewError('Final testing is signed already.');
    }
    const version = await baselineVersionOfEpisode(tx, input.episodeId);
    if (!version) throw new ReviewError('This episode has no baseline to retest.');
    const measures = (await reassessedItems(tx, input.episodeId, version)).map(
      (item) => item.measure,
    );
    const blockers = reassessmentBlockers(input.entries, measures);
    if (blockers.length > 0) throw new ReviewError(blockers.join(' '));
    const { readings, notTested } = reassessmentRecordings(input.entries, measures);
    await recordFinalTest(tx, {
      episodeId: input.episodeId,
      kbVersionId: version,
      by: actor.id,
      readings,
      notTested,
    });
    return { status: 'signed' };
  },
});
