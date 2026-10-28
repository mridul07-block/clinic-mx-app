import { z } from 'zod';

/**
 * Patient feedback (PAT-04; PRD J4.1 and M14; TAD `feedback`). Recommended defaults chosen under
 * the user's standing approval, 28 October 2026 (DECISION PAT-04, docs/runbooks/feedback.md).
 *
 * After the consultation the patient answers the Blueprint's four questions (section 14, "Example
 * feedback questions, after the initial consultation"), word for word, Yes or No, with an
 * optional comment. No document gives answer types or other wording: Yes or No follows the
 * questions' own wording and the Frontend Specification's 64 px Yes / No pairs; the 0 to 10 score
 * belongs to discharge (PAT-07, PRD J7.1). A change of wording is a new version; each answer keeps
 * the version it was asked in.
 */

export const feedbackSurveyKeys = ['post_consultation'] as const;
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
  questions: readonly FeedbackQuestion[];
}

export const feedbackSurveys: Record<FeedbackSurveyKey, FeedbackSurvey> = {
  post_consultation: {
    version: 1,
    title: 'Your consultation',
    questions: [
      { key: 'problem_explained', text: 'Was your problem explained clearly?' },
      { key: 'plan_understood', text: 'Did you understand the proposed treatment plan?' },
      { key: 'questions_answered', text: 'Were your questions answered?' },
      {
        key: 'options_and_charges_explained',
        text: 'Were treatment options and charges explained transparently?',
      },
    ],
  },
};

/** The longest optional comment, in characters. */
export const feedbackCommentMax = 1000;

const answer = z.enum(feedbackAnswers, { error: 'Please choose Yes or No.' });

/** What the patient sends for a survey: every question answered, and the optional comment. */
export function feedbackSubmissionSchema(survey: FeedbackSurveyKey) {
  const answers = Object.fromEntries(
    feedbackSurveys[survey].questions.map((question) => [question.key, answer]),
  ) as Record<string, typeof answer>;
  return z.strictObject({
    answers: z.strictObject(answers),
    comment: z
      .string()
      .trim()
      .max(feedbackCommentMax, {
        error: `Please keep the comment under ${String(feedbackCommentMax)} characters.`,
      })
      .optional()
      .transform((value) => (value ? value : null)),
  });
}

export type FeedbackSubmission = z.output<ReturnType<typeof feedbackSubmissionSchema>>;

/** The form's fields as posted: one radio group per question, named by its key, and `comment`. */
export function postedFeedback(survey: FeedbackSurveyKey, form: FormData): unknown {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  return {
    answers: Object.fromEntries(
      feedbackSurveys[survey].questions.map((question) => [question.key, read(question.key)]),
    ),
    comment: read('comment'),
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
