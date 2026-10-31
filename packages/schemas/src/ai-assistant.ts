import { z } from 'zod';

/**
 * The WhatsApp assistant for typed messages (WA-11; PRD M3 and section 6, TAD sections 6 and 7).
 * The model only chooses (user decision, 31 October 2026): one of the clinic's approved answers
 * (`whatsapp.assistant_faqs`), or what the menu offers (book, reschedule or cancel, talk to our
 * team), or emergency, or none. The patient reads only the clinic's own words, never the model's,
 * so it cannot diagnose or invent anything. Nothing it can choose stands for an answer: the menu.
 */

/** What the model may choose besides an answer's id. */
export const assistantActions = ['book', 'reschedule', 'talk', 'emergency', 'none'] as const;
export type AssistantAction = (typeof assistantActions)[number];

/** The most of a typed message sent to the model. */
export const ASSISTANT_MESSAGE_MAX = 500;
export const ASSISTANT_FAQS_MAX = 30;
export const ASSISTANT_QUESTION_MAX = 200;
export const ASSISTANT_ANSWER_MAX = 1000;
/** WhatsApp's limit on a message with reply buttons; a longer answer goes as plain text. */
export const BUTTON_MESSAGE_MAX = 1024;

/** `{{centres}}` in an answer: each centre's address and directions, filled in when sent. */
export const CENTRES_PLACEHOLDER = '{{centres}}';

const faqId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use lower case letters, digits and underscores.')
  .refine((id) => !(assistantActions as readonly string[]).includes(id), {
    error: 'That id is kept for the menu’s choices.',
  });

export const assistantFaqSchema = z.strictObject({
  id: faqId,
  /** What the model is shown: the question the answer answers. */
  question: z.string().trim().min(5).max(ASSISTANT_QUESTION_MAX),
  /** What the patient reads, word for word. */
  answer: z.string().trim().min(1).max(ASSISTANT_ANSWER_MAX),
});
export type AssistantFaq = z.infer<typeof assistantFaqSchema>;

/** The setting `whatsapp.assistant_faqs`: the clinic's approved answers, each id once. */
export const assistantFaqsSchema = z
  .array(assistantFaqSchema)
  .max(ASSISTANT_FAQS_MAX)
  .refine((faqs) => new Set(faqs.map((faq) => faq.id)).size === faqs.length, {
    error: 'Each answer needs its own id.',
  });

/** What the model is sent: the message, and the answers' ids and questions, never the answers. */
export const aiAssistantInputSchema = z.strictObject({
  message: z.string().min(1).max(ASSISTANT_MESSAGE_MAX),
  choices: z
    .array(z.strictObject({ id: faqId, question: z.string().max(ASSISTANT_QUESTION_MAX) }))
    .max(ASSISTANT_FAQS_MAX),
});
export type AiAssistantInput = z.infer<typeof aiAssistantInputSchema>;

/** What the model returns: one choice. Whether it is one of those offered is checked after. */
export const aiAssistantOutputSchema = z.strictObject({ choice: z.string().max(40) });
export type AiAssistantOutput = z.infer<typeof aiAssistantOutputSchema>;

/** What the assistant answers with: one of the answers offered, or an action. */
export type AssistantChoice = { kind: 'faq'; faq: AssistantFaq } | { kind: AssistantAction };

/** The model's choice, as long as it is one offered; anything else is none. */
export function assistantChoice(choice: string, faqs: readonly AssistantFaq[]): AssistantChoice {
  const faq = faqs.find((entry) => entry.id === choice);
  if (faq) return { kind: 'faq', faq };
  return (assistantActions as readonly string[]).includes(choice)
    ? { kind: choice as AssistantAction }
    : { kind: 'none' };
}

export interface CentreDirections {
  name: string;
  address: string | null;
  mapLink: string | null;
}

/**
 * An answer as the patient reads it: `{{centres}}` filled with each active centre's address and
 * map link, as the clinic keeps them; a centre with neither says to ask the front desk.
 */
export function assistantAnswerText(answer: string, centres: readonly CentreDirections[]): string {
  if (!answer.includes(CENTRES_PLACEHOLDER)) return answer;
  const listed = centres
    .map((centre) =>
      [
        `Movementology ${centre.name}: ${centre.address ?? 'please ask the front desk for directions'}`,
        ...(centre.mapLink ? [centre.mapLink] : []),
      ].join('\n'),
    )
    .join('\n\n');
  return answer.split(CENTRES_PLACEHOLDER).join(listed);
}
