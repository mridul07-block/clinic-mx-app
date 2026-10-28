import type { HealthFormAnswers, PatientSex, ScreeningRegion } from '@clinic-mx/schemas';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { episode, intakeResponse, patient } from './schema';
import type { DbOrTransaction } from './versioned';

/** What the preparation sheet's candidate filter reads for an episode (AI-02). */
export interface EpisodeCandidateInput {
  /** Only so the patient's own past episodes are never their similar cases (AI-05). */
  patientId: string;
  answers: HealthFormAnswers;
  dateOfBirth: string | null;
  sex: PatientSex | null;
  bodyRegion: ScreeningRegion | null;
}

/**
 * The episode's latest submitted health form, with the date of birth, sex and body region on file
 * for answers the form did not ask (AI-02). Read only; undefined when nothing is submitted.
 */
export async function episodeCandidateInput(
  db: DbOrTransaction,
  episodeId: string,
): Promise<EpisodeCandidateInput | undefined> {
  const [row] = await db
    .select({
      patientId: episode.patientId,
      answers: intakeResponse.answers,
      dateOfBirth: patient.dateOfBirth,
      sex: patient.sex,
      bodyRegion: episode.bodyRegion,
    })
    .from(intakeResponse)
    .innerJoin(episode, eq(episode.id, intakeResponse.episodeId))
    .innerJoin(patient, eq(patient.id, episode.patientId))
    .where(and(eq(intakeResponse.episodeId, episodeId), isNotNull(intakeResponse.submittedAt)))
    .orderBy(desc(intakeResponse.submittedAt))
    .limit(1);
  return row;
}
