import { z } from 'zod';
import type { AlertDisplay } from './red-flags';
import { healthFormState, needsHealthForm, type HealthFormState } from './today';

/**
 * My patients today (CLN-01, Frontend Specification "Physiotherapist"): the physio's own visits
 * in time order with status, form status and alerts; Start consultation or Start session on a
 * checked in visit marks it In progress (user decision 24 October 2026).
 */
export const startVisitSchema = z.object({ appointmentId: z.guid() });

/** The start button: a consultation is started as one; every other type is a session. */
export function startLabel(typeKey: string): string {
  return typeKey === 'consultation' ? 'Start consultation' : 'Start session';
}

/**
 * Where the visit's health form stands: only a first visit for a problem has one (INT-02);
 * a visit in an open episode has none to show.
 */
export function visitFormStatus(
  visit: {
    episodeId: string | null;
    healthForm: { expiresAt: Date; revokedAt: Date | null; completedAt: Date | null } | undefined;
    consentDeclined: boolean;
  },
  now: Date,
): HealthFormState | undefined {
  if (!needsHealthForm(visit, visit.healthForm)) return undefined;
  return healthFormState(visit.healthForm, now, visit.consentDeclined);
}

const loudness: readonly AlertDisplay[] = ['emergency', 'review', 'information'];

/** The loudest of a visit's open alerts, which sets their tone; undefined when none is open. */
export function loudestAlert(displays: readonly AlertDisplay[]): AlertDisplay | undefined {
  return loudness.find((display) => displays.includes(display));
}
