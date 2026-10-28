import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { showDischargeFeedback, showFeedback, submitFeedback } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  withPatientAccess: vi.fn(),
  episodeRecord: vi.fn(),
  feedbackTarget: vi.fn(),
  liveFeedbackLink: vi.fn(),
  dischargeFeedbackTarget: vi.fn(),
  liveDischargeFeedbackLink: vi.fn(),
  feedbackSubject: vi.fn(),
  insertFeedback: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const links = vi.hoisted(() => ({
  PatientLinkError: class PatientLinkError extends Error {},
  completePatientLink: vi.fn(),
  issuePatientLink: vi.fn(),
  patientLinkPath: vi.fn(),
  verifyPatientLink: vi.fn(),
}));
vi.mock('../patient-links/services', () => links);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const episodeId = '00000000-0000-4000-8000-000000000e01';
const appointmentId = '00000000-0000-4000-8000-000000000a01';
const patientId = '00000000-0000-4000-8000-000000000501';
const desk = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000203',
  email: 'desk@clinicmx.test',
  name: 'Test Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = desk()) => ({ db: {} as Db, actor });
const expiresAt = new Date('2026-11-04T00:00:00Z');
const link = { id: 'link', patientId, purpose: 'feedback' as const };
const subject = {
  surveyKey: 'post_consultation' as const,
  patientId,
  episodeId,
  appointmentId,
  consultationId: 'consultation',
  centreId: hsr,
  physioId: 'physio',
};

/** The form as posted; it names its survey, after the consultation unless said. */
function posted(values: Record<string, string>, survey = 'post_consultation'): FormData {
  const form = new FormData();
  form.set('survey', survey);
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}
const all = {
  problem_explained: 'yes',
  plan_understood: 'no',
  questions_answered: 'yes',
  options_and_charges_explained: 'yes',
};

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(links)]) {
    if ('mockReset' in fn) fn.mockReset();
  }
  db.withStaffAccess.mockImplementation(
    (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
  );
  db.withPatientAccess.mockImplementation(
    (_db: unknown, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
  );
  db.episodeRecord.mockResolvedValue({ id: episodeId, patientId, centreId: hsr, status: 'active' });
});

// PAT-04: the desk shows the consultation's working feedback link, or issues one, or says it is
// received; patients send all four answers once.
describe('Rate your visit QR', () => {
  it('shows the working link again, or issues one for the consultation’s visit', async () => {
    db.feedbackTarget.mockResolvedValue({ appointmentId, patientId, received: false });
    db.liveFeedbackLink.mockResolvedValue({ id: 'live', expiresAt });
    links.patientLinkPath.mockReturnValue('/p/live');
    expect(await showFeedback(context(), { episodeId })).toEqual({
      received: false,
      linkId: 'live',
      path: '/p/live',
      expiresAt,
    });
    db.liveFeedbackLink.mockResolvedValue(undefined);
    links.issuePatientLink.mockResolvedValue({ linkId: 'new', path: '/p/new', expiresAt });
    expect(await showFeedback(context(), { episodeId })).toMatchObject({ path: '/p/new' });
    expect(links.issuePatientLink).toHaveBeenCalledWith(fakeTx, {
      patientId,
      appointmentId,
      purpose: 'feedback',
    });
  });

  it('says received once answered, and refuses before signing, elsewhere and for a physio', async () => {
    db.feedbackTarget.mockResolvedValue({ appointmentId, patientId, received: true });
    expect(await showFeedback(context(), { episodeId })).toEqual({ received: true });
    db.feedbackTarget.mockResolvedValue(undefined);
    await expect(showFeedback(context(), { episodeId })).rejects.toThrow(/signed/);
    await expect(
      showFeedback(context(desk({ centreIds: ['00000000-0000-4000-8000-000000000102'] })), {
        episodeId,
      }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      showFeedback(context(desk({ role: 'physiotherapist', treatsPatients: true })), {
        episodeId,
      }),
    ).rejects.toThrow(NotAllowedError);
  });
});

describe('Sending feedback', () => {
  it('records the four answers and the comment, then completes the link', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.feedbackSubject.mockResolvedValue(subject);
    expect(await submitFeedback('token', posted({ ...all, comment: ' Thanks ' }))).toEqual({
      status: 'sent',
    });
    expect(db.insertFeedback).toHaveBeenCalledWith(fakeTx, {
      linkId: 'link',
      subject,
      surveyVersion: 1,
      answers: all,
      comment: 'Thanks',
      score: null,
    });
    expect(links.completePatientLink).toHaveBeenCalledWith(fakeTx, link);
  });

  it('asks again for a missing answer, keeping what was posted', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    const three = Object.fromEntries(
      Object.entries(all).filter(([key]) => key !== 'plan_understood'),
    );
    const result = await submitFeedback('token', posted({ ...three, comment: 'Kind' }));
    expect(result).toEqual({
      status: 'invalid',
      errors: { plan_understood: 'Please choose Yes or No.' },
      values: { ...three, comment: 'Kind' },
    });
    expect(db.insertFeedback).not.toHaveBeenCalled();
  });

  it('treats a used link as sent, and a closed or other link as not open', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'used', purpose: 'feedback' });
    expect(await submitFeedback('token', posted(all))).toEqual({ status: 'sent' });
    links.verifyPatientLink.mockResolvedValue({
      status: 'valid',
      link: { ...link, purpose: 'my_plan' },
    });
    expect(await submitFeedback('token', posted(all))).toEqual({ status: 'link' });
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.feedbackSubject.mockResolvedValue(undefined);
    expect(await submitFeedback('token', posted(all))).toEqual({ status: 'link' });
    expect(db.insertFeedback).not.toHaveBeenCalled();
  });

  it('treats a post that lost a race to another as already sent', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.feedbackSubject.mockResolvedValue(subject);
    db.insertFeedback.mockRejectedValue(
      Object.assign(new Error('Failed query'), { cause: { code: '23505' } }),
    );
    expect(await submitFeedback('token', posted(all))).toEqual({ status: 'link' });
    db.insertFeedback.mockRejectedValue(new Error('something else'));
    await expect(submitFeedback('token', posted(all))).rejects.toThrow('something else');
  });
});

// PAT-07: the discharge feedback QR for a discharged episode, and its answers with the score.
describe('Discharge feedback', () => {
  const atDischarge = {
    goals_achieved: 'yes',
    continue_independently: 'yes',
    satisfied_with_care: 'no',
  };
  const discharged = {
    ...subject,
    surveyKey: 'discharge' as const,
    appointmentId: null,
    consultationId: null,
  };

  it('shows the working link, issues one for the episode, or says received', async () => {
    db.dischargeFeedbackTarget.mockResolvedValue({ patientId, received: false });
    db.liveDischargeFeedbackLink.mockResolvedValue(undefined);
    links.issuePatientLink.mockResolvedValue({ linkId: 'new', path: '/p/new', expiresAt });
    expect(await showDischargeFeedback(context(), { episodeId })).toMatchObject({
      received: false,
      path: '/p/new',
    });
    expect(links.issuePatientLink).toHaveBeenCalledWith(fakeTx, {
      patientId,
      episodeId,
      purpose: 'feedback',
    });
    db.dischargeFeedbackTarget.mockResolvedValue({ patientId, received: true });
    expect(await showDischargeFeedback(context(), { episodeId })).toEqual({ received: true });
    db.dischargeFeedbackTarget.mockResolvedValue(undefined);
    await expect(showDischargeFeedback(context(), { episodeId })).rejects.toThrow(/discharged/);
  });

  it('records the answers with the score, and asks for the score when missing', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.feedbackSubject.mockResolvedValue(discharged);
    const missing = await submitFeedback('token', posted(atDischarge, 'discharge'));
    expect(missing).toMatchObject({
      status: 'invalid',
      errors: { score: 'Please choose a number from 0 to 10.' },
    });
    expect(
      await submitFeedback('token', posted({ ...atDischarge, score: '8' }, 'discharge')),
    ).toEqual({ status: 'sent' });
    expect(db.insertFeedback).toHaveBeenCalledWith(fakeTx, {
      linkId: 'link',
      subject: discharged,
      surveyVersion: 1,
      answers: atDischarge,
      comment: null,
      score: 8,
    });
  });

  it('refuses answers for another survey than the link’s, or a form naming none', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.feedbackSubject.mockResolvedValue(subject);
    expect(
      await submitFeedback('token', posted({ ...atDischarge, score: '8' }, 'discharge')),
    ).toEqual({ status: 'link' });
    expect(await submitFeedback('token', posted(all, 'other'))).toEqual({ status: 'link' });
    expect(db.insertFeedback).not.toHaveBeenCalled();
  });
});
