import { exerciseVideoTypes } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { staffUser } from './identity';

/**
 * The exercise library (SET-07; TAD `kb_exercise`: name, video file, default dose). The clinic's
 * own list, kept by the Super Admin. A row never changes but to be retired: replacing an exercise
 * adds a new row and retires the old, naming its replacement, so a plan keeps the exercise it was
 * written with. The video is a file in the private `exercise-media` bucket, served through our
 * domain only.
 */
export const exercise = pgTable(
  'exercise',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    defaultDose: text('default_dose').notNull(),
    /** The video's path in `exercise-media`; null until the clinic films it. */
    videoPath: text('video_path'),
    videoType: text('video_type', { enum: exerciseVideoTypes }),
    videoBytes: integer('video_bytes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffUser.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    /** The exercise that replaced it, when it was replaced rather than removed. */
    replacedBy: uuid('replaced_by').references((): AnyPgColumn => exercise.id),
  },
  (table) => [
    index('exercise_active_name_idx')
      .on(table.name)
      .where(sql`${table.retiredAt} is null`),
    check('exercise_name', sql`length(trim(${table.name})) between 1 and 120`),
    check('exercise_default_dose', sql`length(trim(${table.defaultDose})) between 1 and 120`),
    check(
      'exercise_video',
      sql`(${table.videoPath} is null) = (${table.videoType} is null)
        and (${table.videoPath} is null) = (${table.videoBytes} is null)
        and (${table.videoType} is null or ${table.videoType} in ('video/mp4', 'video/webm'))
        and (${table.videoBytes} is null or ${table.videoBytes} > 0)`,
    ),
    check('exercise_replaced', sql`${table.replacedBy} is null or ${table.retiredAt} is not null`),
  ],
).enableRLS();
