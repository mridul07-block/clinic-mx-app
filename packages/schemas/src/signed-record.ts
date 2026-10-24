import { z } from 'zod';
import type { AssessmentCatalog, Irritability, Stage } from './assessment';
import { consultationScreening, type ConsultationSections } from './consultations';
import type { HealthFormAnswers } from './health-form';
import type { KnowledgeRegion } from './knowledge';
import {
  isPaired,
  knowledgeRegionOfScreening,
  type KnowledgeMeasure,
  type KnowledgeSpecialTest,
  type SpecialTestResult,
} from './objective';
import {
  planQuestionnaires,
  resolvedPlan,
  suggestedQuestionnaires,
  type InterventionKind,
  type PlanCatalog,
  type PlanDefaults,
} from './plan';

/**
 * What signing writes (CLN-09, TAD `measure`, `special_test_result`, `diagnosis`, `plan_of_care`,
 * `plan_modality`): the consultation's sections turned into the record's rows, checked against the
 * knowledge base version it keeps. Pure, so the sign service and its tests share one reading.
 */

export type Limb = 'involved' | 'uninvolved';
export type Side = 'left' | 'right';

export interface SignedMeasure {
  key: string;
  /** Involved or uninvolved for a side by side measure; null for a single value. */
  limb: Limb | null;
  side: Side | null;
  value: number;
  unit: string;
}

export interface SignedRows {
  measures: SignedMeasure[];
  tests: { key: string; result: SpecialTestResult; interpretation: string }[];
  diagnosis: {
    conditionId: string;
    movement: string;
    irritability: Irritability;
    stage: Stage;
    categoryCode: string | null;
    provisional: boolean;
  };
  plan: {
    goals: { text: string; patient: boolean }[];
    interventions: InterventionKind[];
    modalities: { key: string; reason: string }[];
    sessionsPerWeek: number | null;
    weeks: number | null;
    homeProgramme: { exercise: string; dose: string; note: string }[];
    reviewDate: string;
    questionnaires: string[];
    treatingPhysioId: string;
    investigations: string;
    referral: string;
  };
}

export interface SignContext {
  patientAnswers: HealthFormAnswers;
  objectiveCatalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] };
  assessmentCatalog: AssessmentCatalog;
  planCatalog: PlanCatalog;
  planDefaults: PlanDefaults;
  /** Who may be the treating physio (CLN-07's list, the consultant among them). */
  treatingPhysioIds: readonly string[];
}

const otherSide: Record<Side, Side> = { left: 'right', right: 'left' };

/**
 * The rows signing writes, or the problems that stop it: anything the sections name that the
 * knowledge base version no longer holds, or a part left empty. Run after `signingBlockers`.
 */
export function signedRecord(
  sections: ConsultationSections,
  context: SignContext,
): { problems: string[]; rows: SignedRows } {
  const problems: string[] = [];
  const missing = (what: string, key: string) => {
    problems.push(`${what} "${key}" is not in this consultation's knowledge base version.`);
  };
  const { objective, assessment } = sections;

  const side = objective.side === '' ? null : objective.side;
  const measures = Object.entries(objective.measures).flatMap(([key, entry]): SignedMeasure[] => {
    const measure = context.objectiveCatalog.measures.find((m) => m.key === key);
    if (!measure) {
      missing('Measure', key);
      return [];
    }
    const row = (limb: Limb | null, rowSide: Side | null, value: number | undefined) =>
      value === undefined ? [] : [{ key, limb, side: rowSide, value, unit: measure.unit }];
    return isPaired(measure)
      ? [
          ...row('involved', side, entry.involved),
          ...row('uninvolved', side && otherSide[side], entry.uninvolved),
        ]
      : row(null, null, entry.value);
  });

  const tests = objective.tests.flatMap((test) => {
    if (!context.objectiveCatalog.specialTests.some((known) => known.key === test.key)) {
      missing('Special test', test.key);
      return [];
    }
    if (!test.result) {
      problems.push('Choose a result for each special test added.');
      return [];
    }
    return [{ key: test.key, result: test.result, interpretation: test.interpretation }];
  });

  const condition = context.assessmentCatalog.conditions.find(
    (known) => known.conditionId === assessment.conditionId,
  );
  if (!condition) missing('Condition', assessment.conditionId);
  // A condition mapped to a category codes it; otherwise the clinician's choice stands.
  const categoryCode = condition?.categoryCode ?? (assessment.categoryCode || null);
  if (categoryCode && !context.assessmentCatalog.categories.some((c) => c.code === categoryCode)) {
    missing('Diagnosis category', categoryCode);
  }
  if (!assessment.irritability || !assessment.stage || !assessment.movement.trim()) {
    problems.push('The working diagnosis needs its four parts.');
  }

  const screening = consultationScreening(sections, context.patientAnswers);
  const region: KnowledgeRegion | '' =
    objective.region || (screening.region ? knowledgeRegionOfScreening[screening.region] : '');
  const suggested = suggestedQuestionnaires(
    planQuestionnaires(context.planCatalog, region),
    condition,
  );
  const plan = resolvedPlan(sections.plan, context.planDefaults, suggested);
  for (const { key } of plan.modalities) {
    if (!context.planCatalog.modalities.some((m) => m.key === key)) missing('Modality', key);
  }
  for (const key of plan.questionnaires) {
    if (!context.planCatalog.questionnaires.some((q) => q.key === key)) {
      missing('Questionnaire', key);
    }
  }
  if (!context.treatingPhysioIds.includes(plan.treatingPhysioId)) {
    problems.push('Choose a treating physio who treats patients at this centre.');
  }

  return {
    problems,
    rows: {
      measures,
      tests,
      diagnosis: {
        conditionId: assessment.conditionId,
        movement: assessment.movement.trim(),
        irritability: assessment.irritability as Irritability,
        stage: assessment.stage as Stage,
        categoryCode,
        provisional: assessment.provisional,
      },
      plan: {
        goals: plan.goals
          .map((goal) => ({ ...goal, text: goal.text.trim() }))
          .filter((goal) => goal.text !== ''),
        interventions: plan.interventions,
        modalities: plan.modalities.map((m) => ({ key: m.key, reason: m.reason.trim() })),
        sessionsPerWeek: plan.sessionsPerWeek,
        weeks: plan.weeks,
        homeProgramme: plan.homeProgramme.filter((row) => row.exercise.trim() !== ''),
        reviewDate: plan.reviewDate,
        questionnaires: plan.questionnaires,
        treatingPhysioId: plan.treatingPhysioId,
        investigations: plan.investigations.trim(),
        referral: plan.referral.trim(),
      },
    },
  };
}

/** The longest addendum (CLN-09). */
export const ADDENDUM_MAX = 5000;

export const addendumSchema = z.object({
  consultationId: z.guid(),
  text: z
    .string()
    .trim()
    .min(1, 'Write the addendum.')
    .max(ADDENDUM_MAX, `Keep the addendum to ${ADDENDUM_MAX.toLocaleString('en-IN')} characters.`),
});
