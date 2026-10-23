import { z } from 'zod';
import type { RedFlagAlertStatus } from './intake-submit';
import type { AlertDisplay } from './red-flags';

/**
 * A red flag alert's life (ALT-01, PRD M11, Blueprint: "Record the alert, clinician review,
 * decision, referral and closure"): raised by the health form, then a clinician says "I'm
 * reviewing" (which ends the emergency banner), may refer, and closes with a written decision.
 * Pure: the services and the database trigger enforce the same moves. Decisions (user, 23 October
 * 2026): only clinicians (the Treats patients tick) act; Refer puts the episode On hold; the
 * decision is free text.
 */

export const alertEvents = ['review', 'refer', 'close'] as const;
export type AlertEvent = (typeof alertEvents)[number];

export const alertEventLabels: Record<AlertEvent, string> = {
  review: 'I’m reviewing',
  refer: 'Refer',
  close: 'Close',
};

const moves: Record<AlertEvent, { from: readonly RedFlagAlertStatus[]; to: RedFlagAlertStatus }> = {
  review: { from: ['raised'], to: 'reviewed' },
  refer: { from: ['reviewed'], to: 'referred' },
  close: { from: ['reviewed', 'referred'], to: 'closed' },
};

export type AlertTransition =
  { ok: true; next: RedFlagAlertStatus } | { ok: false; refusal: string };

/** The status after `event`, or why it is refused. */
export function alertTransition(status: RedFlagAlertStatus, event: AlertEvent): AlertTransition {
  if (status === 'closed') return { ok: false, refusal: 'This alert is already closed.' };
  const move = moves[event];
  if (move.from.includes(status)) return { ok: true, next: move.to };
  if (status === 'raised') {
    return { ok: false, refusal: 'Press “I’m reviewing” before referring or closing.' };
  }
  if (event === 'review') return { ok: false, refusal: 'Someone is already reviewing this alert.' };
  return { ok: false, refusal: 'This alert has already been referred.' };
}

/** Whether an alert still needs someone: not yet closed. */
export function alertOpen(status: RedFlagAlertStatus): boolean {
  return status !== 'closed';
}

const displayRank: Record<AlertDisplay, number> = { emergency: 0, review: 1, information: 2 };

/** Emergencies first, then the oldest raised. */
export function alertOrder(
  a: { display: AlertDisplay; raisedAt: Date },
  b: { display: AlertDisplay; raisedAt: Date },
): number {
  return (
    displayRank[a.display] - displayRank[b.display] || a.raisedAt.getTime() - b.raisedAt.getTime()
  );
}

const alertIdSchema = z.guid({ error: 'That alert was not found.' });

export const reviewAlertSchema = z.object({ alertId: alertIdSchema });

export const referAlertSchema = z.object({
  alertId: alertIdSchema,
  referredTo: z
    .string()
    .trim()
    .min(1, { error: 'Say where the patient was referred.' })
    .max(200, { error: 'Keep it under 200 characters.' }),
});

export const closeAlertSchema = z.object({
  alertId: alertIdSchema,
  decision: z
    .string()
    .trim()
    .min(1, { error: 'Write the decision before closing.' })
    .max(1000, { error: 'Keep the decision under 1000 characters.' }),
});

export type ReferAlertInput = z.infer<typeof referAlertSchema>;
export type CloseAlertInput = z.infer<typeof closeAlertSchema>;
