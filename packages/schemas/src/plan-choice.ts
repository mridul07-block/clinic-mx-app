import { z } from 'zod';

/**
 * The patient's choice on the plan and payment sheet (BIL-02, PRD J4.3): recorded by the front
 * desk against the recommended plan. A package names the package offered, pay per session the
 * session type. Every choice is kept and the newest counts; none of them changes the episode, and
 * declining keeps all clinical information (rule 1). "I'll think about it" is followed up at
 * `billing.think_about_it_follow_up_time` on the `billing.think_about_it_follow_up_days`th day
 * with a WhatsApp nudge and a call task (TAD section 8; user decisions, 25 October 2026).
 */

export const planChoices = ['package', 'per_session', 'think_about_it', 'no_thanks'] as const;

export type PlanChoice = (typeof planChoices)[number];

export const planChoiceLabels: Record<PlanChoice, string> = {
  package: 'Package',
  per_session: 'Pay per session',
  think_about_it: 'I’ll think about it',
  no_thanks: 'No thanks',
};

const sessionKey = z
  .string({ error: 'Choose the session type.' })
  .regex(/^[a-z][a-z0-9_]*$/, { error: 'Choose the session type.' });

/** What the sheet's form posts; a package is one of those offered for the session type. */
export const recordPlanChoiceSchema = z.discriminatedUnion(
  'choice',
  [
    z.object({
      choice: z.literal('package'),
      sessionKey,
      packageTypeId: z.guid({ error: 'Choose the package.' }),
    }),
    z.object({ choice: z.literal('per_session'), sessionKey }),
    z.object({ choice: z.literal('think_about_it') }),
    z.object({ choice: z.literal('no_thanks') }),
  ],
  { error: 'Choose what the patient decided.' },
);

export type RecordPlanChoice = z.infer<typeof recordPlanChoiceSchema>;

/**
 * The form's fields as one choice: "package:<id>" for a package, else the choice itself, with the
 * session type from the sheet.
 */
export function planChoiceFromForm(option: string, session: string): unknown {
  if (option.startsWith('package:')) {
    return { choice: 'package', sessionKey: session, packageTypeId: option.slice(8) };
  }
  if (option === 'per_session') return { choice: option, sessionKey: session };
  return { choice: option };
}
