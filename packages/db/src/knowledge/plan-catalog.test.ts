import { describe, expect, it } from 'vitest';
import { readPlanCatalogFile } from './paths';
import { buildPlanCatalog } from './plan-catalog';

// CLN-07: the modalities, their precaution links and the questionnaires are knowledge data, read
// from the committed file; the links await clinical sign-off.
describe('plan catalog', () => {
  it('reads the committed file: 8 modalities and Blueprint Module 8’s 19 questionnaires', async () => {
    const built = buildPlanCatalog(await readPlanCatalogFile());
    expect(built.modalities.map((m) => m.key)).toEqual([
      'electrotherapy',
      'radial_shockwave',
      'focused_shockwave',
      'pemf',
      'spinal_traction',
      'laser',
      'dry_needling',
      'zero_gravity_treadmill',
    ]);
    expect(built.modalities.every((m) => !m.signedOff)).toBe(true);
    const warns = (key: string) =>
      built.modalities.find((m) => m.key === key)?.precautions.map((p) => p.precaution);
    expect(warns('pemf')).toEqual(['implant', 'pregnancy']);
    expect(warns('radial_shockwave')).toEqual([
      'bleeding',
      'pregnancy',
      'cancer',
      'chronic_infection',
    ]);
    expect(warns('spinal_traction')).toEqual(['osteoporosis']);
    expect(warns('laser')).toEqual([]);
    expect(built.questionnaires).toHaveLength(19);
    expect(built.questionnaires.find((q) => q.key === 'quickdash')?.regions).toEqual([
      'elbow',
      'forearm_wrist',
    ]);
    expect(built.questionnaires.at(-1)).toMatchObject({ key: 'psfs', regions: [], sort: 18 });
    expect(built.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stops the import on a bad file', () => {
    const file = (modalities: unknown[]) =>
      JSON.stringify({
        source: 'x',
        modalities,
        questionnaires: [{ key: 'psfs', name: 'PSFS', regions: [], useFor: 'Any' }],
      });
    const pemf = { key: 'pemf', name: 'PEMF', precautions: [], signedOff: false };
    expect(() => buildPlanCatalog('{')).toThrow('not valid JSON');
    expect(() => buildPlanCatalog(file([pemf, pemf]))).toThrow('modality "pemf" appears twice');
    expect(() =>
      buildPlanCatalog(
        file([
          {
            ...pemf,
            precautions: [
              { precaution: 'implant', source: 'a' },
              { precaution: 'implant', source: 'b' },
            ],
          },
        ]),
      ),
    ).toThrow('pemf lists a precaution twice');
    expect(() =>
      buildPlanCatalog(
        file([{ ...pemf, precautions: [{ precaution: 'pacemaker', source: 'a' }] }]),
      ),
    ).toThrow('Unknown precaution');
    const area = { key: 'area', label: 'Area treated', kind: 'text', source: 'a' };
    expect(() => buildPlanCatalog(file([{ ...pemf, parameters: [area, area] }]))).toThrow(
      'pemf lists a parameter twice',
    );
    expect(() =>
      buildPlanCatalog(file([{ ...pemf, parameters: [{ ...area, kind: 'date' }] }])),
    ).toThrow();
  });

  // SES-05 (user decisions 26 October 2026): each modality's session note parameters, common
  // fields until the clinic lists its own (DECISION SES-05), shockwave's from the SOP.
  it('gives every modality its session parameters, shockwave the SOP’s two more', async () => {
    const built = buildPlanCatalog(await readPlanCatalogFile());
    const fields = (key: string) =>
      built.modalities.find((m) => m.key === key)?.parameters.map((p) => p.key);
    for (const modality of built.modalities) {
      expect(modality.parameters.map((p) => p.key)).toEqual(
        expect.arrayContaining(['area', 'duration', 'settings']),
      );
      expect(modality.parameters.every((p) => p.source.length > 0)).toBe(true);
    }
    expect(fields('radial_shockwave')).toEqual([
      'area',
      'duration',
      'energy_flux_density',
      'frequency',
      'settings',
    ]);
    expect(fields('laser')).toEqual(['area', 'duration', 'settings']);
    const duration = built.modalities[0]?.parameters.find((p) => p.key === 'duration');
    expect(duration).toMatchObject({ kind: 'number', unit: 'min' });
  });
});
