import { describe, expect, it } from 'vitest';
import { packageCover, planOptions, planSheetQuerySchema, type PriceItemPrice } from './plan-sheet';

// BIL-01: per session and package options for the recommended plan, from the price master.
const session: PriceItemPrice = {
  id: 'item-session',
  key: 'rehabilitation_session',
  label: 'Rehabilitation session',
  amountPaise: 1_000_00,
};
const prices: PriceItemPrice[] = [
  session,
  { id: 'item-shockwave', key: 'radial_shockwave', label: 'Radial shockwave', amountPaise: 750_00 },
];
const plan = {
  sessionsPerWeek: 2,
  weeks: 6,
  modalities: [
    { key: 'radial_shockwave', name: 'Radial Shockwave' },
    { key: 'laser', name: 'Low Level Laser' },
  ],
};

describe('planOptions', () => {
  it('prices the planned sessions per session, modalities per use beside it', () => {
    const options = planOptions(plan, session, prices, [], 3);
    expect(options.plannedSessions).toBe(12);
    expect(options.perSession.totalPaise).toBe(12_000_00);
    expect(options.modalities).toEqual([
      { name: 'Radial Shockwave', perUsePaise: 750_00 },
      { name: 'Low Level Laser', perUsePaise: null },
    ]);
    expect(options.packages).toEqual([]);
  });

  it('gives the unit price only when the plan does not say how often', () => {
    const options = planOptions({ ...plan, weeks: null }, session, prices, [], 3);
    expect(options.plannedSessions).toBeNull();
    expect(options.perSession).toEqual({ item: session, totalPaise: null });
  });

  it('offers only the packages covering the session type, cheapest first', () => {
    const options = planOptions(
      plan,
      session,
      prices,
      [
        {
          id: 'p20',
          name: 'Twenty',
          sessions: 20,
          pricePaise: 17_000_00,
          itemIds: ['item-session'],
        },
        { id: 'p10', name: 'Ten', sessions: 10, pricePaise: 9_000_00, itemIds: ['item-session'] },
        { id: 'pz', name: 'Treadmill', sessions: 10, pricePaise: 15_000_00, itemIds: ['item-zgt'] },
        { id: 'p3', name: 'Three', sessions: 3, pricePaise: 2_000_00, itemIds: ['item-session'] },
      ],
      3,
    );
    expect(options.packages.map((p) => [p.name, p.perSessionPaise, p.cover])).toEqual([
      ['Three', 66_667, 'Covers 3 of 12 planned sessions'],
      ['Ten', 900_00, 'Covers 10 of 12 planned sessions'],
      ['Twenty', 850_00, 'Covers all 12 planned sessions'],
    ]);
    expect(options.packages[0]?.validity).toBe('Valid 3 months from payment');
  });
});

describe('packageCover', () => {
  it('compares the package with the planned sessions', () => {
    expect(packageCover(12, 12)).toBe('Covers all 12 planned sessions');
    expect(packageCover(1, 1)).toBe('Covers the planned session');
    expect(packageCover(10, 12)).toBe('Covers 10 of 12 planned sessions');
    expect(packageCover(10, null)).toBe('10 sessions');
  });
});

describe('planSheetQuerySchema', () => {
  it('reads a session key, and ignores anything else', () => {
    expect(planSheetQuerySchema.parse({ session: 'advanced_rehabilitation_session' })).toEqual({
      session: 'advanced_rehabilitation_session',
    });
    expect(planSheetQuerySchema.parse({ session: 'DROP TABLE' })).toEqual({ session: undefined });
    expect(planSheetQuerySchema.parse({})).toEqual({});
  });
});
