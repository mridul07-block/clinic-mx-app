import { dischargeReasons, episodeStatuses, type GoalOutcome } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { centre, staffUser } from './identity';
import { screeningRegion } from './knowledge';
import { patient } from './patients';

/**
 * Clinical episodes (SCH-03, TAD section 4). Opened at booking as Intake pending; every status
 * change is an event of the machine in `packages/schemas/src/episodes.ts`, and the
 * `episode_transition_guard` trigger refuses any other pair. Status history is the audit trail.
 * Discharged is final: a recurrence opens a new episode linked to it (SCH-14). A consultant
 * discharges (OUT-10): `episode_discharge_guard` checks the ticks and stamps who and when.
 */
export const episodeStatus = pgEnum('episode_status', episodeStatuses);
export const dischargeReason = pgEnum('discharge_reason', dischargeReasons);

export const episode = pgTable(
  'episode',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    centreId: uuid('centre_id')
      .notNull()
      .references(() => centre.id),
    /** The health form's region (INT-05); it picks the regional red flag rules. */
    bodyRegion: screeningRegion('body_region'),
    status: episodeStatus('status').notNull().default('intake_pending'),
    /** The status an On hold or Lost to follow up episode goes back to. */
    pausedFrom: episodeStatus('paused_from'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /**
     * The first time a consultation proposed a plan, and the first time it became Active (paid):
     * stamped by `episode_milestones` and never changed, for the figures (DSH-01).
     */
    planProposedAt: timestamp('plan_proposed_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    dischargeReason: dischargeReason('discharge_reason'),
    dischargeNote: text('discharge_note'),
    /** The consultant who discharged it (OUT-10), stamped by the database at discharge. */
    dischargedBy: uuid('discharged_by').references(() => staffUser.id),
    /** OUT-11: written with the discharge, for the discharge report. */
    dischargeGoals: jsonb('discharge_goals').$type<{ text: string; outcome: GoalOutcome }[]>(),
    dischargeOngoingNeeds: text('discharge_ongoing_needs'),
    dischargeRecommendations: text('discharge_recommendations'),
    /** PAT-03: written at discharge for My plan's maintenance mode and the discharge report. */
    dischargeReturnPlan: text('discharge_return_plan'),
    dischargeFlarePlan: text('discharge_flare_plan'),
    /** The discharged episode a recurrence follows (PRD J7.5). */
    linkedEpisodeId: uuid('linked_episode_id').references((): AnyPgColumn => episode.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('episode_patient_idx').on(table.patientId),
    index('episode_centre_status_idx').on(table.centreId, table.status),
    index('episode_plan_proposed_idx').on(table.planProposedAt),
    index('episode_closed_idx').on(table.closedAt),
    check(
      'episode_discharged_closed',
      sql`(${table.status} = 'discharged') = (${table.closedAt} is not null and ${table.dischargeReason} is not null)`,
    ),
    check(
      'episode_other_note',
      sql`${table.dischargeReason} is distinct from 'other' or btrim(coalesce(${table.dischargeNote}, '')) <> ''`,
    ),
    check(
      'episode_discharged_by',
      sql`${table.dischargedBy} is null or ${table.status} = 'discharged'`,
    ),
    check(
      'episode_discharge_report',
      sql`${table.status} = 'discharged' or (${table.dischargeGoals} is null and ${table.dischargeOngoingNeeds} is null and ${table.dischargeRecommendations} is null)`,
    ),
    check(
      'episode_discharge_plans',
      sql`${table.status} = 'discharged' or (${table.dischargeReturnPlan} is null and ${table.dischargeFlarePlan} is null)`,
    ),
    check(
      'episode_paused_from',
      sql`(${table.status} in ('on_hold', 'lost_to_follow_up')) = (${table.pausedFrom} is not null)`,
    ),
  ],
).enableRLS();

export type Episode = typeof episode.$inferSelect;
