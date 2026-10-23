import { alertDisplays, notificationKinds, redFlagAlertStatuses } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { appointment } from './appointments';
import { episode } from './episodes';
import { staffUser } from './identity';
import { intakeResponse } from './intake';
import { kbVersion, redFlagTriage } from './knowledge';

/**
 * What a submitted health form leaves on its episode (INT-10, PRD J2.6, TAD section 4): the red
 * flag alerts its answers raised, the precautions it ticked, and the notifications sent about it.
 * Written by the system in the submit pipeline; every change is audited.
 */
export const redFlagAlertStatus = pgEnum('red_flag_alert_status', redFlagAlertStatuses);
export const alertDisplay = pgEnum('alert_display', alertDisplays);
export const notificationKind = pgEnum('notification_kind', notificationKinds);

/**
 * A red flag rule raised by a form's answers. It keeps the knowledge base version and whether the
 * rule was signed off then (user decision, 23 October 2026: unsigned rules run too, and say so).
 * Reviewing, referring and closing come with ALT-01.
 */
export const redFlagAlert = pgTable(
  'red_flag_alert',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    appointmentId: uuid('appointment_id').references(() => appointment.id, {
      onDelete: 'set null',
    }),
    kbVersionId: uuid('kb_version_id')
      .notNull()
      .references(() => kbVersion.id),
    ruleKey: text('rule_key').notNull(),
    name: text('name').notNull(),
    triage: redFlagTriage('triage').notNull(),
    display: alertDisplay('display').notNull(),
    action: text('action').notNull(),
    signedOff: boolean('signed_off').notNull(),
    status: redFlagAlertStatus('status').notNull().default('raised'),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by').references(() => staffUser.id),
    decision: text('decision'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('red_flag_alert_episode_idx').on(table.episodeId),
    unique('red_flag_alert_episode_rule').on(table.episodeId, table.ruleKey),
  ],
).enableRLS();

/** A precaution ticked on the Health check, as the patient saw it (Blueprint Module 3). */
export const precaution = pgTable(
  'precaution',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => episode.id),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** Where it was recorded: the health form, for now. */
    source: text('source', { enum: ['health_form'] }).notNull(),
    intakeResponseId: uuid('intake_response_id').references(() => intakeResponse.id, {
      onDelete: 'set null',
    }),
    formVersion: text('form_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('precaution_episode_key').on(table.episodeId, table.key),
    check('precaution_source', sql`${table.source} in ('health_form')`),
  ],
).enableRLS();

/** Something a staff member is told about in the app (user decision, 23 October 2026). */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUser.id),
    kind: notificationKind('kind').notNull(),
    appointmentId: uuid('appointment_id').references(() => appointment.id, {
      onDelete: 'cascade',
    }),
    episodeId: uuid('episode_id').references(() => episode.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    index('notification_staff_idx').on(table.staffUserId, table.createdAt),
    unique('notification_once').on(table.staffUserId, table.kind, table.appointmentId),
  ],
).enableRLS();
