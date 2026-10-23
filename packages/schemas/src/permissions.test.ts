import { describe, expect, it } from 'vitest';
import {
  accessScope,
  actions,
  can,
  deniedToSupport,
  type Action,
  type StaffAccess,
} from './permissions';
import { staffRoles, type StaffRole } from './staff';

// IAM-04: the PRD section 2 access summary written out a second time, cell by cell, so a change
// to the map that the PRD does not make fails here. Columns: Super Admin, Centre Manager, Front
// Desk, Physiotherapist, Finance.
type Cell = '-' | 'yes' | 'own' | 'treats' | 'consultant' | 'consultant+treats';
type Expected = readonly [Cell, Cell, Cell, Cell, Cell];

const expected: Record<Action, Expected> = {
  'centres.manage': ['yes', '-', '-', '-', '-'],
  'staff.manage': ['yes', '-', '-', '-', '-'],
  'templates.manage': ['yes', '-', '-', '-', '-'],
  'settings.manage': ['yes', '-', '-', '-', '-'],
  'support_access.grant': ['yes', '-', '-', '-', '-'],
  'rosters.manage': ['yes', 'yes', '-', '-', '-'],
  'leave.manage': ['yes', 'yes', '-', 'own', '-'],
  'prices.view': ['yes', 'yes', 'yes', '-', 'yes'],
  'prices.manage': ['yes', '-', '-', '-', 'yes'],
  'calendar.view': ['yes', 'yes', 'yes', 'own', '-'],
  'bookings.manage': ['yes', 'yes', 'yes', '-', '-'],
  'bookings.book_next_session': ['yes', 'yes', 'yes', 'yes', '-'],
  // User decision 23 October 2026 (SCH-09), not a PRD row: managers lift the self booking block.
  'bookings.lift_self_booking_block': ['yes', 'yes', '-', '-', '-'],
  'check_in.manage': ['yes', 'yes', 'yes', '-', '-'],
  'check_in.view': ['yes', 'yes', 'yes', 'yes', '-'],
  'patients.view_contact': ['yes', 'yes', 'yes', 'yes', 'yes'],
  'patients.edit_contact': ['yes', 'yes', 'yes', '-', '-'],
  'clinical.read': ['yes', 'treats', '-', 'treats', '-'],
  'ai_prep.use': ['consultant', 'consultant', '-', 'consultant', '-'],
  'consultant_records.write': ['consultant', 'consultant', '-', 'consultant', '-'],
  'consultant_records.sign': [
    'consultant+treats',
    'consultant+treats',
    '-',
    'consultant+treats',
    '-',
  ],
  'session_notes.write': ['treats', 'treats', '-', 'treats', '-'],
  'red_flags.view': ['yes', 'yes', '-', 'yes', '-'],
  'red_flags.view_banner': ['yes', 'yes', 'yes', 'yes', '-'],
  // User decision 23 October 2026 (ALT-01), not a PRD row: only clinicians act on alerts.
  'red_flags.act': ['treats', 'treats', '-', 'treats', '-'],
  'bills.view_amounts': ['yes', '-', 'yes', '-', 'yes'],
  'bills.create_and_collect': ['yes', '-', 'yes', '-', 'yes'],
  'bills.view_payment_pending': ['yes', 'yes', 'yes', '-', 'yes'],
  'packages.view_sessions_left': ['yes', '-', 'yes', 'yes', 'yes'],
  'discounts.apply_preset': ['yes', '-', 'yes', '-', 'yes'],
  'discounts.apply_any': ['yes', '-', '-', '-', 'yes'],
  'refunds.manage': ['yes', '-', '-', '-', 'yes'],
  'dashboard.overview': ['yes', '-', '-', '-', '-'],
  'dashboard.clinical_operations': ['yes', 'yes', '-', '-', '-'],
  'dashboard.today': ['yes', '-', 'yes', '-', '-'],
  'dashboard.own_patients': ['yes', '-', '-', 'own', '-'],
  'dashboard.finance': ['yes', '-', '-', '-', 'yes'],
  'knowledge_base.view': ['yes', 'yes', '-', 'yes', '-'],
  'knowledge_base.edit': ['yes', '-', '-', '-', '-'],
  'notifications.read': ['yes', 'yes', 'yes', 'yes', 'yes'],
  'audit.view_all': ['yes', '-', '-', '-', '-'],
  'audit.view_clinical': ['yes', 'yes', '-', '-', '-'],
  'audit.view_finance': ['yes', '-', '-', '-', 'yes'],
  'data.export': ['yes', '-', '-', '-', '-'],
  'data_requests.manage': ['yes', '-', '-', '-', '-'],
};

const hsr = '00000000-0000-4000-8000-000000000101';
const whitefield = '00000000-0000-4000-8000-000000000103';
const me = '00000000-0000-4000-8000-000000000201';
const someoneElse = '00000000-0000-4000-8000-000000000202';

const person = (role: StaffRole, ticks: Partial<StaffAccess> = {}): StaffAccess => ({
  id: me,
  role,
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  ...ticks,
});

const tickCombinations = [
  { treatsPatients: false, consultant: false },
  { treatsPatients: true, consultant: false },
  { treatsPatients: false, consultant: true },
  { treatsPatients: true, consultant: true },
];

function allows(cell: Cell, ticks: { treatsPatients: boolean; consultant: boolean }): boolean {
  switch (cell) {
    case '-':
      return false;
    case 'yes':
    case 'own':
      return true;
    case 'treats':
      return ticks.treatsPatients;
    case 'consultant':
      return ticks.consultant;
    case 'consultant+treats':
      return ticks.consultant && ticks.treatsPatients;
  }
}

describe('the permission map', () => {
  it('has a PRD row for every action, and no row the map lacks', () => {
    expect([...actions].sort()).toEqual(Object.keys(expected).sort());
  });

  describe.each(staffRoles.map((role, column) => ({ role, column })))(
    '$role',
    ({ role, column }) => {
      it.each(actions)(
        '%s matches the PRD access summary with every tick combination',
        (action) => {
          const cell = expected[action][column] ?? '-';
          for (const ticks of tickCombinations) {
            const staff = person(role, ticks);
            const allowed = allows(cell, ticks);
            expect(can(staff, action, { ownerId: me, centreId: hsr }), JSON.stringify(ticks)).toBe(
              allowed,
            );
            expect(accessScope(staff, action)).toBe(
              allowed ? (cell === 'own' ? 'own' : 'any') : null,
            );
          }
        },
      );
    },
  );

  it('gives Finance and Front Desk no clinical action, whatever their ticks', () => {
    const clinical: Action[] = [
      'clinical.read',
      'ai_prep.use',
      'consultant_records.write',
      'consultant_records.sign',
      'session_notes.write',
      'red_flags.view',
      'red_flags.act',
    ];
    for (const role of ['finance', 'front_desk'] as const) {
      const staff = person(role, { treatsPatients: true, consultant: true });
      for (const action of clinical) expect(can(staff, action), `${role} ${action}`).toBe(false);
    }
  });
});

describe('centre scope', () => {
  it('limits people to the centres they are assigned', () => {
    const desk = person('front_desk');
    expect(can(desk, 'bookings.manage', { centreId: hsr })).toBe(true);
    expect(can(desk, 'bookings.manage', { centreId: whitefield })).toBe(false);
    const manager = person('centre_manager', { centreIds: [] });
    expect(can(manager, 'rosters.manage', { centreId: hsr })).toBe(false);
  });

  it('lets Super Admin and Finance act in every centre', () => {
    for (const role of ['super_admin', 'finance'] as const) {
      expect(can(person(role, { centreIds: [] }), 'prices.manage', { centreId: whitefield })).toBe(
        true,
      );
    }
  });
});

describe('own scope', () => {
  it('lets a physio act on their own records only', () => {
    const physio = person('physiotherapist', { treatsPatients: true });
    expect(can(physio, 'calendar.view', { ownerId: me })).toBe(true);
    expect(can(physio, 'calendar.view', { ownerId: someoneElse })).toBe(false);
    expect(can(physio, 'calendar.view')).toBe(false);
    expect(can(physio, 'leave.manage', { ownerId: someoneElse })).toBe(false);
  });

  it('does not limit roles with a full grant', () => {
    expect(can(person('front_desk'), 'calendar.view', { ownerId: someoneElse })).toBe(true);
    expect(can(person('centre_manager'), 'leave.manage', { ownerId: someoneElse })).toBe(true);
  });
});

// IAM-08: a Velyx support login is a Super Admin without ticks that never reads clinical records.
describe('a Velyx support login', () => {
  const support = { ...person('super_admin'), support: true };

  it('has no clinical action, though the Super Admin reads clinical records without a tick', () => {
    expect(can(person('super_admin'), 'clinical.read')).toBe(true);
    for (const action of deniedToSupport) expect(can(support, action), action).toBe(false);
    expect(deniedToSupport).toEqual(
      expect.arrayContaining(['clinical.read', 'red_flags.view', 'ai_prep.use']),
    );
  });

  it('may open what the Super Admin opens otherwise (it is read only in every service)', () => {
    for (const action of actions.filter((a) => !deniedToSupport.includes(a))) {
      expect(accessScope(support, action), action).toBe(accessScope(person('super_admin'), action));
    }
  });
});
