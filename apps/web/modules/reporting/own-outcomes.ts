import 'server-only';
import type { StaffMember } from '@clinic-mx/db';
import { accessScope, ownOutcomesComing, type OutcomeWindow } from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { outcomesFor, type OutcomesDashboard } from './manager';

/**
 * A treating clinician's own outcomes (DSH-06, PRD section 2: physiotherapists see dashboards for
 * their own patients; docs/runbooks/own-outcomes.md). Recommended defaults chosen under the user's
 * standing approval, 28 October 2026: the Centre Manager's Outcomes tab, with the same figures,
 * definitions, windows and clinic targets, counted over the episodes whose newest plan names the
 * reader as treating physio, at any centre; never a colleague's. The whole funnel: one consulted
 * while a red flag held it On hold shows between Consultation held and Plan proposed. Adherence
 * waits for My plan (PAT-01, PAT-02).
 */

export interface OwnOutcomesView extends OutcomesDashboard {
  coming: readonly { label: string; needs: string }[];
}

/** Whether the person may see their own outcomes: they treat patients, never Velyx support. */
export function readsOwnOutcomes(actor: StaffMember): boolean {
  return (
    accessScope(actor, 'dashboard.own_patients') !== null && actor.treatsPatients && !actor.support
  );
}

export async function ownOutcomes(
  actor: StaffMember,
  window: OutcomeWindow,
  now = new Date(),
): Promise<OwnOutcomesView> {
  if (!readsOwnOutcomes(actor)) throw new NotAllowedError();
  return { ...(await outcomesFor(actor, window, now, 'own')), coming: ownOutcomesComing };
}
