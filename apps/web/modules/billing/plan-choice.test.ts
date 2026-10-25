import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { PlanChoiceError, recordPatientPlanChoice } from './plan-choice';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodeRecord: vi.fn(),
  planForPricing: vi.fn(),
  recordPlanChoice: vi.fn(),
  priceItemList: vi.fn(),
  packageTypeList: vi.fn(),
  thinkAboutItFollowUp: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
vi.mock('../settings/settings', () => ({
  getSetting: () => Promise.resolve(['rehabilitation_session', 'advanced_rehabilitation_session']),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const episodeId = '00000000-0000-4000-8000-000000000501';
const planOfCareId = '00000000-0000-4000-8000-000000000801';
const rehab = '00000000-0000-4000-8000-000000000901';
const advanced = '00000000-0000-4000-8000-000000000902';
const tenSessions = '00000000-0000-4000-8000-000000000a01';
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

// BIL-02: the desk records the patient's choice against the newest plan while it is proposed; a
// package is one of those offered for the session type.
describe('recording the patient choice', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, centreId: hsr, status: 'plan_proposed' });
    db.planForPricing.mockResolvedValue({ planOfCareId });
    db.priceItemList.mockResolvedValue([
      {
        id: rehab,
        key: 'rehabilitation_session',
        label: 'Rehab',
        amountPaise: 100000,
        active: true,
      },
      {
        id: advanced,
        key: 'advanced_rehabilitation_session',
        label: 'Advanced',
        amountPaise: 150000,
        active: true,
      },
    ]);
    db.packageTypeList.mockResolvedValue([
      {
        id: tenSessions,
        name: 'Ten sessions',
        sessions: 10,
        pricePaise: 900000,
        active: true,
        items: [{ id: rehab }],
      },
    ]);
    db.recordPlanChoice.mockResolvedValue({ id: 'choice', followUpAt: null });
  });

  it('records a package offered for the session type against the newest plan, as the desk', async () => {
    await recordPatientPlanChoice(context(), {
      episodeId,
      choice: {
        choice: 'package',
        sessionKey: 'rehabilitation_session',
        packageTypeId: tenSessions,
      },
    });
    expect(db.recordPlanChoice).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      planOfCareId,
      choice: 'package',
      packageTypeId: tenSessions,
      sessionPriceItemId: rehab,
      recordedBy: desk().id,
    });
  });

  it('refuses a package that does not cover the session type, and a session type not offered', async () => {
    await expect(
      recordPatientPlanChoice(context(), {
        episodeId,
        choice: {
          choice: 'package',
          sessionKey: 'advanced_rehabilitation_session',
          packageTypeId: tenSessions,
        },
      }),
    ).rejects.toThrow('That package is not offered for this session type.');
    await expect(
      recordPatientPlanChoice(context(), {
        episodeId,
        choice: { choice: 'per_session', sessionKey: 'pemf' },
      }),
    ).rejects.toThrow('That session type is not offered.');
    expect(db.recordPlanChoice).not.toHaveBeenCalled();
  });

  it('refuses once the episode is no longer Plan proposed, and before there is a plan', async () => {
    db.episodeRecord.mockResolvedValue({ id: episodeId, centreId: hsr, status: 'active' });
    await expect(
      recordPatientPlanChoice(context(), { episodeId, choice: { choice: 'no_thanks' } }),
    ).rejects.toThrow('A choice is recorded while the plan is proposed; this episode is Active.');
    db.episodeRecord.mockResolvedValue({ id: episodeId, centreId: hsr, status: 'plan_proposed' });
    db.planForPricing.mockResolvedValue(undefined);
    await expect(
      recordPatientPlanChoice(context(), { episodeId, choice: { choice: 'no_thanks' } }),
    ).rejects.toThrow(PlanChoiceError);
    expect(db.recordPlanChoice).not.toHaveBeenCalled();
  });

  it('refuses the desk at another centre and a physio', async () => {
    const choice = { episodeId, choice: { choice: 'think_about_it' } };
    await expect(
      recordPatientPlanChoice(context(desk({ centreIds: [koramangala] })), choice),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      recordPatientPlanChoice(
        context(desk({ role: 'physiotherapist', treatsPatients: true })),
        choice,
      ),
    ).rejects.toThrow(NotAllowedError);
    expect(db.recordPlanChoice).not.toHaveBeenCalled();
  });
});
