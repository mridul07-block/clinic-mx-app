import { planChoices } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { planOfCare } from './clinical-record';
import { episode } from './episodes';
import { staffUser } from './identity';
import { packageType, priceItem } from './prices';

export const planChoiceKind = pgEnum('plan_choice_kind', planChoices);

/**
 * The patient's choice on the recommended plan (BIL-02, PRD J4.3), recorded by the front desk.
 * Every choice is kept and the newest counts; nobody changes or deletes one. A package names the
 * package type and the session type, pay per session the session type. "I'll think about it" gets
 * its follow up time from the database (`follow_up_at`), and the job that does it.
 */
export const patientPlanChoice = pgTable(
  'plan_choice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    /** The plan of care it answers: the episode's newest when it was recorded. */
    planOfCareId: uuid('plan_of_care_id')
      .notNull()
      .references(() => planOfCare.id),
    choice: planChoiceKind('choice').notNull(),
    packageTypeId: uuid('package_type_id').references(() => packageType.id),
    sessionPriceItemId: uuid('session_price_item_id').references(() => priceItem.id),
    /** When the nudge and the call task are due; set by the database for "I'll think about it". */
    followUpAt: timestamp('follow_up_at', { withTimezone: true }),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => staffUser.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('plan_choice_episode_idx').on(table.episodeId, table.recordedAt),
    check(
      'plan_choice_details',
      sql`case ${table.choice}
        when 'package' then ${table.packageTypeId} is not null and ${table.sessionPriceItemId} is not null
        when 'per_session' then ${table.packageTypeId} is null and ${table.sessionPriceItemId} is not null
        else ${table.packageTypeId} is null and ${table.sessionPriceItemId} is null
      end`,
    ),
    check(
      'plan_choice_follow_up',
      sql`(${table.choice} = 'think_about_it') = (${table.followUpAt} is not null)`,
    ),
  ],
).enableRLS();

export type PatientPlanChoice = typeof patientPlanChoice.$inferSelect;
