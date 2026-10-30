import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClinicMessageError,
  followUpPeriod,
  recordCheckAnswerIn,
  sendFirstTreatmentCheck,
  sendFollowUpCheck,
  sendNoShow,
  sendPackageExpiryReminder,
  sendPlanSessionsList,
  sendRedFlagSafetyAdvice,
  sendReviewRequest,
  sendSession3Check,
} from './clinic-messages';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  alertForMessage: vi.fn(),
  appointmentForMessage: vi.fn(),
  completePatientLinkRow: vi.fn(),
  episodeForMessage: vi.fn(),
  feedbackSubjectOfLink: vi.fn(),
  firstTreatmentAnswered: vi.fn(),
  followUpDue: vi.fn(),
  insertFeedback: vi.fn(),
  liveFeedbackLink: vi.fn(),
  liveMessageLink: vi.fn(),
  messagePatient: vi.fn(),
  newerOpenEpisode: vi.fn(),
  packageForMessage: vi.fn(),
  planSeriesForMessage: vi.fn(),
  queueMessageOnce: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));
const links = vi.hoisted(() => ({ issuePatientLink: vi.fn(), patientLinkPath: vi.fn() }));
vi.mock('../patient-links/services', () => links);
vi.mock('./booking-flow', () => ({
  flowDate: (date: string) => `day ${date}`,
}));

// WA-06: each queued message is checked as still due, then queued once for the patient.
// Generated ids and names only.
const ids = {
  patient: '00000000-0000-4000-8000-000000000a01',
  episode: '00000000-0000-4000-8000-000000000a02',
  appointment: '00000000-0000-4000-8000-000000000a03',
  link: '00000000-0000-4000-8000-000000000a04',
  other: '00000000-0000-4000-8000-000000000a05',
};
const sourceKey = 'whatsapp.test:1';
const queued = () =>
  db.queueMessageOnce.mock.calls.map((call) => call[1] as Record<string, unknown>);
const episode = {
  patientId: ids.patient,
  status: 'discharged',
  centreName: 'HSR Layout',
  centrePhone: '+91 80 0000 0001',
  reviewLink: 'https://g.page/r/test-review',
};

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(links)]) fn.mockReset();
  db.messagePatient.mockResolvedValue({
    id: ids.patient,
    name: 'Test Patient One',
    phone: '+919845012345',
  });
  db.queueMessageOnce.mockResolvedValue('message-1');
  db.episodeForMessage.mockResolvedValue(episode);
  links.issuePatientLink.mockResolvedValue({ linkId: ids.link, path: '/p/new-token' });
  links.patientLinkPath.mockReturnValue('/p/live-token');
});

describe('the first treatment check', () => {
  const send = () =>
    sendFirstTreatmentCheck({} as Db, {
      sourceKey,
      appointmentId: ids.appointment,
      episodeId: ids.episode,
    });
  beforeEach(() => {
    db.firstTreatmentAnswered.mockResolvedValue(false);
    db.appointmentForMessage.mockResolvedValue({ patientId: ids.patient });
  });

  it('is queued once for the patient, standing for the visit’s feedback link', async () => {
    db.liveFeedbackLink.mockResolvedValue({ id: ids.other, expiresAt: new Date() });
    expect(await send()).toBe('queued');
    expect(queued()).toEqual([
      {
        patientId: ids.patient,
        toPhone: '+919845012345',
        kind: 'template',
        templateKey: 'first_treatment_check',
        templateVersion: 1,
        language: 'en',
        variables: { patient_name: 'Test' },
        createdBy: 'system:whatsapp',
        patientLinkId: ids.other,
        sourceKey,
      },
    ]);
    expect(links.issuePatientLink).not.toHaveBeenCalled();
  });

  it('issues a feedback link for the visit when none works', async () => {
    db.liveFeedbackLink.mockResolvedValue(undefined);
    await send();
    expect(links.issuePatientLink).toHaveBeenCalledWith('system-tx', {
      patientId: ids.patient,
      appointmentId: ids.appointment,
      purpose: 'feedback',
    });
    expect(queued()[0]?.patientLinkId).toBe(ids.link);
  });

  it('is not sent once the desk’s QR took the answer, and only once per job', async () => {
    db.firstTreatmentAnswered.mockResolvedValue(true);
    expect(await send()).toBe('skipped:answered');
    expect(db.queueMessageOnce).not.toHaveBeenCalled();
    db.firstTreatmentAnswered.mockResolvedValue(false);
    db.queueMessageOnce.mockResolvedValue(null);
    expect(await send()).toBe('already_queued');
  });
});

describe('a follow up', () => {
  const send = () =>
    sendFollowUpCheck({} as Db, { sourceKey, episodeId: ids.episode, count: 6, unit: 'week' });
  beforeEach(() => {
    db.followUpDue.mockResolvedValue('6_week');
    db.newerOpenEpisode.mockResolvedValue(false);
  });

  it('goes with its period, reusing the follow up link the patient holds', async () => {
    db.liveMessageLink.mockResolvedValue({ id: ids.other, expiresAt: new Date() });
    expect(await send()).toBe('queued');
    expect(db.liveMessageLink).toHaveBeenCalledWith('system-tx', ids.episode, 'follow_up');
    expect(queued()[0]).toMatchObject({
      templateKey: 'follow_up_check',
      variables: { patient_name: 'Test', period: '6 weeks' },
      patientLinkId: ids.other,
    });
  });

  it('is not sent unless it is the one due, or with a newer episode not discharged', async () => {
    db.followUpDue.mockResolvedValue('3_month');
    expect(await send()).toBe('skipped:not due');
    db.followUpDue.mockResolvedValue(null);
    expect(await send()).toBe('skipped:not due');
    db.followUpDue.mockResolvedValue('6_week');
    db.newerOpenEpisode.mockResolvedValue(true);
    expect(await send()).toBe('skipped:newer episode');
    expect(db.queueMessageOnce).not.toHaveBeenCalled();
  });

  it('says its interval as people do', () => {
    expect(followUpPeriod(2, 'week')).toBe('2 weeks');
    expect(followUpPeriod(1, 'month')).toBe('1 month');
    expect(followUpPeriod(12, 'month')).toBe('12 months');
  });
});

describe('the review request', () => {
  const send = () => sendReviewRequest({} as Db, { sourceKey, episodeId: ids.episode });

  it('carries a review link’s token for its button', async () => {
    db.liveMessageLink.mockResolvedValue(undefined);
    expect(await send()).toBe('queued');
    expect(links.issuePatientLink).toHaveBeenCalledWith('system-tx', {
      patientId: ids.patient,
      episodeId: ids.episode,
      purpose: 'review',
    });
    expect(queued()[0]).toMatchObject({
      templateKey: 'review_request',
      variables: { patient_name: 'Test', review_link: 'new-token' },
    });
  });

  it('fails visibly for a centre without a Google review link', async () => {
    db.episodeForMessage.mockResolvedValue({ ...episode, reviewLink: null });
    await expect(send()).rejects.toThrow(ClinicMessageError);
    expect(db.queueMessageOnce).not.toHaveBeenCalled();
  });
});

describe('the other messages', () => {
  it('session 3 check: the name only, while the episode is in treatment', async () => {
    const send = () => sendSession3Check({} as Db, { sourceKey, episodeId: ids.episode });
    db.episodeForMessage.mockResolvedValue({ ...episode, status: 'on_hold' });
    expect(await send()).toBe('skipped:not active');
    db.episodeForMessage.mockResolvedValue({ ...episode, status: 'active' });
    expect(await send()).toBe('queued');
    expect(queued()[0]).toMatchObject({
      templateKey: 'session_3_check',
      variables: { patient_name: 'Test' },
      patientLinkId: null,
    });
  });

  it('no show: only while it is still a no show, with the visit in IST', async () => {
    db.appointmentForMessage.mockResolvedValue({
      patientId: ids.patient,
      status: 'no_show',
      // 10:30 IST on 2 November 2026.
      startsAt: new Date('2026-11-02T05:00:00Z'),
      centreName: 'Koramangala',
    });
    const send = () => sendNoShow({} as Db, { sourceKey, appointmentId: ids.appointment });
    expect(await send()).toBe('queued');
    expect(queued()[0]?.variables).toEqual({
      patient_name: 'Test',
      date: 'day 2026-11-02',
      time: '10:30 AM',
      clinic: 'Koramangala',
    });
    db.appointmentForMessage.mockResolvedValue({ patientId: ids.patient, status: 'booked' });
    expect(await send()).toBe('skipped:not a no show');
  });

  it('package expiry: only for an active package with sessions left', async () => {
    const held = {
      patientId: ids.patient,
      sessionsTotal: 10,
      sessionsUsed: 7,
      validUntil: '2026-11-30',
      cancelledAt: null,
      today: '2026-11-20',
    };
    db.packageForMessage.mockResolvedValue(held);
    const send = () => sendPackageExpiryReminder({} as Db, { sourceKey, packageId: ids.other });
    expect(await send()).toBe('queued');
    expect(queued()[0]?.variables).toEqual({
      patient_name: 'Test',
      sessions_left: '3',
      expiry_date: 'day 2026-11-30',
    });
    for (const gone of [
      { ...held, cancelledAt: new Date() },
      { ...held, sessionsUsed: 10 },
      { ...held, today: '2026-12-01' },
    ]) {
      db.packageForMessage.mockResolvedValue(gone);
      expect(await send()).toBe('skipped:not active');
    }
  });

  it('plan sessions list: the series’ sessions on one line, none when all are gone', async () => {
    db.planSeriesForMessage.mockResolvedValue({
      patientId: ids.patient,
      centreName: 'Whitefield',
      starts: [new Date('2026-11-02T04:30:00Z'), new Date('2026-11-04T12:00:00Z')],
    });
    const send = () => sendPlanSessionsList({} as Db, { sourceKey, planBookingId: ids.other });
    expect(await send()).toBe('queued');
    expect(queued()[0]?.variables).toEqual({
      patient_name: 'Test',
      clinic: 'Whitefield',
      sessions: 'day 2026-11-02 10:00 AM; day 2026-11-04 5:30 PM',
    });
    db.planSeriesForMessage.mockResolvedValue({ patientId: ids.patient, starts: [] });
    expect(await send()).toBe('skipped:no sessions');
  });

  it('red flag safety advice: with the centre’s phone, failing visibly without one', async () => {
    db.alertForMessage.mockResolvedValue({ episodeId: ids.episode, status: 'referred' });
    const send = () => sendRedFlagSafetyAdvice({} as Db, { sourceKey, alertId: ids.other });
    expect(await send()).toBe('queued');
    expect(queued()[0]?.variables).toEqual({
      patient_name: 'Test',
      clinic_phone: '+91 80 0000 0001',
    });
    db.episodeForMessage.mockResolvedValue({ ...episode, centrePhone: null });
    await expect(send()).rejects.toThrow(ClinicMessageError);
  });
});

describe('a check’s answer from WhatsApp', () => {
  const subject = {
    surveyKey: 'first_treatment',
    patientId: ids.patient,
    episodeId: ids.episode,
    appointmentId: ids.appointment,
    consultationId: null,
    centreId: ids.other,
    physioId: ids.other,
    followUp: null,
  };
  beforeEach(() => {
    db.feedbackSubjectOfLink.mockResolvedValue(subject);
    db.completePatientLinkRow.mockResolvedValue(true);
  });

  it('is recorded as the link’s answer, the link then used', async () => {
    expect(
      await recordCheckAnswerIn({} as Db, {
        linkId: ids.link,
        template: 'first_treatment_check',
        answer: 'still_sore',
      }),
    ).toBe('recorded');
    expect(db.completePatientLinkRow).toHaveBeenCalledWith({}, ids.link);
    expect(db.insertFeedback).toHaveBeenCalledWith(
      {},
      {
        linkId: ids.link,
        subject,
        surveyVersion: 1,
        answers: { since_first_treatment: 'still_sore' },
        comment: null,
        score: null,
      },
    );
  });

  it('records a follow up with its interval', async () => {
    db.feedbackSubjectOfLink.mockResolvedValue({
      ...subject,
      surveyKey: 'follow_up',
      appointmentId: null,
      followUp: '2_week',
    });
    await recordCheckAnswerIn({} as Db, {
      linkId: ids.link,
      template: 'follow_up_check',
      answer: 'injured_again',
    });
    expect(db.insertFeedback.mock.calls[0]?.[1]).toMatchObject({
      answers: { since_discharge: 'injured_again', follow_up: '2_week' },
    });
  });

  it('records nothing for a link answered or closed, or an answer of another check', async () => {
    const answer = (template: 'first_treatment_check' | 'follow_up_check', value: string) =>
      recordCheckAnswerIn({} as Db, { linkId: ids.link, template, answer: value });
    expect(await answer('first_treatment_check', 'doing_well')).toBe('closed');
    expect(await answer('follow_up_check', 'doing_well')).toBe('closed');
    db.feedbackSubjectOfLink.mockResolvedValue(undefined);
    expect(await answer('first_treatment_check', 'better')).toBe('closed');
    db.feedbackSubjectOfLink.mockResolvedValue(subject);
    db.completePatientLinkRow.mockResolvedValue(false);
    expect(await answer('first_treatment_check', 'better')).toBe('closed');
    expect(db.insertFeedback).not.toHaveBeenCalled();
  });
});
