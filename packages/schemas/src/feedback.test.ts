import { describe, expect, it } from 'vitest';
import {
  feedbackCounts,
  feedbackSubmissionSchema,
  feedbackSurveys,
  postedFeedback,
} from './feedback';

// PAT-04: the Blueprint's four questions after the consultation, Yes or No each, with an
// optional comment; nothing else is accepted.
describe('Feedback after the consultation', () => {
  const schema = feedbackSubmissionSchema('post_consultation');
  const all = (value: string) =>
    Object.fromEntries(
      feedbackSurveys.post_consultation.questions.map((question) => [question.key, value]),
    );

  it('asks the Blueprint’s four questions, word for word, as version 1', () => {
    expect(feedbackSurveys.post_consultation.version).toBe(1);
    expect(feedbackSurveys.post_consultation.questions.map((question) => question.text)).toEqual([
      'Was your problem explained clearly?',
      'Did you understand the proposed treatment plan?',
      'Were your questions answered?',
      'Were treatment options and charges explained transparently?',
    ]);
  });

  it('takes every answer as Yes or No, with the comment trimmed or none', () => {
    expect(schema.parse({ answers: all('yes'), comment: '  Thank you  ' })).toEqual({
      answers: all('yes'),
      comment: 'Thank you',
    });
    expect(schema.parse({ answers: all('no'), comment: '   ' }).comment).toBeNull();
    expect(schema.parse({ answers: all('no') }).comment).toBeNull();
  });

  it('refuses a missing, extra or other answer, a score and a long comment', () => {
    const three = Object.fromEntries(
      Object.entries(all('yes')).filter(([key]) => key !== 'problem_explained'),
    );
    expect(schema.safeParse({ answers: three }).success).toBe(false);
    expect(schema.safeParse({ answers: { ...all('yes'), other: 'yes' } }).success).toBe(false);
    expect(schema.safeParse({ answers: { ...all('yes'), plan_understood: 'maybe' } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ answers: all('yes'), score: 9 }).success).toBe(false);
    expect(schema.safeParse({ answers: all('yes'), comment: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });

  it('reads the posted form and counts Yes and No per question', () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(all('yes'))) form.set(key, value);
    form.set('plan_understood', 'no');
    form.set('comment', 'Clear');
    const sent = schema.parse(postedFeedback('post_consultation', form));
    expect(sent.answers.plan_understood).toBe('no');
    const counts = feedbackCounts('post_consultation', [sent, { answers: all('yes') }]);
    expect(counts.find((count) => count.key === 'plan_understood')).toMatchObject({
      yes: 1,
      no: 1,
    });
    expect(counts[0]).toMatchObject({ key: 'problem_explained', yes: 2, no: 0 });
  });
});
