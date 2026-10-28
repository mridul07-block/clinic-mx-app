import { z } from 'zod';

/**
 * Patient feedback (PAT-04, PAT-07; PRD J4.1, J7.1 and M14; TAD `feedback`). Recommended defaults
 * chosen under the user's standing approval, 28 October 2026 (DECISION PAT-04 and PAT-07,
 * docs/runbooks/feedback.md).
 *
 * The questions are the Blueprint's (section 14, "Example feedback questions"), word for word:
 * after the initial consultation, and at discharge. They are answered Yes or No, following their
 * own wording and the Frontend Specification's 64 px Yes / No pairs; a question asking for words
 * ("What could Movementology improve?") is the optional comment. At discharge the patient also
 * gives the 0 to 10 recommendation score (PRD J7.1). No document words that question; the usual
 * recommendation question stands in until the client gives theirs (DECISION PAT-07). A change of
 * wording is a new version; each answer keeps the version it was asked in.
 */

export const feedbackSurveyKeys = ['post_consultation', 'discharge'] as const;
export type FeedbackSurveyKey = (typeof feedbackSurveyKeys)[number];

export const feedbackAnswers = ['yes', 'no'] as const;
export type FeedbackAnswer = (typeof feedbackAnswers)[number];

export interface FeedbackQuestion {
  key: string;
  text: string;
}

export interface FeedbackSurvey {
  version: number;
  title: string;
  intro: string;
  /** Yes or No each. */
  questions: readonly FeedbackQuestion[];
  /** The optional comment's question. */
  commentLabel: string;
  /** The 0 to 10 recommendation question, when the survey asks it. */
  score: string | null;
}

export const feedbackSurveys: Record<FeedbackSurveyKey, FeedbackSurvey> = {
  post_consultation: {
    version: 1,
    title: 'Your consultation',
    intro: 'Four quick questions about your consultation. Your answers help us improve your care.',
    questions: [
      { key: 'problem_explained', text: 'Was your problem explained clearly?' },
      { key: 'plan_understood', text: 'Did you understand the proposed treatment plan?' },
      { key: 'questions_answered', text: 'Were your questions answered?' },
      {
        key: 'options_and_charges_explained',
        text: 'Were treatment options and charges explained transparently?',
      },
    ],
    commentLabel: 'Anything else you would like to tell us? (optional)',
    score: null,
  },
  discharge: {
    version: 1,
    title: 'Your care with us',
    intro: 'A few questions about your care with us. Your answers help us improve our care.',
    questions: [
      {
        key: 'goals_achieved',
        text: 'Have you achieved the functional goals that matter most to you?',
      },
      {
        key: 'continue_independently',
        text: 'Do you understand how to continue your rehabilitation independently?',
      },
      {
        key: 'satisfied_with_care',
        text: 'Were you satisfied with your clinical care and communication?',
      },
    ],
    commentLabel: 'What could Movementology improve? (optional)',
    // DECISION PAT-07: no document words the 0 to 10 question; the usual one stands in.
    score: 'How likely are you to recommend Movementology to a friend or family member?',
  },
};

/** The longest optional comment, in characters. */
export const feedbackCommentMax = 1000;

/** The recommendation scale's ends, and the bands the Net Promoter Score counts. */
export const feedbackScoreMax = 10;
export const promoterFrom = 9;
export const detractorTo = 6;

const answer = z.enum(feedbackAnswers, { error: 'Please choose Yes or No.' });
const scoreError = 'Please choose a number from 0 to 10.';
// A whole number from 0 to 10 as posted (the form sends text); nothing else, not even "".
const score = z
  .string({ error: scoreError })
  .regex(/^(?:[0-9]|10)$/, { error: scoreError })
  .transform(Number);

/** What the patient sends for a survey: every question answered, the score, and the comment. */
export function feedbackSubmissionSchema(survey: FeedbackSurveyKey) {
  const definition = feedbackSurveys[survey];
  const answers = Object.fromEntries(
    definition.questions.map((question) => [question.key, answer]),
  ) as Record<string, typeof answer>;
  const comment = z
    .string()
    .trim()
    .max(feedbackCommentMax, {
      error: `Please keep the comment under ${String(feedbackCommentMax)} characters.`,
    })
    .optional()
    .transform((value) => (value ? value : null));
  return z.strictObject({
    answers: z.strictObject(answers),
    comment,
    score: definition.score
      ? score
      : z
          .undefined()
          .optional()
          .transform(() => null),
  });
}

export type FeedbackSubmission = z.output<ReturnType<typeof feedbackSubmissionSchema>>;

/**
 * The form's fields as posted: one radio group per question, named by its key, `comment`, and
 * `score` when the survey asks it.
 */
export function postedFeedback(survey: FeedbackSurveyKey, form: FormData): unknown {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const definition = feedbackSurveys[survey];
  return {
    answers: Object.fromEntries(
      definition.questions.map((question) => [question.key, read(question.key)]),
    ),
    comment: read('comment'),
    ...(definition.score ? { score: read('score') } : {}),
  };
}

/** Yes and No counted per question, in the survey's order. */
export function feedbackCounts(
  survey: FeedbackSurveyKey,
  rows: { answers: Record<string, string> }[],
): { key: string; text: string; yes: number; no: number }[] {
  return feedbackSurveys[survey].questions.map((question) => ({
    key: question.key,
    text: question.text,
    yes: rows.filter((row) => row.answers[question.key] === 'yes').length,
    no: rows.filter((row) => row.answers[question.key] === 'no').length,
  }));
}

/**
 * The Net Promoter Score of 0 to 10 scores: promoters (9 or 10) less detractors (0 to 6), as a
 * share of all, rounded; null with no scores.
 */
export function netPromoter(scores: number[]): {
  promoters: number;
  passives: number;
  detractors: number;
  nps: number | null;
} {
  const promoters = scores.filter((value) => value >= promoterFrom).length;
  const detractors = scores.filter((value) => value <= detractorTo).length;
  const passives = scores.length - promoters - detractors;
  return {
    promoters,
    passives,
    detractors,
    nps: scores.length === 0 ? null : Math.round(((promoters - detractors) / scores.length) * 100),
  };
}

/** The service recovery task kinds (PAT-08). */
export const SERVICE_RECOVERY_TASKS = [
  'feedback.service_recovery',
  'feedback.service_recovery_director',
] as const;

/**
 * What made a service recovery task (PAT-08), from its details: the questions answered No, in
 * their words, and the score; null for details not shaped so.
 */
export function serviceRecoveryOf(
  details: Record<string, unknown>,
): { when: string; noQuestions: string[]; score: number | null } | null {
  const parsed = z
    .object({
      surveyKey: z.enum(feedbackSurveyKeys),
      noAnswers: z.array(z.string()),
      score: z.number().int().nullable(),
    })
    .safeParse(details);
  if (!parsed.success) return null;
  const survey = feedbackSurveys[parsed.data.surveyKey];
  return {
    when: parsed.data.surveyKey === 'discharge' ? 'At discharge' : 'After the consultation',
    noQuestions: parsed.data.noAnswers.map(
      (key) => survey.questions.find((question) => question.key === key)?.text ?? key,
    ),
    score: parsed.data.score,
  };
}

/**
 * The day after first treatment check (PAT-05; PRD J5.6: "Day after first treatment check: Better,
 * Same, Still sore. "Still sore" alerts the physio."; TAD jobs: next day, 10:00 AM). The answers are
 * the PRD's, word for word; one tap each, nothing else asked. Recommended defaults chosen under the
 * user's standing approval, 29 October 2026 (DECISION PAT-05, docs/runbooks/feedback.md).
 */
export const firstTreatmentAnswers = ['better', 'same', 'still_sore'] as const;
export type FirstTreatmentAnswer = (typeof firstTreatmentAnswers)[number];

export const firstTreatmentAnswerLabels: Record<FirstTreatmentAnswer, string> = {
  better: 'Better',
  same: 'Same',
  still_sore: 'Still sore',
};

/** The key the answer is stored under in `feedback.answers`. */
export const FIRST_TREATMENT_ANSWER_KEY = 'since_first_treatment';

/** The physio's task when the answer is Still sore. */
export const STILL_SORE_TASK = 'review.still_sore';

export const firstTreatmentCheck = {
  version: 1,
  // DECISION PAT-05: no document words the question; a placeholder until the client gives theirs.
  title: 'Since your first treatment',
  question: 'How do you feel since your first treatment?',
} as const;

export const firstTreatmentAnswerSchema = z.strictObject({
  answer: z.enum(firstTreatmentAnswers, { error: 'Choose Better, Same or Still sore.' }),
});
