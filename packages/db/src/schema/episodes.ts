import { dischargeReasons, episodeStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { centre } from './identity';
import { screeningRegion } from './knowledge';
import { patient } from './patients';

/**
 * Clinical episodes (SCH-03, TAD section 4). Opened at booking as Intake pending; every status
 * change is an event of the machine in `packages/schemas/src/episodes.ts`, and the
 * `episode_transition_guard` trigger refuses any other pair. Status history is the audit trail.
 * Discharged is final: a recurrence opens a new episode linked to it (SCH-14).
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
    dischargeReason: dischargeReason('discharge_reason'),
    dischargeNote: text('discharge_note'),
    /** The discharged episode a recurrence follows (PRD J7.5). */
    linkedEpisodeId: uuid('linked_episode_id').references((): AnyPgColumn => episode.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('episode_patient_idx').on(table.patientId),
    index('episode_centre_status_idx').on(table.centreId, table.status),
    check(
      'episode_discharged_closed',
      sql`(${table.status} = 'discharged') = (${table.closedAt} is not null and ${table.dischargeReason} is not null)`,
    ),
    check(
      'episode_other_note',
      sql`${table.dischargeReason} is distinct from 'other' or btrim(coalesce(${table.dischargeNote}, '')) <> ''`,
    ),
    check(
      'episode_paused_from',
      sql`(${table.status} in ('on_hold', 'lost_to_follow_up')) = (${table.pausedFrom} is not null)`,
    ),
  ],
).enableRLS();

export type Episode = typeof episode.$inferSelect;
