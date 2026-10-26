import { describe, expect, it } from 'vitest';
import { confirmedCount, consultationSectionsSchema, signingBlockers } from './consultations';
import {
  defaultReviewDate,
  reviewSearchDates,
  modalitiesNeedingReason,
  modalityWarnings,
  planCatalogFileSchema,
  planQuestionnaires,
  precautionsInForce,
  resolvedPlan,
  suggestedQuestionnaires,
  type PlanCatalog,
  type PlanModality,
} from './plan';

// The committed catalog's shape, trimmed: shockwave warns about bleeding and pregnancy.
const catalog: PlanCatalog = {
  modalities: [
    {
      key: 'radial_shockwave',
      name: 'Radial Shockwave (RSW)',
      precautions: [
        { precaution: 'bleeding', source: 'Blueprint Part B' },
        { precaution: 'pregnancy', source: 'SOP v2 §12.3' },
      ],
      signedOff: false,
    },
    { key: 'laser', name: 'Laser', precautions: [], signedOff: false },
  ],
  questionnaires: [
    {
      key: 'koos',
      name: 'KOOS',
      regions: ['knee'],
      useFor: 'ACL, meniscus, cartilage injury, early OA',
    },
    { key: 'visa_p', name: 'VISA-P', regions: ['knee'], useFor: 'Patellar tendinopathy' },
    {
      key: 'kujala',
      name: 'Kujala',
      regions: ['knee'],
      useFor: 'Patellofemoral pain, patellar instability',
    },
    {
      key: 'spadi',
      name: 'SPADI',
      regions: ['shoulder'],
      useFor: 'General shoulder pain, frozen shoulder, rotator cuff',
    },
    {
      key: 'psfs',
      name: 'PSFS',
      regions: [],
      useFor: 'When no condition-specific measure fits, or alongside one',
    },
  ],
};

const patient = { sex: 'female', health_conditions: ['pregnancy', 'bleeding'] };

// CLN-07: modalities checked against precautions, questionnaires from the diagnosis, defaults.
describe('plan of care', () => {
  it('takes the clinician’s Screening confirmation over the patient’s tick', () => {
    expect(precautionsInForce({}, patient).map((p) => [p.key, p.by])).toEqual([
      ['pregnancy', 'patient'],
      ['bleeding', 'patient'],
    ]);
    const confirmed = { 'precaution.pregnancy': false, 'precaution.cancer': true };
    expect(precautionsInForce(confirmed, patient).map((p) => [p.key, p.by])).toEqual([
      ['cancer', 'clinician'],
      ['bleeding', 'patient'],
    ]);
    // Pregnancy is asked only of a female patient.
    expect(precautionsInForce({}, { ...patient, sex: 'male' }).map((p) => p.key)).toEqual([
      'bleeding',
    ]);
    expect(precautionsInForce({}, {})).toEqual([]);
  });

  it('warns about the patient’s precautions a modality lists, and asks a reason to keep it', () => {
    const [shockwave, laser] = catalog.modalities as [PlanModality, PlanModality];
    const inForce = precautionsInForce({}, patient);
    expect(modalityWarnings(shockwave, inForce)).toEqual([
      expect.objectContaining({ key: 'bleeding', source: 'Blueprint Part B' }),
      expect.objectContaining({ key: 'pregnancy', source: 'SOP v2 §12.3' }),
    ]);
    expect(modalityWarnings(laser, inForce)).toEqual([]);
    const plan = consultationSectionsSchema.parse({
      plan: { modalities: [{ key: 'radial_shockwave' }, { key: 'laser' }] },
    }).plan;
    expect(modalitiesNeedingReason(plan, catalog, inForce)).toEqual(['Radial Shockwave (RSW)']);
    const kept = { ...plan, modalities: [{ key: 'radial_shockwave', reason: '  Low dose  ' }] };
    expect(modalitiesNeedingReason(kept, catalog, inForce)).toEqual([]);
    expect(modalitiesNeedingReason(plan, catalog, [])).toEqual([]);
  });

  it('blocks signing until each warned modality has a reason', () => {
    const sections = consultationSectionsSchema.parse({
      plan: { modalities: [{ key: 'radial_shockwave' }] },
    });
    const planReasons = (s: typeof sections) =>
      signingBlockers(s, patient, { planCatalog: catalog }).filter((b) => b.section === 'plan');
    expect(planReasons(sections)).toEqual([
      {
        section: 'plan',
        reason:
          'Give a reason for each modality kept despite a precaution: Radial Shockwave (RSW).',
      },
    ]);
    const given = {
      ...sections,
      plan: { ...sections.plan, modalities: [{ key: 'radial_shockwave', reason: 'Low dose' }] },
    };
    expect(planReasons(given)).toEqual([]);
  });

  it('offers the region’s questionnaires and suggests those the condition names', () => {
    const knee = planQuestionnaires(catalog, 'knee');
    expect(knee.map((q) => q.key)).toEqual(['koos', 'visa_p', 'kujala', 'psfs']);
    expect(planQuestionnaires(catalog, '').map((q) => q.key)).toEqual(['psfs']);
    const named = (name: string, synonyms: string[] = []) =>
      suggestedQuestionnaires(knee, { name, synonyms });
    expect(named('Patellar Tendinopathy')).toEqual(['visa_p']);
    expect(named('Meniscal Root Tear')).toEqual(['koos']);
    expect(named('Patellar Instability')).toEqual(['kujala']);
    expect(named('Patellofemoral Pain Syndrome')).toEqual(['kujala']);
    expect(named('Anterior Cruciate Ligament Tear', ['ACL'])).toEqual(['koos']);
    // PSFS is offered but never suggested; no condition, nothing suggested.
    expect(named('Bursitis')).toEqual([]);
    expect(suggestedQuestionnaires(knee, undefined)).toEqual([]);
  });

  it('fills in the defaults: review date, suggested questionnaires, the consultant', () => {
    expect(defaultReviewDate('2026-10-24', 6)).toBe('2026-12-05');
    // OUT-06: the automatic review tries the review date and the days after it, never the past.
    expect(reviewSearchDates('2026-12-05', '2026-10-26', 3)).toEqual([
      '2026-12-05',
      '2026-12-06',
      '2026-12-07',
    ]);
    expect(reviewSearchDates('2026-10-20', '2026-10-26', 2)).toEqual(['2026-10-26', '2026-10-27']);
    const plan = consultationSectionsSchema.parse({}).plan;
    const defaults = { visitDate: '2026-10-24', reviewWeeks: 6, consultantId: 'me' };
    expect(resolvedPlan(plan, defaults, ['visa_p'])).toMatchObject({
      reviewDate: '2026-12-05',
      questionnaires: ['visa_p'],
      treatingPhysioId: 'me',
    });
    const chosen = {
      ...plan,
      reviewDate: '2026-12-01',
      questionnaires: [],
      treatingPhysioId: 'p2',
    };
    expect(resolvedPlan(chosen, defaults, ['visa_p'])).toMatchObject({
      reviewDate: '2026-12-01',
      questionnaires: [],
      treatingPhysioId: 'p2',
    });
  });

  it('counts the parts, reads older drafts and keeps to its limits', () => {
    const empty = consultationSectionsSchema.parse({ plan: { notes: 'Seen' } });
    expect(empty.plan).toMatchObject({ notes: 'Seen', goals: [], questionnaires: null });
    expect(confirmedCount(empty, 'plan')).toBe(0);
    const filled = consultationSectionsSchema.parse({
      plan: {
        goals: [{ text: 'Run 10 km again', patient: true }],
        interventions: ['exercise'],
        sessionsPerWeek: 2,
        weeks: 6,
        homeProgramme: [{ exercise: 'Spanish squat', dose: '3 x 45 s daily' }],
      },
    });
    expect(confirmedCount(filled, 'plan')).toBe(4);
    const bad = (plan: Record<string, unknown>) =>
      consultationSectionsSchema.safeParse({ plan }).success;
    expect(bad({ sessionsPerWeek: 8 })).toBe(false);
    expect(bad({ weeks: 0 })).toBe(false);
    expect(bad({ interventions: ['exercise', 'exercise'] })).toBe(false);
    expect(bad({ modalities: [{ key: 'laser' }, { key: 'laser' }] })).toBe(false);
    expect(bad({ reviewDate: '24/10/2026' })).toBe(false);
    expect(bad({ treatingPhysioId: 'someone' })).toBe(false);
    expect(bad({ goals: Array.from({ length: 21 }, () => ({ text: 'x' })) })).toBe(false);
    // ALT-06: investigations and referral advice, up to 500 characters; none in older drafts.
    expect(empty.plan).toMatchObject({ investigations: '', referral: '' });
    expect(bad({ investigations: 'x'.repeat(500), referral: 'x'.repeat(500) })).toBe(true);
    expect(bad({ investigations: 'x'.repeat(501) })).toBe(false);
    expect(bad({ referral: 'x'.repeat(501) })).toBe(false);
  });

  it('takes only a catalog whose precautions are the health check’s', () => {
    const file = {
      source: 'Client documents',
      modalities: [
        {
          key: 'pemf',
          name: 'PEMF',
          precautions: [{ precaution: 'implant', source: 'Part B' }],
          signedOff: false,
        },
      ],
      questionnaires: [{ key: 'psfs', name: 'PSFS', regions: [], useFor: 'Any' }],
    };
    expect(planCatalogFileSchema.safeParse(file).success).toBe(true);
    const unknown = {
      ...file,
      modalities: [
        { ...file.modalities[0], precautions: [{ precaution: 'pacemaker', source: 'x' }] },
      ],
    };
    expect(planCatalogFileSchema.safeParse(unknown).success).toBe(false);
    expect(
      planCatalogFileSchema.safeParse({
        ...file,
        questionnaires: [{ key: 'psfs', name: 'PSFS', regions: ['thoracic'], useFor: 'Any' }],
      }).success,
    ).toBe(false);
  });
});
