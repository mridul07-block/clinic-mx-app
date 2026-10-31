import type { ScreeningRegion } from '@clinic-mx/schemas';
import { and, asc, eq } from 'drizzle-orm';
import type { StaffMember } from '../identity';
import { latestKnowledgeVersion } from '../knowledge';
import { appointmentType, kbCondition, packageType, priceItem } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import type { DbOrTransaction } from '../versioned';

/**
 * Who and what the demo data is made with: the seed's test staff (the logins people test with),
 * the knowledge base on the target, and the clinic's own price list and visit types.
 */

export function seedMember(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`The seed has no ${email}.`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}

export const demoStaff = {
  superAdmin: seedMember('super.admin@clinicmx.test'),
  finance: seedMember('finance@clinicmx.test'),
  manager: seedMember('manager@clinicmx.test'),
};

/** A centre with the people who work its demo patients. */
export interface DemoCentre {
  id: string;
  code: 'hsr' | 'kor' | 'wfd';
  desk: StaffMember;
  /** Consultations, plans and discharges. */
  consultant: StaffMember;
  /** Treatment sessions. */
  physio: StaffMember;
}

export function demoCentres(): DemoCentre[] {
  const physioHsr = seedMember('physio.hsr@clinicmx.test');
  const physioWfd = seedMember('physio.whitefield@clinicmx.test');
  return [
    {
      id: centreIds.hsrLayout,
      code: 'hsr',
      desk: seedMember('desk.hsr@clinicmx.test'),
      consultant: physioHsr,
      physio: physioHsr,
    },
    {
      id: centreIds.koramangala,
      code: 'kor',
      desk: seedMember('desk.koramangala@clinicmx.test'),
      // Koramangala's seed physio is not a consultant; the Super Admin consultant sees them.
      consultant: demoStaff.superAdmin,
      physio: seedMember('physio.koramangala@clinicmx.test'),
    },
    {
      id: centreIds.whitefield,
      code: 'wfd',
      desk: seedMember('desk.whitefield@clinicmx.test'),
      consultant: physioWfd,
      physio: physioWfd,
    },
  ];
}

export interface DemoCondition {
  conditionId: string;
  name: string;
  region: string;
  /** Where the health form's body chart puts it, for the episode's region. */
  bodyRegion: ScreeningRegion;
}

/** The workbooks' regions as the health form's body chart names them. */
const bodyRegions: Record<string, ScreeningRegion> = {
  shoulder: 'shoulder',
  elbow: 'elbow',
  forearm_wrist: 'wrist_hand',
  hip: 'hip',
  knee: 'knee',
  foot_ankle: 'foot_ankle',
  cervical: 'neck',
  lumbar_sij: 'back',
};

export interface DemoCatalog {
  kbVersionId: string;
  conditions: DemoCondition[];
  types: { consultation: string; session: string };
  prices: {
    consultation: string;
    session: string;
    sessionPaise: number;
    consultationPaise: number;
  };
  packages: { id: string; name: string; sessions: number; pricePaise: number }[];
}

export class DemoSetupError extends Error {}

/** The knowledge base, visit types and prices on the target; the setup has made the packages. */
export async function demoCatalog(db: DbOrTransaction): Promise<DemoCatalog> {
  const version = await latestKnowledgeVersion(db);
  if (!version) {
    throw new DemoSetupError(
      'There is no knowledge base version here; run pnpm kb:import --apply first.',
    );
  }
  const all = await db
    .select({
      conditionId: kbCondition.conditionId,
      name: kbCondition.name,
      region: kbCondition.homeRegion,
    })
    .from(kbCondition)
    .where(eq(kbCondition.kbVersionId, version.id))
    .orderBy(asc(kbCondition.conditionId));
  // A spread of the common ones: a few from each workbook's region.
  const byRegion = new Map<string, DemoCondition[]>();
  for (const row of all) {
    // A region the body chart has (bone stress conditions sit in several, so are left out).
    const bodyRegion = bodyRegions[row.region];
    if (!bodyRegion) continue;
    const list = byRegion.get(row.region) ?? [];
    if (list.length < 4) list.push({ ...row, bodyRegion });
    byRegion.set(row.region, list);
  }
  const conditions = [...byRegion.values()].flat();
  if (conditions.length === 0) throw new DemoSetupError('The knowledge base has no conditions.');

  const typeId = async (key: string) => {
    const [row] = await db
      .select({ id: appointmentType.id })
      .from(appointmentType)
      .where(eq(appointmentType.key, key));
    if (!row) throw new DemoSetupError(`There is no ${key} visit type.`);
    return row.id;
  };
  const price = async (key: string) => {
    const [row] = await db
      .select({ id: priceItem.id, amount: priceItem.amountPaise })
      .from(priceItem)
      .where(and(eq(priceItem.key, key), eq(priceItem.active, true)));
    if (!row) throw new DemoSetupError(`There is no active ${key} price.`);
    return row;
  };
  const consultation = await price('consultation');
  const session = await price('rehabilitation_session');
  const packages = await db
    .select({
      id: packageType.id,
      name: packageType.name,
      sessions: packageType.sessions,
      pricePaise: packageType.pricePaise,
    })
    .from(packageType)
    .where(eq(packageType.active, true))
    .orderBy(asc(packageType.sessions));
  if (packages.length === 0) throw new DemoSetupError('There is no active package type.');
  return {
    kbVersionId: version.id,
    conditions,
    types: { consultation: await typeId('consultation'), session: await typeId('session') },
    prices: {
      consultation: consultation.id,
      consultationPaise: consultation.amount,
      session: session.id,
      sessionPaise: session.amount,
    },
    packages,
  };
}
