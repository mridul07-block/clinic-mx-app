import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { planOfCare } from './clinical-record';
import { episode } from './episodes';
import { patientLink } from './patient-links';
import { patient } from './patients';

/**
 * Home exercise ticks (PAT-02; PRD J5.7: "Patients tick home exercises on My plan; adherence fills
 * the next note"). One row per exercise of the newest plan of care per IST day, written by the
 * patient through their My plan link, today only, and untickable the same day. Plan rows have no
 * id of their own, so a tick names its plan version, the row's place and the exercise as it read.
 */
export const exerciseTick = pgTable(
  'exercise_tick',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    planOfCareId: uuid('plan_of_care_id')
      .notNull()
      .references(() => planOfCare.id),
    /** The row's place in the plan's home programme, from 0. */
    exerciseIndex: smallint('exercise_index').notNull(),
    /** The exercise as the row read when ticked. */
    exercise: text('exercise').notNull(),
    /** The IST day it was done. */
    day: date('day').notNull(),
    patientLinkId: uuid('patient_link_id')
      .notNull()
      .references(() => patientLink.id),
    tickedAt: timestamp('ticked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('exercise_tick_once_a_day').on(table.planOfCareId, table.exerciseIndex, table.day),
    index('exercise_tick_episode_day_idx').on(table.episodeId, table.day),
    check('exercise_tick_index', sql`${table.exerciseIndex} between 0 and 29`),
  ],
).enableRLS();

export type ExerciseTick = typeof exerciseTick.$inferSelect;
