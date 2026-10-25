import 'server-only';
import {
  episodeRecord,
  planForPricing,
  recordPlanChoice,
  thinkAboutItFollowUp,
} from '@clinic-mx/db';
import { episodeStatusLabels, recordPlanChoiceSchema } from '@clinic-mx/schemas';
import { z } from 'zod';
import { staffService, systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { priceListsOf } from './plan-sheet';

/**
 * The patient's choice on the plan and payment sheet (BIL-02, PRD J4.3; user decisions, 25
 * October 2026): package (one of those offered for the session type), pay per session (the
 * session type), "I'll think about it" or "No thanks", recorded against the newest plan while
 * the episode is Plan proposed. Every choice is kept and the newest counts; the episode is never
 * changed (rule 1). Row level security checks the same (`plan_choice_rules`).
 */

export class PlanChoiceError extends Error {
  override name = 'PlanChoiceError';
}

export const recordPlanChoiceInput = z.object({
  episodeId: z.guid({ error: 'That episode was not found.' }),
  choice: recordPlanChoiceSchema,
});

export const recordPatientPlanChoice = staffService({
  action: 'bills.create_and_collect',
  input: recordPlanChoiceInput,
  target: async (input, tx) => {
    const episode = await episodeRecord(tx, input.episodeId);
    if (!episode) throw new PlanChoiceError('That episode was not found.');
    return { centreId: episode.centreId };
  },
  run: async (tx, { episodeId, choice }, actor) => {
    const episode = await episodeRecord(tx, episodeId);
    if (!episode) throw new PlanChoiceError('That episode was not found.');
    if (episode.status !== 'plan_proposed') {
      throw new PlanChoiceError(
        `A choice is recorded while the plan is proposed; this episode is ${episodeStatusLabels[episode.status]}.`,
      );
    }
    const plan = await planForPricing(tx, episodeId);
    if (!plan) throw new PlanChoiceError('There is no plan to choose on yet.');
    let sessionPriceItemId: string | undefined;
    let packageTypeId: string | undefined;
    if (choice.choice === 'package' || choice.choice === 'per_session') {
      const lists = await priceListsOf(tx, await getSetting('billing.session_price_items'));
      const item = lists.sessionItems.find((entry) => entry.key === choice.sessionKey);
      if (!item) throw new PlanChoiceError('That session type is not offered.');
      sessionPriceItemId = item.id;
      if (choice.choice === 'package') {
        const offered = lists.packages.find(
          (type) => type.id === choice.packageTypeId && type.itemIds.includes(item.id),
        );
        if (!offered) {
          throw new PlanChoiceError('That package is not offered for this session type.');
        }
        packageTypeId = offered.id;
      }
    }
    return recordPlanChoice(tx, {
      episodeId,
      planOfCareId: plan.planOfCareId,
      choice: choice.choice,
      packageTypeId,
      sessionPriceItemId,
      recordedBy: actor.id,
    });
  },
});

/**
 * The "I'll think about it" follow up job's work, as the system: the call task and the WhatsApp
 * nudge, unless the patient has chosen since or the episode has moved on.
 */
export const followUpThinkAboutIt = systemService({
  component: 'billing',
  input: z.object({ choiceId: z.guid() }),
  run: (tx, { choiceId }) => thinkAboutItFollowUp(tx, choiceId),
});
