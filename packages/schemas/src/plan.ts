import { z } from 'zod';
import { questionnaireDefinitionSchema, questionnaireLicences } from './questionnaires';
import type { HealthFormAnswers } from './health-form';
import { addDays } from './ist';
import type { KnowledgeRegion } from './knowledge';
import { knowledgeRegionKeys } from './knowledge';
import {
  patientScreeningAnswer,
  precautionLabels,
  screeningItems,
  type ScreeningConfirmed,
} from './screening';

/**
 * The consultation's Plan (CLN-07, PRD J3.7, Blueprint SOAP "P"): goals (the patient's own among
 * them), interventions, modalities checked against the patient's precautions, frequency, the home
 * programme, the review date, outcome questionnaires and the treating physio. The modalities, the
 * precautions each warns about and the questionnaires are knowledge base data (the committed plan
 * catalog); this file holds the shape of the plan and the fixed rules that read it.
 */

/** The intervention kinds of the Blueprint's treatment note ("Intervention"); modalities apart. */
export const interventionKinds = [
  'exercise',
  'manual_therapy',
  'movement_retraining',
  'technology_assisted',
] as const;
export type InterventionKind = (typeof interventionKinds)[number];
export const interventionLabels: Record<InterventionKind, string> = {
  exercise: 'Exercise',
  manual_therapy: 'Manual therapy',
  movement_retraining: 'Movement retraining',
  technology_assisted: 'Technology-assisted interventions',
};

/** A modality in a version, with the precautions it warns about and where each comes from. */
export interface PlanModality {
  key: string;
  name: string;
  precautions: { precaution: string; source: string }[];
  /** False until the client's clinical lead signs the links off. */
  signedOff: boolean;
}

/**
 * An outcome questionnaire (Blueprint Module 8); its items, scoring and licence are in the library
 * (SET-08, `questionnaires.ts`).
 */
export interface PlanQuestionnaire {
  key: string;
  name: string;
  /** The workbooks it is for; empty for any region. */
  regions: KnowledgeRegion[];
  useFor: string;
}

export interface PlanCatalog {
  modalities: PlanModality[];
  questionnaires: PlanQuestionnaire[];
}

const catalogKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(80);

/**
 * A parameter recorded for a modality in the session note (SES-05): its label, whether it is a
 * number (with its unit) or text, and where it comes from. Knowledge data, awaiting the clinic's
 * own lists (DECISION SES-05).
 */
export const modalityParameterSchema = z.strictObject({
  key: catalogKey,
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['text', 'number']),
  unit: z.string().trim().min(1).max(20).optional(),
  source: z.string().trim().min(1),
});
export type ModalityParameter = z.infer<typeof modalityParameterSchema>;

/** The committed plan catalog file (`packages/db/src/knowledge/plan-catalog.json`). */
export const planCatalogFileSchema = z.strictObject({
  source: z.string().min(1),
  modalities: z
    .array(
      z.strictObject({
        key: catalogKey,
        name: z.string().trim().min(1),
        precautions: z.array(
          z.strictObject({
            precaution: z.string().refine((key) => key in precautionLabels, 'Unknown precaution.'),
            source: z.string().trim().min(1),
          }),
        ),
        signedOff: z.boolean(),
        parameters: z.array(modalityParameterSchema).default([]),
      }),
    )
    .min(1),
  questionnaires: z
    .array(
      z
        .strictObject({
          key: catalogKey,
          name: z.string().trim().min(1),
          regions: z.array(z.enum(knowledgeRegionKeys)),
          useFor: z.string().trim().min(1),
          // SET-08: the items and rules the clinic supplies, its licence and its sign-off.
          licence: z.enum(questionnaireLicences).default('unconfirmed'),
          signedOff: z.boolean().default(false),
          definition: questionnaireDefinitionSchema.nullable().default(null),
        })
        .refine((q) => !q.signedOff || (q.definition !== null && q.licence !== 'unconfirmed'), {
          error: 'Sign an instrument off only with its items and a confirmed licence.',
        }),
    )
    .min(1),
});
export type PlanCatalogFile = z.infer<typeof planCatalogFileSchema>;

export interface PrecautionInForce {
  key: string;
  label: string;
  /** Who says so: the clinician's Screening confirmation, else the patient's tick. */
  by: 'clinician' | 'patient';
}

/**
 * The patient's precautions: each one the clinician confirmed yes in Screening, and each one the
 * patient ticked that the clinician has not answered (the same answer Screening shows).
 */
export function precautionsInForce(
  confirmed: ScreeningConfirmed,
  patientAnswers: HealthFormAnswers,
): PrecautionInForce[] {
  return screeningItems(undefined, patientAnswers.sex, confirmed)
    .filter((item) => item.kind === 'precaution')
    .flatMap((item): PrecautionInForce[] => {
      const key = item.key.slice('precaution.'.length);
      const clinician = confirmed[item.key];
      if (typeof clinician === 'boolean') {
        return clinician ? [{ key, label: item.text, by: 'clinician' }] : [];
      }
      return patientScreeningAnswer(item, patientAnswers) === true
        ? [{ key, label: item.text, by: 'patient' }]
        : [];
    });
}

/** The patient's precautions a modality warns about, each with its source. */
export function modalityWarnings(
  modality: PlanModality,
  inForce: readonly PrecautionInForce[],
): (PrecautionInForce & { source: string })[] {
  return modality.precautions.flatMap((link) => {
    const found = inForce.find((precaution) => precaution.key === link.precaution);
    return found ? [{ ...found, source: link.source }] : [];
  });
}

/** The questionnaires offered for a workbook: its own, then those for any region. */
export function planQuestionnaires(
  catalog: PlanCatalog,
  region: KnowledgeRegion | '' | undefined,
): PlanQuestionnaire[] {
  const own = catalog.questionnaires.filter((q) => region && q.regions.includes(region));
  return [...own, ...catalog.questionnaires.filter((q) => q.regions.length === 0)];
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsOf = (text: string) =>
  fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const fillers = new Set(['and', 'or', 'of', 'the', 'to', 'with', 'when', 'no', 'one']);
/** Words of 5 letters or more compare on their first 5 ("meniscus" and "meniscal"). */
const STEM = 5;
const sameWord = (a: string, b: string) =>
  a.length >= STEM && b.length >= STEM ? a.slice(0, STEM) === b.slice(0, STEM) : a === b;

/**
 * The region's questionnaires whose "Use for" names the condition: a term (between commas or
 * slashes) whose every word is in the condition's name or synonyms. Any region ones (PSFS) are
 * never suggested; the clinician adds them.
 */
export function suggestedQuestionnaires(
  offered: readonly PlanQuestionnaire[],
  condition: { name: string; synonyms: readonly string[] } | undefined,
): string[] {
  if (!condition) return [];
  const words = wordsOf([condition.name, ...condition.synonyms].join(' '));
  return offered
    .filter((q) => q.regions.length > 0)
    .filter((q) =>
      q.useFor.split(/[,/]/).some((term) => {
        const needed = wordsOf(term).filter((word) => !fillers.has(word));
        return (
          needed.length > 0 && needed.every((word) => words.some((own) => sameWord(word, own)))
        );
      }),
    )
    .map((q) => q.key);
}

/** The review date by default: the visit's IST date plus the review weeks. */
export const defaultReviewDate = (visitDate: string, reviewWeeks: number) =>
  addDays(visitDate, reviewWeeks * 7);

/**
 * The days tried for the automatic 6 week review (OUT-06; user decisions 26 October 2026): from the
 * plan's review date, or today when that has passed, `days` of them.
 */
export function reviewSearchDates(reviewDate: string, today: string, days: number): string[] {
  const from = reviewDate < today ? today : reviewDate;
  return Array.from({ length: days }, (_, index) => addDays(from, index));
}

export const GOAL_MAX = 200;
export const REASON_MAX = 200;
/** The longest investigations or referral advice (ALT-06). */
export const ADVICE_MAX = 500;
export const EXERCISE_MAX = 120;
export const DOSE_MAX = 120;
export const EXERCISE_NOTE_MAX = 200;

const unique = <T>(items: readonly T[], key: (item: T) => string) =>
  new Set(items.map(key)).size === items.length;

/** What the clinician records in Plan, beside the notes. */
export const planFields = {
  goals: z
    .array(
      z.object({
        text: z.string().max(GOAL_MAX, `Keep each goal to ${String(GOAL_MAX)} characters.`),
        patient: z.boolean().default(false),
      }),
    )
    .max(20)
    .default([]),
  interventions: z
    .array(z.enum(interventionKinds))
    .default([])
    .refine((kinds) => unique(kinds, (kind) => kind), 'Each intervention is ticked once.'),
  modalities: z
    .array(
      z.object({
        key: catalogKey,
        reason: z
          .string()
          .max(REASON_MAX, `Keep the reason to ${String(REASON_MAX)} characters.`)
          .default(''),
      }),
    )
    .max(10)
    .default([])
    .refine((list) => unique(list, (m) => m.key), 'Each modality is chosen once.'),
  sessionsPerWeek: z.int().min(1).max(7).nullable().default(null),
  weeks: z.int().min(1).max(52).nullable().default(null),
  homeProgramme: z
    .array(
      z.object({
        exercise: z.string().max(EXERCISE_MAX),
        dose: z.string().max(DOSE_MAX).default(''),
        note: z.string().max(EXERCISE_NOTE_MAX).default(''),
      }),
    )
    .max(30)
    .default([]),
  /** An IST date; '' is the default (the visit plus the review weeks). */
  reviewDate: z.union([z.iso.date(), z.literal('')]).default(''),
  /** The clinician's choice; null is the suggestion from the diagnosis. */
  questionnaires: z
    .array(catalogKey)
    .max(30)
    .refine((keys) => unique(keys, (key) => key), 'Each questionnaire is chosen once.')
    .nullable()
    .default(null),
  /** '' is the consultant. */
  treatingPhysioId: z.union([z.guid(), z.literal('')]).default(''),
  /**
   * Investigations advised and a referral advised, in the clinician's own words (ALT-06,
   * user decision 25 October 2026; SOP section 14.1); printed on the summary when filled.
   */
  investigations: z
    .string()
    .max(ADVICE_MAX, `Keep it to ${String(ADVICE_MAX)} characters.`)
    .default(''),
  referral: z
    .string()
    .max(ADVICE_MAX, `Keep it to ${String(ADVICE_MAX)} characters.`)
    .default(''),
};

export interface PlanShape {
  goals: { text: string; patient: boolean }[];
  interventions: InterventionKind[];
  modalities: { key: string; reason: string }[];
  sessionsPerWeek: number | null;
  weeks: number | null;
  homeProgramme: { exercise: string; dose: string; note: string }[];
  reviewDate: string;
  questionnaires: string[] | null;
  treatingPhysioId: string;
  investigations: string;
  referral: string;
}

/** The parts `planParts` counts. */
export const PLAN_PART_COUNT = 5;

/** How many parts of the plan hold something: goals, interventions, modalities, frequency, home. */
export function planParts(plan: PlanShape): number {
  return [
    plan.goals.some((goal) => goal.text.trim() !== ''),
    plan.interventions.length > 0,
    plan.modalities.length > 0,
    plan.sessionsPerWeek !== null && plan.weeks !== null,
    plan.homeProgramme.some((row) => row.exercise.trim() !== ''),
  ].filter(Boolean).length;
}

/** The modalities kept despite a precaution without a reason, by name. */
export function modalitiesNeedingReason(
  plan: PlanShape,
  catalog: PlanCatalog,
  inForce: readonly PrecautionInForce[],
): string[] {
  return plan.modalities.flatMap((chosen) => {
    const modality = catalog.modalities.find((m) => m.key === chosen.key);
    return modality && modalityWarnings(modality, inForce).length > 0 && chosen.reason.trim() === ''
      ? [modality.name]
      : [];
  });
}

export interface PlanDefaults {
  /** The visit's IST date. */
  visitDate: string;
  reviewWeeks: number;
  consultantId: string;
}

/**
 * The plan as it stands: the defaults filled in (the review date, the suggested questionnaires,
 * the consultant as treating physio). Shown on screen and written by the sign service (CLN-09).
 */
export function resolvedPlan<P extends PlanShape>(
  plan: P,
  defaults: PlanDefaults,
  suggested: readonly string[],
): P & { reviewDate: string; questionnaires: string[]; treatingPhysioId: string } {
  return {
    ...plan,
    reviewDate: plan.reviewDate || defaultReviewDate(defaults.visitDate, defaults.reviewWeeks),
    questionnaires: plan.questionnaires ?? [...suggested],
    treatingPhysioId: plan.treatingPhysioId || defaults.consultantId,
  };
}
