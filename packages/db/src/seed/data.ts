import type { NewCentre, NewStaffUser, NewStaffUserCentre } from '../schema';

/**
 * Seed data for local and staging databases. Fixed ids make the seed safe to re-run: rows
 * are updated in place, never duplicated. Staff are generated test people with emails on
 * the reserved `.test` domain (rule 12); they get logins in IAM-01.
 */

export const centreIds = {
  hsrLayout: '00000000-0000-4000-8000-000000000101',
  koramangala: '00000000-0000-4000-8000-000000000102',
  whitefield: '00000000-0000-4000-8000-000000000103',
} as const;

// Addresses from the clinics' public Google Business listings (21 October 2026); confirm
// with the clinic. The Koramangala listing is named "Movementology Academy". No public
// address was found for Whitefield. Phones and map links are added by the Super Admin.
// Colours are the centre chart colours from the Frontend Specification. Codes start OP numbers
// (SCH-01, user decision 22 October 2026).
export const seedCentres = [
  {
    id: centreIds.hsrLayout,
    name: 'HSR Layout',
    code: 'HSR',
    address: 'Bhagyalaxmi Square, 17/N, 18th Main Rd, Sector 3, HSR Layout, Bengaluru 560102',
    colour: '#2F74BB',
  },
  {
    id: centreIds.koramangala,
    name: 'Koramangala',
    code: 'KOR',
    address: '#89, 17th D Main, 6th Block, Koramangala, Bengaluru 560095',
    colour: '#7F5BB6',
  },
  {
    id: centreIds.whitefield,
    name: 'Whitefield',
    code: 'WFD',
    address: null,
    colour: '#1C8580',
  },
] satisfies NewCentre[];

type SeedStaff = NewStaffUser & { id: string; centres: string[] };

const staffId = (n: number) => `00000000-0000-4000-8000-${String(200 + n).padStart(12, '0')}`;

const staff: SeedStaff[] = [
  {
    id: staffId(1),
    name: 'Test Super Admin',
    email: 'super.admin@clinicmx.test',
    role: 'super_admin',
    treatsPatients: true,
    consultant: true,
    centres: [],
  },
  {
    id: staffId(2),
    name: 'Test Finance',
    email: 'finance@clinicmx.test',
    role: 'finance',
    centres: [],
  },
  {
    id: staffId(3),
    name: 'Test Centre Manager',
    email: 'manager@clinicmx.test',
    role: 'centre_manager',
    centres: [centreIds.hsrLayout, centreIds.koramangala],
  },
  {
    id: staffId(4),
    name: 'Test Front Desk HSR',
    email: 'desk.hsr@clinicmx.test',
    role: 'front_desk',
    centres: [centreIds.hsrLayout],
  },
  {
    id: staffId(5),
    name: 'Test Front Desk Koramangala',
    email: 'desk.koramangala@clinicmx.test',
    role: 'front_desk',
    centres: [centreIds.koramangala],
  },
  {
    id: staffId(6),
    name: 'Test Front Desk Whitefield',
    email: 'desk.whitefield@clinicmx.test',
    role: 'front_desk',
    centres: [centreIds.whitefield],
  },
  {
    id: staffId(7),
    name: 'Test Consultant Physio HSR',
    email: 'physio.hsr@clinicmx.test',
    role: 'physiotherapist',
    treatsPatients: true,
    consultant: true,
    centres: [centreIds.hsrLayout],
  },
  {
    id: staffId(8),
    name: 'Test Physio Koramangala',
    email: 'physio.koramangala@clinicmx.test',
    role: 'physiotherapist',
    treatsPatients: true,
    centres: [centreIds.koramangala],
  },
  {
    id: staffId(9),
    name: 'Test Consultant Physio Whitefield',
    email: 'physio.whitefield@clinicmx.test',
    role: 'physiotherapist',
    treatsPatients: true,
    consultant: true,
    centres: [centreIds.whitefield],
  },
  // Super Admins for the staff management end to end tests (IAM-06), one per browser project, so
  // they never share two step verification with the Super Admin above.
  {
    id: staffId(10),
    name: 'Test Staff Admin Phone',
    email: 'admin.phone@clinicmx.test',
    role: 'super_admin',
    centres: [],
  },
  {
    id: staffId(11),
    name: 'Test Staff Admin Desktop',
    email: 'admin.desktop@clinicmx.test',
    role: 'super_admin',
    centres: [],
  },
  // A Velyx support login (IAM-08): signs in only while the Super Admin grants support access.
  {
    id: staffId(12),
    name: 'Test Velyx Support',
    email: 'support.velyx@clinicmx.test',
    role: 'super_admin',
    velyxSupport: true,
    centres: [],
  },
];

export const seedStaff: NewStaffUser[] = staff.map(({ centres: _centres, ...row }) => row);

export const seedStaffCentres: NewStaffUserCentre[] = staff.flatMap((member) =>
  member.centres.map((centreId) => ({ staffUserId: member.id, centreId })),
);
