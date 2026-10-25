import type { ReferralLetterFacts } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPdf } from './render';

const db = vi.hoisted(() => ({
  referralLetterFacts: vi.fn(),
  documentByGenerationKey: vi.fn(),
  systemActor: (component: string) => `system:${component}`,
  withActor: vi.fn((_db: unknown, _actor: unknown, work: (tx: unknown) => unknown) =>
    work({ kind: 'transaction' }),
  ),
}));
vi.mock('@clinic-mx/db', () => db);

const { ReferralLetter, generateReferralLetter, letterSections } =
  await import('./referral-letter');

// ALT-07: the referral letter, from the consultation as it stood or, before one, the health form.
const alertId = '00000000-0000-4000-8000-000000000701';
const facts = (overrides: Partial<ReferralLetterFacts> = {}): ReferralLetterFacts => ({
  alertId,
  patientId: '00000000-0000-4000-8000-000000000002',
  episodeId: '00000000-0000-4000-8000-000000000003',
  centreId: '00000000-0000-4000-8000-000000000004',
  centre: { name: 'HSR Layout', address: '27th Main, HSR Layout', phone: '+918041234567' },
  patient: {
    name: 'Test Patient 0000',
    opNumber: 'HSR-00001',
    dateOfBirth: '1990-03-15',
    sex: 'male',
  },
  visitStartsAt: new Date('2026-10-24T05:00:00Z'),
  referral: {
    found: 'Night pain and weight loss',
    triage: 'urgent_medical_referral',
    referredTo: 'Orthopaedic surgeon',
    reason: 'Constant night pain with 5 kg weight loss over 6 weeks.',
    question: 'Please rule out a bony lesion of the right femur.',
    referredAt: new Date('2026-10-24T05:40:00Z'),
  },
  referrer: { name: 'Test Consultant', credentials: 'BPT, MPT (Ortho)' },
  sections: {
    subjective: { notes: 'INTERNAL', confirmed: { complaint: 'Right thigh pain at night' } },
    objective: {
      notes: 'INTERNAL',
      region: 'knee',
      side: 'right',
      measures: { 'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 } },
      tests: [],
    },
    assessment: { notes: '', movement: 'Antalgic gait', irritability: 'high', stage: '' },
  },
  answers: { onset: 'gradual', investigations: 'X-ray last year, normal' },
  objectiveCatalog: {
    measures: [
      {
        key: 'knee.lsi.quadriceps',
        region: 'knee',
        section: 'Strength',
        name: 'Quadriceps strength',
        unit: 'kg',
        kind: 'lsi',
        inverted: false,
        rule: { kind: 'lsi', passAt: 0.9 },
        direction: null,
        note: null,
      },
    ],
    specialTests: [],
  },
  conditionName: null,
  reports: [{ contentType: 'image/jpeg', createdAt: new Date('2026-10-24T04:50:00Z') }],
  completedVisits: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('letterSections', () => {
  it('prints the referral, the question and what the consultation had found so far', () => {
    const sections = letterSections(facts());
    expect(sections.map((s) => s.heading)).toEqual([
      'Referral',
      'Patient details',
      'Reason for referral',
      'Question for the specialist',
      'Presenting complaint',
      'Relevant findings',
      'Investigations and imaging',
      'Working diagnosis',
      'Treatment so far',
    ]);
    const printed = JSON.stringify(sections);
    for (const text of [
      'Orthopaedic surgeon',
      'Urgent medical referral',
      'Same day physician / orthopaedic / neurosurgical review',
      'Night pain and weight loss',
      'Constant night pain with 5 kg weight loss over 6 weeks.',
      'Please rule out a bony lesion of the right femur.',
      'Right thigh pain at night',
      'LSI 80% · Not yet',
      'X-ray last year, normal',
      'Photo',
      'Antalgic gait',
      'High',
      'Provisional',
      'No treatment yet; seen for consultation on 24 Oct 2026.',
    ]) {
      expect(printed, text).toContain(text);
    }
    expect(printed).not.toContain('INTERNAL');
  });

  it('works from the health form alone, before any consultation', () => {
    const sections = letterSections(
      facts({
        sections: null,
        answers: { complaint: 'Back pain', investigations: '' },
        objectiveCatalog: { measures: [], specialTests: [] },
        reports: [],
        completedVisits: [],
      }),
    );
    expect(sections.map((s) => s.heading)).toEqual([
      'Referral',
      'Patient details',
      'Reason for referral',
      'Question for the specialist',
      'Presenting complaint',
      'Treatment so far',
    ]);
    expect(JSON.stringify(sections)).toContain('Back pain');
  });

  it('lists the visits already completed as treatment so far', () => {
    const printed = JSON.stringify(
      letterSections(
        facts({
          completedVisits: [
            { startsAt: new Date('2026-10-10T05:00:00Z'), typeName: 'Consultation' },
            { startsAt: new Date('2026-10-17T05:00:00Z'), typeName: 'Session' },
          ],
        }),
      ),
    );
    expect(printed).toContain('Consultation, 10 Oct 2026');
    expect(printed).toContain('Session, 17 Oct 2026');
  });
});

describe('ReferralLetter', () => {
  it('renders an A4 PDF on the letterhead with Plex embedded', async () => {
    const bytes = await renderPdf(
      <ReferralLetter facts={facts()} version={1} generatedAt={new Date()} />,
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans\b/);
  }, 20_000);
});

describe('generateReferralLetter', () => {
  const generate = vi.fn(() => Promise.resolve({ id: 'doc', version: 1 }));
  const key = ['referral_letter', alertId].join(':');

  it('makes the letter of a referred alert, keyed by the job', async () => {
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.referralLetterFacts.mockResolvedValue(facts());
    expect(await generateReferralLetter({} as never, alertId, key, generate)).toEqual({
      id: 'doc',
      version: 1,
    });
    expect(generate).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({ kind: 'referral_letter', sourceId: alertId, generationKey: key }),
    );
  });

  it('makes nothing twice, nor for an alert not referred', async () => {
    db.documentByGenerationKey.mockResolvedValue({ id: 'doc', version: 1 });
    expect(await generateReferralLetter({} as never, alertId, key, generate)).toBe('already made');
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.referralLetterFacts.mockResolvedValue(undefined);
    expect(await generateReferralLetter({} as never, alertId, key, generate)).toBe('not referred');
    expect(generate).not.toHaveBeenCalled();
  });
});
