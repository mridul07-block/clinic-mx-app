import { z } from 'zod';
import { knowledgeRegions, type KnowledgeRegion } from './knowledge';
import { PATIENT_CONTENT_MAX } from './patient-content';

/**
 * Patient content written by AI (AI-07; TAD section 7: "One time patient content | Best available,
 * once | Reviewed and approved by clinicians before use"). What goes to the model is the condition's
 * own knowledge base text and its region's phases, never anything about a patient; what comes back
 * is a draft of the TAD's four parts, which a consultant who treats patients approves before any
 * patient sees it (docs/runbooks/patient-content.md).
 */

/** The longest knowledge base text sent for one field; longer text is cut at a word. */
export const AI_KNOWLEDGE_TEXT_MAX = 2000;

const knowledgeText = z.string().max(AI_KNOWLEDGE_TEXT_MAX).nullable();

/** The listing's columns sent, by the importer's canonical keys (`kb_condition_listing.details`). */
export const aiPatientContentDetailKeys = [
  'timeline',
  'management_emphasis',
  'loading_stage',
  'corrections',
  'referral_trigger',
] as const;

export const aiPatientContentInputSchema = z.strictObject({
  condition: z.strictObject({
    name: z.string().min(1).max(200),
    region: z.string().min(1).max(60),
    otherNames: z.array(z.string().max(200)).max(20),
  }),
  knowledge: z.strictObject({
    symptoms: knowledgeText,
    cause: knowledgeText,
    redFlags: knowledgeText,
    timeline: knowledgeText,
    managementEmphasis: knowledgeText,
    loadingStage: knowledgeText,
    corrections: knowledgeText,
    referralTrigger: knowledgeText,
  }),
  phases: z
    .array(
      z.strictObject({
        name: z.string().max(200),
        timing: knowledgeText,
        goal: knowledgeText,
      }),
    )
    .max(10),
});
export type AiPatientContentInput = z.infer<typeof aiPatientContentInputSchema>;

const part = z.string().trim().min(1).max(PATIENT_CONTENT_MAX);

/** The four parts, as the model returns them (the TAD's order). */
export const aiPatientContentOutputSchema = z.strictObject({
  explanation: part,
  roadmap: part,
  homeAdvice: part,
  warningSigns: part,
});
export type AiPatientContentOutput = z.infer<typeof aiPatientContentOutputSchema>;

/** What a part says when the knowledge base gives it nothing to say: never the model's words. */
export const PATIENT_CONTENT_HANDOFF = 'Your physiotherapist will go through this with you.';

/** The knowledge base fields each part is written from (the prompt names the same). */
const partSources: Record<
  keyof AiPatientContentOutput,
  (input: AiPatientContentInput) => unknown[]
> = {
  explanation: (input) => [input.knowledge.symptoms, input.knowledge.cause],
  roadmap: (input) => [
    ...input.phases.map((phase) => phase.name),
    input.knowledge.timeline,
    input.knowledge.loadingStage,
  ],
  homeAdvice: (input) => [
    input.knowledge.corrections,
    input.knowledge.managementEmphasis,
    input.knowledge.loadingStage,
  ],
  warningSigns: (input) => [input.knowledge.redFlags, input.knowledge.referralTrigger],
};

/** The parts whose knowledge base sources are all empty: they get `PATIENT_CONTENT_HANDOFF`. */
export function partsWithoutSource(input: AiPatientContentInput): (keyof AiPatientContentOutput)[] {
  return (Object.keys(partSources) as (keyof AiPatientContentOutput)[]).filter((part) =>
    partSources[part](input).every((source) => source === null || source === ''),
  );
}

/** A condition's knowledge base text, as `conditionsWithoutPatientContent` reads it. */
export interface ConditionKnowledge {
  conditionId: string;
  name: string;
  synonyms: readonly string[];
  region: KnowledgeRegion;
  symptoms: string | null;
  biomechanicalCause: string | null;
  redFlagText: string | null;
  details: Readonly<Record<string, { label: string; text: string }>>;
}

export interface RegionPhase {
  name: string;
  timing: string;
  goal: string;
}

/** Text cut to `max` characters at a word, with an ellipsis; blank text is null. */
export function clipText(text: string | null | undefined, max = AI_KNOWLEDGE_TEXT_MAX) {
  const trimmed = text?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** What the model is sent to write one condition's content: its own words and its region's phases. */
export function patientContentInput(
  condition: ConditionKnowledge,
  phases: readonly RegionPhase[],
): AiPatientContentInput {
  const detail = (key: (typeof aiPatientContentDetailKeys)[number]) =>
    clipText(condition.details[key]?.text);
  return {
    condition: {
      name: condition.name,
      region: knowledgeRegions[condition.region].label,
      otherNames: condition.synonyms.slice(0, 20).map((name) => name.slice(0, 200)),
    },
    knowledge: {
      symptoms: clipText(condition.symptoms),
      cause: clipText(condition.biomechanicalCause),
      redFlags: clipText(condition.redFlagText),
      timeline: detail('timeline'),
      managementEmphasis: detail('management_emphasis'),
      loadingStage: detail('loading_stage'),
      corrections: detail('corrections'),
      referralTrigger: detail('referral_trigger'),
    },
    phases: phases.slice(0, 10).map((phase) => ({
      name: phase.name.slice(0, 200),
      timing: clipText(phase.timing),
      goal: clipText(phase.goal),
    })),
  };
}
