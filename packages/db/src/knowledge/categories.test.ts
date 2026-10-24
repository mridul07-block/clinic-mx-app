import { describe, expect, it } from 'vitest';
import type { BuiltKnowledge } from './build';
import { buildCategories } from './categories';
import { readCategoriesFile, readConditionIds } from './paths';

// CLN-06: the client's diagnosis categories are knowledge data, read from the committed file and
// checked against the build; the mapping to conditions arrives with SET-12.
const builtWith = (conditionIds: string[]) =>
  ({ conditions: conditionIds.map((conditionId) => ({ conditionId })) }) as BuiltKnowledge;

const file = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    source: 'The client’s list',
    categories: [
      { code: 'knee_pfps', name: 'Knee - PFPS' },
      { code: 'chronic_pain', name: 'Chronic pain' },
    ],
    conditions: { 'KNE-001': 'knee_pfps' },
    ...extra,
  });

describe('diagnosis categories', () => {
  it('reads the committed file: the client’s 44 categories, none mapped yet', async () => {
    const ids = Object.values(await readConditionIds());
    const built = buildCategories(await readCategoriesFile(), builtWith(ids));
    expect(built.categories).toHaveLength(44);
    expect(built.categories[0]).toEqual({ code: 'chronic_pain', name: 'Chronic pain', sort: 0 });
    expect(built.categories.map((c) => c.name)).toContain('Foot & Ankle - Ligaments injuries');
    expect(built.mapping).toEqual({});
    expect(built.file.name).toBe('diagnosis-categories.json');
    expect(built.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the order and the mapping', () => {
    const built = buildCategories(file(), builtWith(['KNE-001']));
    expect(built.categories.map((c) => [c.code, c.sort])).toEqual([
      ['knee_pfps', 0],
      ['chronic_pain', 1],
    ]);
    expect(built.mapping).toEqual({ 'KNE-001': 'knee_pfps' });
  });

  it('stops the import on a bad file', () => {
    expect(() => buildCategories('{', builtWith([]))).toThrow('not valid JSON');
    expect(() => buildCategories(file(), builtWith(['KNE-002']))).toThrow(
      'KNE-001 is not a condition in the workbooks',
    );
    expect(() =>
      buildCategories(file({ conditions: { 'KNE-001': 'knee_other' } }), builtWith(['KNE-001'])),
    ).toThrow('maps to unknown category "knee_other"');
    expect(() =>
      buildCategories(
        file({
          categories: [
            { code: 'knee_pfps', name: 'Knee - PFPS' },
            { code: 'knee_pfps', name: 'Knee - PFPS again' },
          ],
        }),
        builtWith(['KNE-001']),
      ),
    ).toThrow('code "knee_pfps" appears twice');
  });
});
