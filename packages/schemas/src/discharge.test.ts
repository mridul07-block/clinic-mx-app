import { describe, expect, it } from 'vitest';
import {
  LOST_TO_FOLLOW_UP_CHECK_TIME,
  dischargeEpisodeSchema,
  dischargeReasonRefusal,
  lostToFollowUpTitle,
  REVIEW_OVERDUE_CHECK_TIME,
  reviewOverdueTitle,
} from './discharge';
import { istInstant } from './ist';
import { nextDailyRun, taskKindLabel } from './tasks';

const episodeId = '00000000-0000-4000-8000-000000000501';

// OUT-10 (user decisions 27 October 2026): a reason from the list, a note for Other; a recovered
// reason only after treatment; the lost to follow up check daily at 6:00 AM IST.
describe('discharge', () => {
  it('needs a reason from the list, and a note for Other, trimmed', () => {
    expect(dischargeEpisodeSchema.safeParse({ episodeId }).error?.issues[0]?.message).toBe(
      'Choose the discharge reason.',
    );
    expect(
      dischargeEpisodeSchema.safeParse({ episodeId, reason: 'recovered' }).error?.issues[0]
        ?.message,
    ).toBe('Choose the discharge reason.');
    expect(
      dischargeEpisodeSchema.safeParse({ episodeId, reason: 'other', note: '  ' }).error?.issues[0]
        ?.message,
    ).toBe('Say why the episode is discharged.');
    expect(
      dischargeEpisodeSchema.parse({ episodeId, reason: 'other', note: ' Moved city. ' }),
    ).toEqual({ episodeId, reason: 'other', note: 'Moved city.', goals: [] });
    expect(dischargeEpisodeSchema.parse({ episodeId, reason: 'patient_choice' })).toEqual({
      episodeId,
      reason: 'patient_choice',
      goals: [],
    });
    expect(
      dischargeEpisodeSchema.safeParse({ episodeId, reason: 'other', note: 'x'.repeat(1001) })
        .success,
    ).toBe(false);
  });

  // OUT-11: what the report prints, written at discharge.
  it('takes an outcome per goal, and ongoing needs and recommendations, trimmed', () => {
    expect(
      dischargeEpisodeSchema.parse({
        episodeId,
        reason: 'goals_achieved',
        goals: ['achieved', 'partly_achieved'],
        ongoingNeeds: ' Keep the home programme. ',
        recommendations: ' Review in 3 months. ',
      }),
    ).toMatchObject({
      goals: ['achieved', 'partly_achieved'],
      ongoingNeeds: 'Keep the home programme.',
      recommendations: 'Review in 3 months.',
    });
    expect(
      dischargeEpisodeSchema.safeParse({ episodeId, reason: 'goals_achieved', goals: [''] }).error
        ?.issues[0]?.message,
    ).toBe('Mark each goal Achieved, Partly achieved or Not achieved.');
    expect(
      dischargeEpisodeSchema.safeParse({
        episodeId,
        reason: 'goals_achieved',
        recommendations: 'x'.repeat(2001),
      }).error?.issues[0]?.message,
    ).toBe('Keep the recommendations under 2000 characters.');
  });

  it('counts recovered only after treatment, never from a lost episode', () => {
    const active = { status: 'active' as const, pausedFrom: null };
    const proposed = { status: 'plan_proposed' as const, pausedFrom: null };
    const lost = { status: 'lost_to_follow_up' as const, pausedFrom: 'active' as const };
    const held = { status: 'on_hold' as const, pausedFrom: 'active' as const };
    expect(dischargeReasonRefusal(active, 'goals_achieved')).toBeUndefined();
    expect(dischargeReasonRefusal(held, 'independent_management')).toBeUndefined();
    expect(dischargeReasonRefusal(proposed, 'goals_achieved')).toBe(
      'Goals achieved needs treatment first: the episode was Plan proposed. Non attendance is never counted as recovered.',
    );
    expect(dischargeReasonRefusal(lost, 'goals_achieved')).toMatch(/needs treatment first/);
    expect(dischargeReasonRefusal(lost, 'lost_to_follow_up')).toBeUndefined();
    expect(dischargeReasonRefusal(proposed, 'other')).toBeUndefined();
    expect(
      dischargeReasonRefusal({ status: 'discharged', pausedFrom: null }, 'patient_choice'),
    ).toBe('The episode is discharged; a new problem or a recurrence opens a new episode.');
  });

  it('checks for lost episodes every morning at 6:00 AM IST, naming the date, not the patient', () => {
    expect(
      nextDailyRun(istInstant('2026-11-02', 5 * 60), '2026-11-01', LOST_TO_FOLLOW_UP_CHECK_TIME),
    ).toEqual({ date: '2026-11-02', runAt: istInstant('2026-11-02', 6 * 60) });
    expect(
      nextDailyRun(istInstant('2026-11-02', 6 * 60), '2026-11-02', LOST_TO_FOLLOW_UP_CHECK_TIME)
        .date,
    ).toBe('2026-11-03');
    expect(() => nextDailyRun(new Date(), '2026-11-02', '25:00')).toThrow();
    expect(lostToFollowUpTitle(istInstant('2026-09-27', 10 * 60))).toMatch(
      /^Lost to follow up: no visit since 27 Sept? 2026$/,
    );
    expect(taskKindLabel('review.lost_to_follow_up')).toBe('Lost to follow up');
  });

  // ALT-02: the overdue 6 week review check names the review date; both new kinds have labels.
  it('checks for overdue reviews every morning at 6:00 AM IST, naming the review date', () => {
    expect(
      nextDailyRun(istInstant('2026-11-02', 7 * 60), '2026-11-02', REVIEW_OVERDUE_CHECK_TIME),
    ).toEqual({ date: '2026-11-03', runAt: istInstant('2026-11-03', 6 * 60) });
    expect(reviewOverdueTitle('2026-12-09')).toBe('6 week review overdue since 9 Dec 2026');
    expect(taskKindLabel('review.overdue')).toBe('6 week review overdue');
    expect(taskKindLabel('review.worsening')).toBe('Clinical review: worse or escalated');
  });
});
