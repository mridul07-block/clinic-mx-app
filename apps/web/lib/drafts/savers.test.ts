import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftSavers } from './savers';

const sections = {
  subjective: { notes: 'Pain on stairs', confirmed: {} },
  screening: { notes: '', confirmed: {} },
  objective: { notes: '', region: '' as const, side: '' as const, measures: {}, tests: [] },
  assessment: {
    notes: '',
    conditionId: '',
    movement: '',
    irritability: '' as const,
    stage: '' as const,
    categoryCode: '',
    provisional: true,
  },
  plan: {
    notes: '',
    goals: [],
    interventions: [],
    modalities: [],
    sessionsPerWeek: null,
    weeks: null,
    homeProgramme: [],
    reviewDate: '',
    questionnaires: null,
    treatingPhysioId: '',
    investigations: '',
    referral: '',
  },
};

// CLN-02: a consultation draft whose screen is closed is saved to the consultation's endpoint.
describe('draft savers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves a consultation draft to its own endpoint', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(Response.json({ status: 'saved', version: 4 }, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetch);
    const saver = draftSavers.consultation;
    expect(saver).toBeDefined();
    await expect(saver?.('abc')(sections, 3)).resolves.toEqual({ status: 'saved', version: 4 });
    expect(fetch).toHaveBeenCalledWith(
      '/app/consultations/abc/save',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ value: sections, baseVersion: 3 }),
      }),
    );
  });
});
