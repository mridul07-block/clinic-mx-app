import type { DischargeReportFacts } from '@clinic-mx/db';
import type { KnowledgeMeasure } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessView } from '../reviews/readiness';
import type { FinalTesting } from '../reviews/services';
import { renderPdf } from './render';

const db = vi.hoisted(() => ({
  dischargeReportFacts: vi.fn(),
  documentByGenerationKey: vi.fn(),
  systemActor: (component: string) => `system:${component}`,
  withActor: vi.fn((_db: unknown, _actor: unknown, work: (tx: unknown) => unknown) =>
    work({ kind: 'transaction' }),
  ),
}));
vi.mock('@clinic-mx/db', () => db);
const reviews = vi.hoisted(() => ({ finalTestingOf: vi.fn(), readinessView: vi.fn() }));
vi.mock('../reviews/services', () => ({ finalTestingOf: reviews.finalTestingOf }));
vi.mock('../reviews/readiness', () => ({ readinessView: reviews.readinessView }));

const { DischargeReport, generateDischargeReport, reportSections } =
  await import('./discharge-report');

// OUT-11 (user decisions 27 October 2026): the report of a discharged episode with a signed
// consultation: summary, attendance, baseline against final as a table, the goals as marked,
// every criterion with its override reason, the clearances, ongoing needs and recommendations.
const episodeId = '00000000-0000-4000-8000-000000000003';
const facts = (overrides: Partial<DischargeReportFacts['episode']> = {}): DischargeReportFacts => ({
  episodeId,
  patientId: '00000000-0000-4000-8000-000000000002',
  centreId: '00000000-0000-4000-8000-000000000004',
  centre: { name: 'HSR Layout', address: '27th Main, HSR Layout', phone: '+918041234567' },
  patient: {
    name: 'Test Patient 0000',
    opNumber: 'HSR-00001',
    dateOfBirth: '1990-03-15',
    sex: 'male',
  },
  episode: {
    region: 'knee',
    openedAt: new Date('2026-09-01T05:00:00Z'),
    closedAt: new Date('2026-10-27T06:00:00Z'),
    reason: 'goals_achieved',
    note: null,
    goals: [
      { text: 'Climb stairs without pain', outcome: 'achieved' },
      { text: 'Run 5 km', outcome: 'partly_achieved' },
    ],
    ongoingNeeds: 'Keep the home programme twice a week.',
    recommendations: null,
    ...overrides,
  },
  diagnosis: {
    conditionName: 'Patellofemoral pain',
    movement: 'Quad dominance on step down',
    irritability: 'moderate',
    stage: 'subacute',
    provisional: false,
    categoryName: null,
  },
  consultant: 'Test Consultant',
  attendance: {
    attended: 9,
    firstAttended: new Date('2026-09-01T05:00:00Z'),
    lastAttended: new Date('2026-10-26T05:00:00Z'),
    noShows: 1,
    cancelled: 2,
  },
  dischargedBy: { name: 'Test Consultant', credentials: 'BPT, MPT (Ortho)' },
});
const quadriceps = { key: 'knee.lsi.quadriceps', name: 'Quadriceps' } as KnowledgeMeasure; // gitleaks:allow
const pain = { key: 'knee.marker.pain', name: 'Pain on stairs' } as KnowledgeMeasure; // gitleaks:allow
const item = (measure: KnowledgeMeasure, baseline: string, session: string | null) => ({
  measure,
  baselineEntry: {},
  baseline,
  baselineNotTested: null,
  session,
  sessionNotTested: null,
});
const testing = (signed: boolean): FinalTesting => {
  const strength = item(quadriceps, 'LSI 80%', 'LSI 88%');
  const stairs = item(pain, '6/10', null);
  const items = [strength, stairs];
  return {
    sessionNumber: 4,
    items,
    finalTest: signed
      ? {
          rows: [
            { ...strength, now: 'LSI 96%', nowNotTested: null, change: '+16 points' },
            { ...stairs, now: null, nowNotTested: 'Patient declined', change: '' },
          ],
          by: 'Test Consultant',
          at: new Date('2026-10-26T06:00:00Z'),
        }
      : null,
  };
};
const readiness = {
  rows: [
    {
      criterion: { key: 'a', text: 'Quadriceps', section: 'Strength' },
      result: 'met',
      reading: 'LSI 96% · Pass',
      override: null,
    },
    {
      criterion: { key: 'b', text: 'Psychological readiness', section: 'Summary' },
      result: 'not_met',
      reading: null,
      override: { reason: 'ACL-RSI due next week.', by: 'Test Consultant', at: new Date() },
    },
  ],
  clearances: [
    {
      status: 'rehabilitation_complete',
      label: 'Rehabilitation complete',
      signed: { by: 'Test Consultant', at: new Date('2026-10-26T06:30:00Z') },
      refusal: undefined,
    },
    { status: 'return_to_sport', label: 'Return to sport', signed: null, refusal: 'x' },
  ],
} as unknown as ReadinessView;

const printedOf = (sections: ReturnType<typeof reportSections>) =>
  sections.map((s) => [s.heading, JSON.stringify(s.blocks)].join(': ')).join('\n');

describe('the discharge report', () => {
  it('prints the summary, attendance, baseline against final, goals, criteria and what comes next', () => {
    const sections = reportSections(facts(), testing(true), readiness);
    expect(sections.map((s) => s.heading)).toEqual([
      'Patient details',
      'Episode summary',
      'Attendance',
      'Baseline and final results',
      'Goals',
      'Readiness criteria',
      'Clearance',
      'Ongoing needs',
      'Recommendations',
    ]);
    const printed = printedOf(sections);
    expect(printed).toContain('["Reason for discharge","Goals achieved"]');
    expect(printed).toContain('["Visits attended","9"]');
    expect(printed).toContain('["Missed","1"]');
    expect(printed).toContain('{"label":"Session 4"}');
    expect(printed).toContain('["Quadriceps","LSI 80%","LSI 88%","LSI 96%","+16 points"]');
    expect(printed).toContain('["Pain on stairs","6/10","—","Not tested: Patient declined",""]');
    expect(printed).toContain('["Run 5 km","Partly achieved"]');
    expect(printed).toContain('["Quadriceps (LSI 96% · Pass)","Met",""]');
    expect(printed).toContain('["Psychological readiness","Overridden","ACL-RSI due next week."]');
    expect(printed).toContain('["Return to sport","Not signed"]');
    expect(printed).toContain('Keep the home programme twice a week.');
    expect(printed).toContain('Recommendations: [{"kind":"lines","lines":["None recorded."]}]');
  });

  it('says so when final testing was not signed, there was no baseline, or no criteria', () => {
    const unsigned = printedOf(
      reportSections(facts({ note: 'Moved city' }), testing(false), undefined),
    );
    expect(unsigned).toContain('["Quadriceps","LSI 80%","LSI 88%","Not retested",""]');
    expect(unsigned).toContain('Final testing was not signed before discharge.');
    expect(unsigned).toContain('Goals achieved: Moved city');
    expect(unsigned).not.toContain('Readiness criteria');
    const none = printedOf(
      reportSections(
        facts({ goals: [] }),
        { sessionNumber: null, items: [], finalTest: null },
        undefined,
      ),
    );
    expect(none).toContain('No baseline was recorded at session 1.');
    expect(none).not.toContain('Final testing was not signed');
    expect(none).not.toContain('Goals:');
  });

  it('renders an A4 PDF on the letterhead with Plex embedded', async () => {
    const bytes = await renderPdf(
      <DischargeReport
        facts={facts()}
        testing={testing(true)}
        readiness={readiness}
        version={1}
        generatedAt={new Date()}
      />,
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans\b/);
  }, 20_000);
});

describe('generateDischargeReport', () => {
  const generate = vi.fn(() => Promise.resolve({ id: 'doc', version: 1 }));
  const key = 'discharge_report:' + episodeId;
  beforeEach(() => {
    generate.mockClear();
    db.documentByGenerationKey.mockResolvedValue(undefined);
    db.dischargeReportFacts.mockResolvedValue(facts());
    reviews.finalTestingOf.mockResolvedValue(testing(true));
    reviews.readinessView.mockResolvedValue(readiness);
  });

  it('makes the report of a discharged episode, keyed by the job', async () => {
    expect(await generateDischargeReport({} as never, episodeId, key, generate)).toEqual({
      id: 'doc',
      version: 1,
    });
    expect(generate).toHaveBeenCalledWith(
      { kind: 'transaction' },
      expect.objectContaining({
        kind: 'discharge_report',
        sourceId: episodeId,
        generationKey: key,
      }),
    );
  });

  it('makes nothing twice, nor for an episode not discharged', async () => {
    db.documentByGenerationKey.mockResolvedValueOnce({ id: 'doc' });
    expect(await generateDischargeReport({} as never, episodeId, key, generate)).toBe(
      'already made',
    );
    db.dischargeReportFacts.mockResolvedValueOnce(undefined);
    expect(await generateDischargeReport({} as never, episodeId, key, generate)).toBe(
      'not discharged',
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
