import type { HealthFormAnswers, PatientSex, ScreeningRegion } from '@clinic-mx/schemas';
import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { confirmedDiagnosis, episode, intakeResponse, kbCondition, patient } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The past episodes a preparation sheet may draw similar confirmed cases from (AI-05; TAD section 7
 * step 4): every episode with a diagnosis confirmed at review or discharge, at any centre, but the
 * patient's own, each with its latest confirmation and its latest submitted health form. Read by
 * the system (`system:ai`); what leaves is chosen and stripped by `similarCases`.
 */
export interface SimilarPoolRow {
  episodeId: string;
  patientId: string;
  answers: HealthFormAnswers;
  dateOfBirth: string | null;
  sex: PatientSex | null;
  bodyRegion: ScreeningRegion | null;
  submittedAt: Date;
  conditionId: string;
  conditionName: string;
  confirmedAt: Date;
}

export async function similarCasePool(
  db: DbOrTransaction,
  exceptPatientId: string,
): Promise<SimilarPoolRow[]> {
  const confirmed = await db
    .selectDistinctOn([confirmedDiagnosis.episodeId], {
      episodeId: confirmedDiagnosis.episodeId,
      patientId: episode.patientId,
      dateOfBirth: patient.dateOfBirth,
      sex: patient.sex,
      bodyRegion: episode.bodyRegion,
      conditionId: confirmedDiagnosis.conditionId,
      conditionName: kbCondition.name,
      confirmedAt: confirmedDiagnosis.confirmedAt,
    })
    .from(confirmedDiagnosis)
    .innerJoin(episode, eq(episode.id, confirmedDiagnosis.episodeId))
    .innerJoin(patient, eq(patient.id, episode.patientId))
    .innerJoin(
      kbCondition,
      and(
        eq(kbCondition.kbVersionId, confirmedDiagnosis.kbVersionId),
        eq(kbCondition.conditionId, confirmedDiagnosis.conditionId),
      ),
    )
    .where(ne(episode.patientId, exceptPatientId))
    .orderBy(
      confirmedDiagnosis.episodeId,
      desc(confirmedDiagnosis.confirmedAt),
      desc(confirmedDiagnosis.id),
    );
  if (confirmed.length === 0) return [];
  const forms = await db
    .selectDistinctOn([intakeResponse.episodeId], {
      episodeId: intakeResponse.episodeId,
      answers: intakeResponse.answers,
      submittedAt: intakeResponse.submittedAt,
    })
    .from(intakeResponse)
    .where(
      and(
        inArray(
          intakeResponse.episodeId,
          confirmed.map((row) => row.episodeId),
        ),
        isNotNull(intakeResponse.submittedAt),
      ),
    )
    .orderBy(intakeResponse.episodeId, desc(intakeResponse.submittedAt), desc(intakeResponse.id));
  const formOf = new Map(forms.map((form) => [form.episodeId, form]));
  return confirmed.flatMap((row) => {
    const form = formOf.get(row.episodeId);
    if (!form?.submittedAt) return [];
    return [{ ...row, answers: form.answers, submittedAt: form.submittedAt }];
  });
}
