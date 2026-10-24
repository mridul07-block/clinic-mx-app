import type { ConsultationSummaryFacts } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPdf } from './render';

const db = vi.hoisted(() => ({
  CONSULTATION_SUMMARY_JOB: 'documents.consultation_summary',
  consultationSummaryFacts: vi.fn(),
  documentByGenerationKey: vi.fn(),
  systemActor: (component: string) => `system:${component}`,
  withActor: vi.fn((_db: unknown, _actor: unknown, work: (tx: unknown) => unknown) =>
    work({ kind: 'transaction' }),
  ),
}));
vi.mock('@clinic-mx/db', () => db);
// Test value only; the real one is the `documents.summary_prints_category` row.
const setting = vi.hoisted(() => ({ getSetting: vi.fn(() => Promise.resolve(false)) }));
vi.mock('../settings/settings', () => setting);

const { ConsultationSummary, generateConsultationSummary, summarySections } =
  await import('./consultation-summary');

// ALT-06: the consultation summary prints the signed record for the patient, and nothing
// internal; each job makes one version.
const facts = (overrides: Partial<ConsultationSummaryFacts> = {}): ConsultationSummaryFacts => ({
  consultationId: '00000000-0000-4000-8000-000000000001',
  patientId: '00000000-0000-4000-8000-000000000002',
  episodeId: '00000000-0000-4000-8000-000000000003',
  centreId: '00000000-0000-4000-8000-000000000004',
  centre: { name: 'HSR Layout', address: '27th Main, HSR Layout', phone: '+918041234567' },
  centreCode: 'HSR',
  patient: {
    name: 'Test Patient 0000',
    opNumber: 'HSR-00001',
    dateOfBirth: '1990-03-15',
    sex: 'female',
  },
  visitStartsAt: new Date('2026-10-24T05:00:00Z'),
  signedAt: new Date('2026-10-24T06:10:00Z'),
  signer: { name: 'Test Consultant', credentials: 'BPT, MPT (Ortho)' },
  sections: {
    subjective: {
      notes: 'INTERNAL SUBJECTIVE NOTE',
      confirmed: { complaint: 'Knee pain on stairs' },
    },
    screening: { notes: 'INTERNAL SCREENING NOTE', confirmed: {} },
    objective: {
      notes: 'INTERNAL OBJECTIVE NOTE',
      region: 'knee',
      side: 'right',
      measures: { 'knee.lsi.quadriceps': { involved: 32, uninvolved: 40 } },
      tests: [
        { key: 'knee.lachman', result: 'negative', interpretation: 'Firm end-feel' },
        { key: 'knee.mcmurray', result: 'not_tested', interpretation: '' },
      ],
    },
    assessment: { notes: 'INTERNAL ASSESSMENT NOTE' },
    plan: {
      notes: 'INTERNAL PLAN NOTE',
      modalities: [{ key: 'laser', reason: 'INTERNAL PRECAUTION REASON' }],
    },
  },
  answers: { onset: 'gradual', investigations: 'X-ray in 2025, normal' },
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
    specialTests: [
      {
        key: 'knee.lachman',
        region: 'knee',
        category: 'Ligament',
        test: 'Lachman test',
        targets: 'ACL',
        positiveFinding: 'Soft end-feel',
        clinicalNote: '',
      },
    ],
  },
  diagnosis: {
    conditionName: 'Patellar Tendinopathy',
    movement: 'Quad dominance on step down',
    irritability: 'moderate',
    stage: 'subacute',
    provisional: true,
    categoryName: 'Knee - Others',
  },
  plan: {
    goals: [{ text: 'Run 10 km again', patient: true }],
    interventions: ['exercise', 'manual_therapy'],
    modalities: ['Low level laser'],
    sessionsPerWeek: 2,
    weeks: 6,
    homeProgramme: [{ exercise: 'Spanish squat', dose: '5 x 45 s', note: '' }],
    reviewDate: '2026-12-05',
    investigations: '',
    referral: '',
  },
  addenda: [],
  ...overrides,
});

const headings = (f: ConsultationSummaryFacts, printsCategory = false) =>
  summarySections(f, printsCategory).map((s) => s.heading);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('summarySections', () => {
  it('prints the signed record in the specification’s order, leaving out empty sections', () => {
    expect(headings(facts())).toEqual([
      'Patient details',
      'Primary complaints',
      'On examination',
      'On investigation',
      'Diagnosis',
      'Plan of treatment',
      'Review plan',
    ]);
    const printed = JSON.stringify(summarySections(facts(), false));
    for (const text of [
      'Test Patient 0000',
      '36 years',
      'Female',
      'HSR-00001',
      '24 Oct 2026',
      'Knee pain on stairs',
      'Gradual (slow)',
      'Involved 32 kg, uninvolved 40 kg',
      'LSI 80% · Not yet',
      'Lachman test',
      'Firm end-feel',
      'X-ray in 2025, normal',
      'Patellar Tendinopathy',
      'Quad dominance on step down',
      'Provisional',
      'Goal: Run 10 km again',
      'Exercise, Manual therapy',
      'Low level laser',
      '2 sessions a week for 6 weeks',
      'Spanish squat',
      '5 Dec 2026',
    ]) {
      expect(printed, text).toContain(text);
    }
  });

  it('never prints notes, precaution reasons, tests not done or the category by default', () => {
    const printed = JSON.stringify(summarySections(facts(), false));
    expect(printed).not.toMatch(/INTERNAL/);
    expect(printed).not.toContain('Not tested');
    expect(printed).not.toContain('Knee - Others');
  });

  it('prints the physiotherapy diagnosis only when the clinic turns it on and there is one', () => {
    expect(headings(facts(), true)).toContain('Physiotherapy diagnosis');
    const none = facts({ diagnosis: { ...facts().diagnosis, categoryName: null } });
    expect(headings(none, true)).not.toContain('Physiotherapy diagnosis');
  });

  it('prints investigations, referral and addenda only when there are some', () => {
    const filled = facts({
      plan: {
        ...facts().plan,
        investigations: 'MRI of the right knee if no better in 4 weeks',
        referral: 'Orthopaedic opinion on the meniscus',
      },
      addenda: [
        {
          text: 'Pain eased after the first week.',
          authorName: 'Test Consultant',
          createdAt: new Date('2026-10-31T10:35:00Z'),
        },
      ],
    });
    expect(headings(filled).slice(-4)).toEqual([
      'Investigations plan',
      'Referral plan',
      'Review plan',
      'Addenda',
    ]);
    const printed = JSON.stringify(summarySections(filled, false));
    expect(printed).toContain('31 Oct 2026, 4:05 PM');
    expect(printed).toContain('Pain eased after the first week.');
  });
});

describe('ConsultationSummary', () => {
  it('renders an A4 PDF on the letterhead with Plex embedded', async () => {
    const bytes = await renderPdf(
      <ConsultationSummary
        facts={facts()}
        printsCategory={false}
        version={1}
        generatedAt={new Date()}
      />,
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans\b/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexMono/);
  }, 20_000);
});

describe('generateConsultationSummary', () => {
  const cid = facts().consultationId;
  const signKey = ['consultation_summary:sign', cid].join(':');
  const generate = vi.fn(() => Promise.resolve({ id: 'doc', version: 2 }));

  it('makes the next version of a signed consultation’s summary, keyed by the job', async () => {
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.consultationSummaryFacts.mockResolvedValue(facts());
    const made = await generateConsultationSummary({} as never, cid, signKey, generate);
    expect(made).toEqual({ id: 'doc', version: 2 });
    expect(db.withActor).toHaveBeenCalledWith({}, 'system:documents', expect.any(Function));
    expect(generate).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({
        kind: 'consultation_summary',
        sourceId: cid,
        patientId: facts().patientId,
        centreId: facts().centreId,
        generationKey: signKey,
      }),
    );
  });

  it('makes nothing when its job already made a version, or the consultation is not signed', async () => {
    db.documentByGenerationKey.mockResolvedValue({ id: 'doc', version: 1 });
    expect(await generateConsultationSummary({} as never, cid, 'key', generate)).toBe(
      'already made',
    );
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.consultationSummaryFacts.mockResolvedValue(undefined);
    expect(await generateConsultationSummary({} as never, cid, 'key', generate)).toBe('not signed');
    expect(generate).not.toHaveBeenCalled();
  });
});
