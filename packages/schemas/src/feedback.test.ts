import { describe, expect, it } from 'vitest';
import {
  feedbackCounts,
  feedbackSubmissionSchema,
  feedbackSurveys,
  firstTreatmentAnswerLabels,
  firstTreatmentAnswerSchema,
  firstTreatmentAnswers,
  netPromoter,
  postedFeedback,
  serviceRecoveryOf,
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
      score: null,
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

// PAT-07: at discharge, the Blueprint's three Yes or No questions, its fourth as the comment, and
// the 0 to 10 recommendation score; the Net Promoter Score from the scores.
describe('Feedback at discharge', () => {
  const schema = feedbackSubmissionSchema('discharge');
  const answers = {
    goals_achieved: 'yes',
    continue_independently: 'yes',
    satisfied_with_care: 'no',
  };

  it('asks the Blueprint’s discharge questions word for word, its fourth as the comment', () => {
    const survey = feedbackSurveys.discharge;
    expect(survey.questions.map((question) => question.text)).toEqual([
      'Have you achieved the functional goals that matter most to you?',
      'Do you understand how to continue your rehabilitation independently?',
      'Were you satisfied with your clinical care and communication?',
    ]);
    expect(survey.commentLabel).toBe('What could Movementology improve? (optional)');
    expect(survey.score).not.toBeNull();
  });

  it('needs a whole score from 0 to 10, as posted', () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(answers)) form.set(key, value);
    form.set('score', '9');
    expect(schema.parse(postedFeedback('discharge', form))).toEqual({
      answers,
      comment: null,
      score: 9,
    });
    for (const wrong of [undefined, '', '11', '-1', '7.5', 'ten']) {
      expect(schema.safeParse({ answers, score: wrong }).success).toBe(false);
    }
    expect(schema.safeParse({ answers, score: '0' }).success).toBe(true);
  });

  it('counts promoters, passives and detractors into the Net Promoter Score', () => {
    expect(netPromoter([])).toEqual({ promoters: 0, passives: 0, detractors: 0, nps: null });
    expect(netPromoter([10, 9, 8, 7, 6, 0])).toEqual({
      promoters: 2,
      passives: 2,
      detractors: 2,
      nps: 0,
    });
    expect(netPromoter([10, 10, 9, 5]).nps).toBe(50);
  });
});

// PAT-08: a service recovery task card says what was negative, in the questions' own words.
describe('Service recovery details', () => {
  it('names the questions answered No and the score', () => {
    expect(
      serviceRecoveryOf({
        feedbackId: 'f',
        surveyKey: 'post_consultation',
        noAnswers: ['plan_understood'],
        score: null,
      }),
    ).toEqual({
      when: 'After the consultation',
      noQuestions: ['Did you understand the proposed treatment plan?'],
      score: null,
    });
    expect(
      serviceRecoveryOf({ surveyKey: 'discharge', noAnswers: [], score: 4, recoveryTaskId: 't' }),
    ).toEqual({ when: 'At discharge', noQuestions: [], score: 4 });
    expect(serviceRecoveryOf({ jobId: 'x' })).toBeNull();
  });
});

// PAT-05: the day after first treatment check's answers are the PRD's, word for word.
describe('the day after first treatment check', () => {
  it('takes Better, Same or Still sore, nothing else', () => {
    expect(firstTreatmentAnswers.map((a) => firstTreatmentAnswerLabels[a])).toEqual([
      'Better',
      'Same',
      'Still sore',
    ]);
    expect(firstTreatmentAnswerSchema.parse({ answer: 'still_sore' })).toEqual({
      answer: 'still_sore',
    });
    for (const bad of [{ answer: 'worse' }, {}, { answer: 'same', comment: 'Free text' }]) {
      expect(firstTreatmentAnswerSchema.safeParse(bad).success).toBe(false);
    }
  });
});
