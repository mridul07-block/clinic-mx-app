import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { ownOutcomes, readsOwnOutcomes } from './own-outcomes';

const manager = vi.hoisted(() => ({ outcomesFor: vi.fn() }));
vi.mock('./manager', () => manager);

const staff = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000301',
  email: 'physio@clinicmx.test',
  name: 'Test Physio',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: false,
  centreIds: ['00000000-0000-4000-8000-000000000101'],
  support: false,
  ...extra,
});
const now = new Date('2026-10-28T06:00:00Z');

// DSH-06: the Centre Manager's outcome figures over the reader's own episodes, for those who treat
// patients; adherence waits for My plan.
describe('own outcomes', () => {
  beforeEach(() => {
    manager.outcomesFor.mockReset();
    manager.outcomesFor.mockResolvedValue({
      window: '90',
      bullets: [],
      funnel: [
        { stage: 'consultation_held', label: 'Consultation held', episodes: 3 },
        { stage: 'plan_proposed', label: 'Plan proposed', episodes: 3 },
        { stage: 'active', label: 'Active', episodes: 2 },
      ],
      inTreatment: 1,
      topDiagnoses: [],
      outcomes: [],
      tooFew: [],
      minimumEpisodes: 3,
    });
  });

  it('reads the reader’s own figures, the whole funnel, with adherence still to come', async () => {
    const view = await ownOutcomes(staff(), '90', now);
    expect(manager.outcomesFor).toHaveBeenCalledWith(staff(), '90', now, 'own');
    expect(view.funnel.map((stage) => stage.stage)).toEqual([
      'consultation_held',
      'plan_proposed',
      'active',
    ]);
    expect(view.coming.map((item) => item.needs).join(' ')).toContain('PAT-02');
    // The Super Admin who treats patients reads their own too.
    await ownOutcomes(staff({ role: 'super_admin', centreIds: [] }), '30', now);
    expect(manager.outcomesFor).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: 'super_admin' }),
      '30',
      now,
      'own',
    );
  });

  it('refuses the desk, Finance, a Centre Manager, anyone without the tick and support', async () => {
    const refused = [
      staff({ role: 'front_desk', treatsPatients: false }),
      staff({ role: 'finance', treatsPatients: false, centreIds: [] }),
      staff({ role: 'centre_manager', treatsPatients: false }),
      staff({ role: 'centre_manager', treatsPatients: true }),
      staff({ treatsPatients: false }),
      staff({ role: 'super_admin', treatsPatients: false, support: true, centreIds: [] }),
    ];
    for (const actor of refused) {
      expect(readsOwnOutcomes(actor)).toBe(false);
      await expect(ownOutcomes(actor, '90', now)).rejects.toThrow(NotAllowedError);
    }
    expect(manager.outcomesFor).not.toHaveBeenCalled();
  });
});
