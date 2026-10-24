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
  });
});
