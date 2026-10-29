import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { consultation } from './consultations';
import { episode } from './episodes';
import { centre, staffUser } from './identity';
import { patientLink } from './patient-links';
import { patient } from './patients';

/**
 * Patient feedback (PAT-04; TAD `feedback`): one row per answered feedback link, written by the
 * patient through their link and never changed. Kept by centre and physio, as the ticket asks:
 * after the consultation, the consultation's centre and the physio who held it; at discharge
 * (PAT-07), the episode's centre and the consultant who discharged it, with the 0 to 10 score; the
 * day after first treatment check (PAT-05), the first treatment's visit and physio. The questions
 * and their versions live in `@clinic-mx/schemas` (`feedbackSurveys`).
 */
export const feedbackSurveyKey = pgEnum('feedback_survey_key', [
  'post_consultation',
  'discharge',
  'first_treatment',
  'follow_up',
]);

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyKey: feedbackSurveyKey('survey_key').notNull(),
    /** The survey's version when asked, so a change of wording never rewrites old answers. */
    surveyVersion: integer('survey_version').notNull(),
    patientLinkId: uuid('patient_link_id')
      .notNull()
      .unique()
      .references(() => patientLink.id),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    appointmentId: uuid('appointment_id').references(() => appointment.id),
    consultationId: uuid('consultation_id').references(() => consultation.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    physioId: uuid('physio_id').references(() => staffUser.id),
    /** Question key to "yes" or "no". */
    answers: jsonb('answers').$type<Record<string, string>>().notNull(),
    comment: text('comment'),
    /** The 0 to 10 recommendation score, at discharge. */
    score: smallint('score'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('feedback_one_per_consultation').on(table.consultationId),
    uniqueIndex('feedback_one_discharge_per_episode')
      .on(table.episodeId)
      .where(sql`${table.surveyKey} = 'discharge'`),
    // PAT-10: each follow up after discharge answered once per episode.
    uniqueIndex('feedback_one_follow_up_per_interval')
      .on(table.episodeId, sql`(${table.answers} ->> 'follow_up')`)
      .where(sql`${table.surveyKey} = 'follow_up'`),
    // PAT-05: the day after first treatment check, once per episode.
    uniqueIndex('feedback_one_first_treatment_per_episode')
      .on(table.episodeId)
      .where(sql`${table.surveyKey} = 'first_treatment'`),
    index('feedback_centre_idx').on(table.centreId, table.submittedAt),
    index('feedback_physio_idx').on(table.physioId, table.submittedAt),
    check('feedback_answers', sql`jsonb_typeof(${table.answers}) = 'object'`),
    check(
      'feedback_comment',
      sql`${table.comment} is null or length(${table.comment}) between 1 and 1000`,
    ),
    check('feedback_score', sql`${table.score} is null or ${table.score} between 0 and 10`),
    check(
      'feedback_discharge',
      sql`${table.surveyKey} <> 'discharge' or (${table.score} is not null and ${table.appointmentId} is null and ${table.consultationId} is null)`,
    ),
    check(
      'feedback_post_consultation_score',
      sql`${table.surveyKey} <> 'post_consultation' or ${table.score} is null`,
    ),
    check(
      'feedback_post_consultation',
      sql`${table.surveyKey} <> 'post_consultation' or (${table.appointmentId} is not null and ${table.consultationId} is not null and ${table.physioId} is not null)`,
    ),
    // PAT-10: the discharged episode's centre and consultant; one answer of the three for one
    // interval ("2_week"), nothing more.
    check(
      'feedback_follow_up',
      sql`${table.surveyKey} <> 'follow_up' or (${table.appointmentId} is null
        and ${table.consultationId} is null and ${table.score} is null and ${table.comment} is null
        and ${table.answers} ->> 'since_discharge' in ('doing_well', 'some_pain', 'injured_again')
        and ${table.answers} ->> 'follow_up' ~ '^[0-9]+_(week|month)$'
        and ${table.answers} - 'since_discharge' - 'follow_up' = '{}'::jsonb)`,
    ),
    // PAT-05: the first treatment's visit and physio, and one answer of the three, nothing more.
    check(
      'feedback_first_treatment',
      sql`${table.surveyKey} <> 'first_treatment' or (${table.appointmentId} is not null
        and ${table.consultationId} is null and ${table.physioId} is not null
        and ${table.score} is null and ${table.comment} is null
        and ${table.answers} ->> 'since_first_treatment' in ('better', 'same', 'still_sore')
        and ${table.answers} - 'since_first_treatment' = '{}'::jsonb)`,
    ),
  ],
).enableRLS();

export type Feedback = typeof feedback.$inferSelect;

/**
 * The follow ups after discharge (PAT-10), fixed at discharge: one row per interval of
 * `engagement.follow_ups_after_discharge` as it stood then ("2_week"), with the IST day it is due.
 * Written by the discharge trigger; what a follow up link answers is read from here, so a later
 * change of the setting moves nothing already scheduled.
 */
export const followUpSchedule = pgTable(
  'follow_up_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    followUp: text('follow_up').notNull(),
    dueOn: date('due_on').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('follow_up_schedule_episode_interval').on(table.episodeId, table.followUp),
    check('follow_up_schedule_interval', sql`${table.followUp} ~ '^[0-9]+_(week|month)$'`),
  ],
).enableRLS();
