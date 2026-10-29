import type { Db, StaffMember } from '@clinic-mx/db';
import { questionnaireDefinitionSchema } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { loadQuestionnaireStep, showQuestionnaires, submitQuestionnaire } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  withPatientAccess: vi.fn(),
  episodeRecord: vi.fn(),
  questionnaireTarget: vi.fn(),
  liveQuestionnaireLink: vi.fn(),
  questionnairesDue: vi.fn(),
  questionnairesAnswered: vi.fn(),
  questionnairesDone: vi.fn(),
  insertQuestionnaireResult: vi.fn(),
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
const link = { id: 'link', patientId, purpose: 'questionnaire' as const };
const kb = '00000000-0000-4000-8000-0000000000b1';

// A generated test instrument only: three items scored 0 to 4, summed, one may be missing.
const definition = questionnaireDefinitionSchema.parse({
  version: 'test-1',
  items: ['a', 'b', 'c'].map((key) => ({
    kind: 'choice',
    key,
    text: `Test item ${key}`,
    options: [0, 1, 2, 3, 4].map((value) => ({ label: `Answer ${String(value)}`, value })),
  })),
  scoring: { method: 'sum', maxMissing: 1 },
  range: { min: 0, max: 12 },
  better: 'lower',
  meaningfulChange: 2,
  source: 'Generated test instrument',
});
const due = (key: string) => ({
  patientId,
  episodeId,
  centreId: hsr,
  key,
  name: `Test instrument ${key}`,
  kbVersionId: kb,
  definition,
});
const sent = (key: string, answers: unknown, shown = { kbVersionId: kb, version: 'test-1' }) => {
  const form = new FormData();
  form.set('key', key);
  form.set('kbVersionId', shown.kbVersionId);
  form.set('version', shown.version);
  form.set('answers', JSON.stringify(answers));
  return form;
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

// OUT-02: the desk's QR, then the patient fills each questionnaire, scored by our server.
describe('the questionnaires QR', () => {
  it('shows the working link again, or issues one, only while one can be filled', async () => {
    db.questionnaireTarget.mockResolvedValue({ patientId, assigned: 2, fillable: 1 });
    db.liveQuestionnaireLink.mockResolvedValue({ id: 'live', expiresAt });
    links.patientLinkPath.mockReturnValue('/p/live');
    expect(await showQuestionnaires(context(), { episodeId })).toEqual({
      linkId: 'live',
      path: '/p/live',
      expiresAt,
    });
    db.liveQuestionnaireLink.mockResolvedValue(undefined);
    links.issuePatientLink.mockResolvedValue({ linkId: 'new', path: '/p/new', expiresAt });
    expect(await showQuestionnaires(context(), { episodeId })).toMatchObject({ path: '/p/new' });
    expect(links.issuePatientLink).toHaveBeenCalledWith(fakeTx, {
      patientId,
      episodeId,
      purpose: 'questionnaire',
    });
    db.questionnaireTarget.mockResolvedValue({ patientId, assigned: 2, fillable: 0 });
    await expect(showQuestionnaires(context(), { episodeId })).rejects.toThrow(/can be filled yet/);
  });

  it('is for those who check patients in at the centre', async () => {
    for (const actor of [
      desk({ centreIds: ['00000000-0000-4000-8000-000000000102'] }),
      desk({ role: 'physiotherapist', treatsPatients: true }),
      desk({ role: 'finance', centreIds: [] }),
    ]) {
      await expect(showQuestionnaires(context(actor), { episodeId })).rejects.toThrow(
        NotAllowedError,
      );
    }
    expect(db.questionnaireTarget).not.toHaveBeenCalled();
  });
});

describe('filling a questionnaire', () => {
  it('opens the next one to fill, and says which of how many it is', async () => {
    db.questionnairesDue.mockResolvedValue([due('one'), due('two')]);
    db.questionnairesAnswered.mockResolvedValue(1);
    expect(await loadQuestionnaireStep(link)).toMatchObject({ key: 'one', number: 2, of: 3 });
    // Nothing to fill and nothing filled: nothing to show.
    db.questionnairesDue.mockResolvedValue([]);
    db.questionnairesAnswered.mockResolvedValue(0);
    expect(await loadQuestionnaireStep(link)).toBeUndefined();
    expect(links.completePatientLink).not.toHaveBeenCalled();
    // Everything filled, but no send closed it (two at once, or the plan changed): closed now.
    db.questionnairesAnswered.mockResolvedValue(2);
    db.questionnairesDone.mockResolvedValue(true);
    expect(await loadQuestionnaireStep(link)).toBe('done');
    expect(links.completePatientLink).toHaveBeenCalledWith(fakeTx, link);
  });

  it('keeps the raw answers and our score, and closes the link once everything is filled', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.questionnairesDue.mockResolvedValue([due('one'), due('two')]);
    db.questionnairesDone.mockResolvedValue(false);
    // b's 9 is not an answer it allows, so it is missing: 2 + 3 over two items, scaled to three.
    expect(
      await submitQuestionnaire(
        'token',
        sent('one', { a: { value: 2 }, b: { value: 9 }, c: { value: 3 }, extra: { value: 1 } }),
      ),
    ).toBe('next');
    expect(db.insertQuestionnaireResult).toHaveBeenCalledWith(fakeTx, {
      linkId: 'link',
      due: due('one'),
      rawAnswers: { a: { value: 2 }, b: { value: null }, c: { value: 3 } },
      score: 7.5,
      answered: 2,
      missing: 1,
    });
    expect(links.completePatientLink).not.toHaveBeenCalled();

    // The last one, too few answered to score: kept without a score, and the link completes.
    db.questionnairesDue.mockResolvedValue([due('two')]);
    db.questionnairesDone.mockResolvedValue(true);
    expect(await submitQuestionnaire('token', sent('two', { a: { value: 1 } }))).toBe('done');
    expect(db.insertQuestionnaireResult).toHaveBeenLastCalledWith(fakeTx, {
      linkId: 'link',
      due: due('two'),
      rawAnswers: { a: { value: 1 }, b: { value: null }, c: { value: null } },
      score: null,
      answered: 1,
      missing: 2,
    });
    expect(links.completePatientLink).toHaveBeenCalledWith(fakeTx, link);
  });

  it('sends nothing for a questionnaire not due, a bad post or another link', async () => {
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.questionnairesDue.mockResolvedValue([due('one')]);
    expect(await submitQuestionnaire('token', sent('other', {}))).toBe('link');
    // Shown from another version: the page shows the current one instead.
    expect(
      await submitQuestionnaire('token', sent('one', {}, { kbVersionId: kb, version: 'test-0' })),
    ).toBe('link');
    expect(
      await submitQuestionnaire(
        'token',
        sent('one', {}, { kbVersionId: '00000000-0000-4000-8000-0000000000b2', version: 'test-1' }),
      ),
    ).toBe('link');
    const broken = new FormData();
    broken.set('key', 'one');
    broken.set('answers', '{not json');
    expect(await submitQuestionnaire('token', broken)).toBe('link');
    expect(await submitQuestionnaire('token', sent('one', { a: { value: 'two' } }))).toBe('link');
    links.verifyPatientLink.mockResolvedValue({
      status: 'valid',
      link: { ...link, purpose: 'feedback' },
    });
    expect(await submitQuestionnaire('token', sent('one', {}))).toBe('link');
    expect(db.insertQuestionnaireResult).not.toHaveBeenCalled();
    links.verifyPatientLink.mockResolvedValue({ status: 'used', purpose: 'questionnaire' });
    expect(await submitQuestionnaire('token', sent('one', {}))).toBe('done');
  });
});
