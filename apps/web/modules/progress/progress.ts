import 'server-only';
import {
  episodePainReadings,
  episodeReadings,
  episodesOf,
  exerciseTickedDays,
  knowledgeObjective,
  type EpisodeEntry,
  type ReadingSource,
  type StaffMember,
} from '@clinic-mx/db';
import {
  addDays,
  can,
  currentEpisode,
  formatIstDate,
  istDate,
  lsiBullets,
  painPoints,
  painSentence,
  weekStripDays,
  type LsiBullet,
  type PainPoint,
  type WeekStripDay,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { asStaffViewing } from '../access/staff-db';
import { phasesView, type PhasesView } from '../phases/phases';

/**
 * The patient record's Progress tab (OUT-03, PRD J5.8; user decisions 27 October 2026;
 * docs/runbooks/patient-record.md): for clinicians, the current episode's pain during activity
 * over its signed visits and a bullet graph per strength or hop LSI taken in it, against its pass,
 * with the baseline marked; the phase stepper heads it (OUT-04); the home exercise week strip
 * shows the last seven days the patient ticked on My plan (PAT-02). Read under row level security.
 */

export interface ProgressView {
  episode: EpisodeEntry | undefined;
  pain: PainPoint[];
  painSentence: string | null;
  bullets: LsiBullet[];
  phases: PhasesView | null;
  /** The last seven IST days, ending today, with any exercise ticked on My plan (PAT-02). */
  exercises: WeekStripDay[];
}

const sourceWords: Record<ReadingSource, string> = {
  consultation: 'consultation',
  session: 'session',
  final_test: 'final testing',
  readiness: 'readiness panel',
};

export async function progressOf(
  actor: StaffMember,
  patientId: string,
  now: Date = new Date(),
): Promise<ProgressView> {
  if (!can(actor, 'clinical.read')) throw new NotAllowedError();
  return asStaffViewing(actor, async (tx) => {
    const episode = currentEpisode(await episodesOf(tx, patientId));
    if (!episode) {
      return { episode, pain: [], painSentence: null, bullets: [], phases: null, exercises: [] };
    }
    const today = istDate(now);
    const first = addDays(today, -6);
    const readings = await episodePainReadings(tx, episode.id);
    const pain = painPoints(readings.consultation, readings.sessions);
    const version = readings.consultation?.kbVersionId;
    const measures = version
      ? (await knowledgeObjective(tx, version)).measures.filter((m) => m.rule.kind === 'lsi')
      : [];
    const taken = await episodeReadings(
      tx,
      episode.id,
      measures.map((m) => m.key),
    );
    const takings = new Map(
      [...taken].map(([key, { latest, first }]) => {
        const taking = (reading: typeof latest) => ({
          entry: reading.entry,
          at: reading.takenAt,
          from: `${sourceWords[reading.source]}, ${formatIstDate(istDate(reading.takenAt))}`,
        });
        return [key, { latest: taking(latest), first: taking(first) }];
      }),
    );
    const latestPain = readings.sessions
      .map((s) => ({ value: s.pain.activity, session: s.number }))
      .findLast((p): p is { value: number; session: number } => p.value !== null);
    return {
      episode,
      pain,
      painSentence: painSentence(pain),
      bullets: lsiBullets(measures, takings),
      phases: await phasesView(tx, actor, episode, latestPain ?? null),
      exercises: await (async () => {
        const ticked = await exerciseTickedDays(tx, episode.id, first, today);
        return weekStripDays(first, ticked.days, today, ticked.trackedFrom);
      })(),
    };
  });
}
