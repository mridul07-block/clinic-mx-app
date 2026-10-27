import { consultationSectionsSchema, subjectiveValue, type PainReading } from '@clinic-mx/schemas';
import { and, asc, desc, eq } from 'drizzle-orm';
import { consultationIntake } from './consultations';
import { consultation, treatmentSession } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The Progress tab's pain (OUT-03; docs/runbooks/patient-record.md): the episode's latest signed
 * consultation (pain now and on activity, as confirmed or as the health form said) and each signed
 * session's pain. Read under the reader's row level security, so only clinicians get anything;
 * drafts are never read.
 */
export interface EpisodePain {
  consultation: { at: Date; now: unknown; activity: unknown; kbVersionId: string } | undefined;
  sessions: { number: number; at: Date; pain: Record<PainReading, number | null> }[];
}

export async function episodePainReadings(
  db: DbOrTransaction,
  episodeId: string,
): Promise<EpisodePain> {
  const [signed] = await db
    .select({
      appointmentId: consultation.appointmentId,
      sections: consultation.sections,
      signedAt: consultation.signedAt,
      kbVersionId: consultation.kbVersionId,
    })
    .from(consultation)
    .where(and(eq(consultation.episodeId, episodeId), eq(consultation.status, 'signed')))
    .orderBy(desc(consultation.signedAt))
    .limit(1);
  let found: EpisodePain['consultation'];
  if (signed?.signedAt) {
    const confirmed = consultationSectionsSchema.parse(signed.sections).subjective.confirmed;
    const answers = (await consultationIntake(db, signed.appointmentId))?.answers ?? {};
    found = {
      at: signed.signedAt,
      now: subjectiveValue('pain_now', confirmed, answers),
      activity: subjectiveValue('pain_activity', confirmed, answers),
      kbVersionId: signed.kbVersionId,
    };
  }
  const sessions = await db
    .select({
      number: treatmentSession.number,
      // Signing stores the three readings (a signed session always has them, SES-03).
      rest: treatmentSession.painRest,
      activity: treatmentSession.painActivity,
      after: treatmentSession.painAfter,
      signedAt: treatmentSession.signedAt,
    })
    .from(treatmentSession)
    .where(and(eq(treatmentSession.episodeId, episodeId), eq(treatmentSession.status, 'signed')))
    .orderBy(asc(treatmentSession.number));
  return {
    consultation: found,
    sessions: sessions.flatMap((row) =>
      row.signedAt
        ? [
            {
              number: row.number,
              at: row.signedAt,
              pain: { rest: row.rest, activity: row.activity, after: row.after },
            },
          ]
        : [],
    ),
  };
}
