import type { Db, StaffMember } from '@clinic-mx/db';
import { addDays, centreColours, type KpiDailyRow } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import {
  alertsDashboard,
  centresDashboard,
  feedbackDashboard,
  outcomesDashboard,
  teamDashboard,
} from './manager';

const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  appointmentsPerDay: vi.fn(),
  arrivalsToday: vi.fn(),
  bookingChannels: vi.fn(),
  busyHours: vi.fn(),
  centreList: vi.fn(),
  feedbackResponses: vi.fn(),
  kpiDaily: vi.fn(),
  kpiDiagnosisOutcomes: vi.fn(),
  kpiFunnel: vi.fn(),
  managerAlertCounts: vi.fn(),
  paymentPendingCounts: vi.fn(),
  staffNames: vi.fn(),
  teamDaily: vi.fn(),
  utilisationOn: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
// Test values only; the real ones are settings rows.
const settings = vi.hoisted((): Record<string, number> => ({
  'dashboard.busy_hours_days': 28,
  'dashboard.channel_days': 30,
  'day.running_late_minutes': 15,
  'kpi.min_outcome_episodes': 3,
  'kpi.target_completion_percent': 80,
  'kpi.target_conversion_percent': 75,
  'kpi.target_meaningful_change_percent': 85,
  'kpi.target_reinjury_percent': 15,
  'kpi.target_notes_same_day_percent': 95,
  'kpi.target_nps': 60,
  'kpi.target_satisfaction_score': 4.5,
}));
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const kor = '00000000-0000-4000-8000-000000000102';
const wfd = '00000000-0000-4000-8000-000000000103';
const manager: StaffMember = {
  id: '00000000-0000-4000-8000-000000000203',
  email: 'manager@clinicmx.test',
  name: 'Test Centre Manager',
  role: 'centre_manager',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr, kor],
  support: false,
};
// 28 October 2026, 11:00 IST.
const now = new Date('2026-10-28T05:30:00Z');
const today = '2026-10-28';
const at = (time: string) => new Date(`${today}T${time}:00+05:30`);

describe('the Centre Manager’s dashboards', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work({}),
    );
    db.centreList.mockResolvedValue([
      { id: hsr, name: 'HSR Layout', active: true, colour: centreColours[0].value },
      { id: kor, name: 'Koramangala', active: true, colour: centreColours[1].value },
      { id: wfd, name: 'Whitefield', active: true, colour: centreColours[2].value },
    ]);
  });

  it('adds the alert counts up across the manager’s centres, with each centre’s share', async () => {
    db.managerAlertCounts.mockResolvedValue([
      { centreId: hsr, item: 'unsigned_notes', n: 3 },
      { centreId: kor, item: 'unsigned_notes', n: 2 },
      { centreId: hsr, item: 'red_flags_emergency', n: 1 },
    ]);
    const view = await alertsDashboard(manager);
    expect(view.centres.map((entry) => entry.name)).toEqual(['HSR Layout', 'Koramangala']);
    const notes = view.items.find((item) => item.item === 'unsigned_notes');
    expect(notes).toMatchObject({ total: 5, link: '/app/tasks' });
    expect(notes?.byCentre).toEqual([
      { name: 'HSR Layout', n: 3 },
      { name: 'Koramangala', n: 2 },
    ]);
    expect(view.items.find((item) => item.item === 'episodes_lost')?.total).toBe(0);
    expect(view.coming.map((entry) => entry.label)).toEqual(['Stalled progress']);
    // PAT-08: open service recovery tasks are counted, and listed in Tasks.
    expect(view.items.find((item) => item.item === 'service_recovery')).toMatchObject({
      total: 0,
      link: '/app/tasks',
    });
  });

  it('shows each centre today: utilisation, no shows, waiting and payment pending', async () => {
    db.kpiDaily.mockResolvedValue([
      { centreId: hsr, day: today, metric: 'no_show_rate', numerator: 2, denominator: 9 },
      { centreId: hsr, day: today, metric: 'consultations', numerator: 4, denominator: null },
      {
        centreId: hsr,
        day: addDays(today, -8),
        metric: 'consultations',
        numerator: 6,
        denominator: null,
      },
    ] satisfies KpiDailyRow[]);
    db.paymentPendingCounts.mockResolvedValue([{ centreId: hsr, sinceToday: 1, earlier: 3 }]);
    db.arrivalsToday.mockResolvedValue([
      // Started 5 minutes after the booked start; still waiting 20 minutes.
      { centreId: hsr, startsAt: at('10:00'), arrivedAt: at('09:50'), startedAt: at('10:05') },
      { centreId: hsr, startsAt: at('10:40'), arrivedAt: at('10:35'), startedAt: null },
    ]);
    db.appointmentsPerDay.mockResolvedValue([{ centreId: hsr, day: today, n: 12 }]);
    db.bookingChannels.mockResolvedValue([
      { channel: 'front_desk', n: 7 },
      { channel: 'walk_in', n: 2 },
      { channel: 'automatic', n: 3 },
    ]);
    db.busyHours.mockResolvedValue([{ weekday: 3, hour: 10, n: 4 }]);
    db.utilisationOn.mockImplementation((_tx: unknown, centreId: string) =>
      Promise.resolve(
        centreId === hsr ? { booked: 180, rostered: 240 } : { booked: 0, rostered: 0 },
      ),
    );
    const view = await centresDashboard(manager, now);
    const centre = view.centres.find((entry) => entry.name === 'HSR Layout');
    expect(centre).toMatchObject({
      utilisation: 75,
      noShows: 2,
      waiting: { median: 5, longest: 5, now: 1, longestNow: 20 },
      paymentPending: { sinceToday: 1, earlier: 3 },
    });
    expect(view.centres.find((entry) => entry.name === 'Koramangala')?.utilisation).toBeNull();
    expect(view.cells.map((cell) => cell.label)).toEqual([
      'Consultations',
      'Plan acceptance',
      'No shows',
      'Active patients',
    ]);
    expect(view.cells[0]).toMatchObject({ value: '4', change: '−2 on the 7 days before' });
    expect(view.channels.parts.map((part) => part.value)).toEqual([0, 7, 2]);
    expect(view.channels.automatic).toBe(3);
    expect(view.perCentre.series[0]?.values.at(-1)).toBe(12);
    expect(view.busy.rows[2]?.values).toEqual([4]);
  });

  it('measures outcomes against targets, weighting pain by episodes, and holds back small groups', async () => {
    const rows: KpiDailyRow[] = [
      { centreId: hsr, day: today, metric: 'treatment_completion', numerator: 9, denominator: 10 },
      {
        centreId: hsr,
        day: addDays(today, -100),
        metric: 'treatment_completion',
        numerator: 1,
        denominator: 2,
      },
    ] satisfies KpiDailyRow[];
    // As the database does: only the days asked for.
    db.kpiDaily.mockImplementation((_tx: unknown, from: string, to: string) =>
      Promise.resolve(rows.filter((row) => row.day >= from && row.day <= to)),
    );
    db.kpiFunnel.mockResolvedValue([
      { centreId: hsr, stage: 'consultation_held', episodes: 10 },
      { centreId: kor, stage: 'consultation_held', episodes: 5 },
      { centreId: hsr, stage: 'in_treatment', episodes: 4 },
    ]);
    db.kpiDiagnosisOutcomes.mockResolvedValue([
      {
        centreId: hsr,
        conditionId: 'knee.pfps',
        conditionName: 'Patellofemoral pain',
        diagnosed: 4,
        discharged: 2,
        paired: 2,
        baselinePain: 6,
        dischargePain: 2,
      },
      {
        centreId: kor,
        conditionId: 'knee.pfps',
        conditionName: 'Patellofemoral pain',
        diagnosed: 1,
        discharged: 2,
        paired: 2,
        baselinePain: 8,
        dischargePain: 4,
      },
      {
        centreId: hsr,
        conditionId: 'ankle.sprain',
        conditionName: 'Lateral ankle sprain',
        diagnosed: 2,
        discharged: 1,
        paired: 1,
        baselinePain: 5,
        dischargePain: 1,
      },
    ]);
    const view = await outcomesDashboard(manager, '90', now);
    const completion = view.bullets.find((bullet) => bullet.key === 'treatment_completion');
    expect(completion).toMatchObject({
      value: 90,
      earlier: 50,
      status: 'on_target',
      counted: '9 of 10',
    });
    const reinjury = view.bullets.find((bullet) => bullet.key === 'reinjury');
    expect(reinjury?.needs).toContain('PAT-10');
    expect(reinjury?.lowerIsBetter).toBe(true);
    expect(view.funnel[0]).toMatchObject({ stage: 'consultation_held', episodes: 15 });
    expect(view.inTreatment).toBe(4);
    expect(view.outcomes).toEqual([{ label: 'Patellofemoral pain', from: 7, to: 3, episodes: 4 }]);
    expect(view.tooFew).toEqual([{ label: 'Lateral ankle sprain', episodes: 1 }]);
    expect(view.topDiagnoses).toContainEqual({ label: 'Patellofemoral pain', value: 5 });
    expect(db.kpiFunnel).toHaveBeenCalledWith({}, addDays(today, -89), today, 'centres');
    // A year and the year before are asked for one at a time, within the longest period.
    await outcomesDashboard(manager, '365', now);
    for (const [, from, to] of db.kpiDaily.mock.calls as [unknown, string, string][]) {
      expect((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1).toBeLessThanOrEqual(366);
    }
  });

  it('gives each physio their notes on time and their visits', async () => {
    db.teamDaily.mockResolvedValue([
      {
        centreId: hsr,
        physioId: 'p1',
        day: addDays(today, -20),
        metric: 'notes_signed_same_day',
        numerator: 9,
        denominator: 10,
      },
      {
        centreId: hsr,
        physioId: 'p1',
        day: addDays(today, -20),
        metric: 'visits_attended',
        numerator: 8,
        denominator: null,
      },
      {
        centreId: hsr,
        physioId: 'p1',
        day: addDays(today, -1),
        metric: 'visits_attended',
        numerator: 5,
        denominator: null,
      },
    ]);
    db.staffNames.mockResolvedValue(new Map([['p1', 'Test Physio']]));
    const view = await teamDashboard(manager, now);
    expect(view.notesOnTime).toEqual([{ label: 'Test Physio', value: 90, counted: '9 of 10' }]);
    // Only the last 7 days count as workload.
    expect(view.workload).toEqual([{ label: 'Test Physio', value: 5 }]);
  });

  it('counts Yes and No by centre and physio, with the comments and the discharge scores', async () => {
    const answers = (plan: string) => ({
      problem_explained: 'yes',
      plan_understood: plan,
      questions_answered: 'yes',
      options_and_charges_explained: 'yes',
    });
    const row = (id: string, physioName: string, plan: string, comment: string | null) => ({
      id,
      submittedAt: new Date('2026-10-27T05:00:00Z'),
      surveyVersion: 1,
      centreId: hsr,
      centreName: 'HSR Layout',
      physioId: id,
      physioName,
      answers: answers(plan),
      comment,
      score: null,
    });
    const atDischarge = (id: string, score: number, comment: string | null) => ({
      ...row(id, 'Test Consultant', 'yes', comment),
      physioId: 'consultant',
      answers: { goals_achieved: 'yes', continue_independently: 'no', satisfied_with_care: 'yes' },
      score,
    });
    db.feedbackResponses.mockImplementation((_tx: unknown, _from: Date, survey: string) =>
      Promise.resolve(
        survey === 'discharge'
          ? [
              // Discharged before who discharged was recorded: one group, not one per answer.
              { ...atDischarge('u', 8, null), physioId: null, physioName: '' },
              { ...atDischarge('v', 8, null), physioId: null, physioName: '' },
              atDischarge('x', 10, 'More evening slots'),
              atDischarge('y', 9, null),
              atDischarge('z', 5, null),
              atDischarge('w', 7, null),
            ]
          : consulted,
      ),
    );
    const consulted = [
      row('a', 'Test Physio A', 'no', 'Please explain the exercises again'),
      row('b', 'Test Physio B', 'yes', null),
      { ...row('c', 'Test Physio A', 'yes', null), physioId: 'a' },
      // Another physio with the same name stays apart.
      row('d', 'Test Physio B', 'yes', null),
    ];
    const dashboard = await feedbackDashboard(manager, '30', now);
    const view = dashboard.afterConsultation;
    // From the window's first IST day.
    expect(db.feedbackResponses.mock.calls[0]?.[1]).toEqual(
      new Date(`${addDays('2026-10-28', -29)}T00:00:00+05:30`),
    );
    expect(view.answered).toBe(4);
    expect(view.questions.find((q) => q.key === 'plan_understood')).toMatchObject({
      yes: 3,
      no: 1,
    });
    expect(view.byCentre).toMatchObject([{ key: hsr, label: 'HSR Layout', answered: 4 }]);
    expect(view.byPhysio.map((tally) => [tally.key, tally.label, tally.answered])).toEqual([
      ['a', 'Test Physio A', 2],
      ['b', 'Test Physio B', 1],
      ['d', 'Test Physio B', 1],
    ]);
    expect(view.comments).toEqual([
      expect.objectContaining({
        physio: 'Test Physio A',
        comment: 'Please explain the exercises again',
      }),
    ]);
    // At discharge: promoters 2, passive 1, detractor 1, so +25 against the clinic's target.
    expect(dashboard.atDischarge.recommendation).toEqual({
      promoters: 2,
      passives: 3,
      detractors: 1,
      nps: 17,
    });
    expect(dashboard.atDischarge.target).toBe('Over 60');
    expect(dashboard.atDischarge.byPhysio).toMatchObject([
      { key: 'consultant', answered: 4, recommendation: { nps: 25 } },
      { key: 'not-recorded', label: 'Not recorded', answered: 2 },
    ]);
    expect(
      dashboard.atDischarge.questions.find((q) => q.key === 'continue_independently'),
    ).toMatchObject({ yes: 0, no: 6 });
    expect(dashboard.atDischarge.comments.map((entry) => entry.comment)).toEqual([
      'More evening slots',
    ]);
    // After the consultation there is no score; satisfaction out of 5 is still to come.
    expect(view.byCentre[0]?.recommendation).toBeNull();
    expect(dashboard.figures.map((figure) => figure.label)).toEqual(['Patient satisfaction']);
  });

  it('is for the Super Admin and Centre Managers only', async () => {
    for (const role of ['finance', 'front_desk', 'physiotherapist'] as const) {
      const someone = { ...manager, role };
      await expect(alertsDashboard(someone)).rejects.toThrow(NotAllowedError);
      await expect(centresDashboard(someone, now)).rejects.toThrow(NotAllowedError);
      await expect(outcomesDashboard(someone, '90', now)).rejects.toThrow(NotAllowedError);
      await expect(teamDashboard(someone, now)).rejects.toThrow(NotAllowedError);
      await expect(feedbackDashboard(someone, '30', now)).rejects.toThrow(NotAllowedError);
    }
    expect(db.managerAlertCounts).not.toHaveBeenCalled();
  });
});
