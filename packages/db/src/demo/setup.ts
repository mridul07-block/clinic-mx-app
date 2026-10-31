import { addDays, istDate, istInstant, type Weekly } from '@clinic-mx/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { insertExercise } from '../exercises';
import { hashKioskToken, insertKioskDevice, newKioskToken } from '../kiosk';
import { insertDiscountPreset, insertPackageType } from '../prices';
import { insertLeave, saveRoster } from '../rosters';
import {
  discountPreset,
  exercise,
  kioskDevice,
  packageType,
  priceItem,
  roster,
  staffLeave,
  staffUser,
} from '../schema';
import { setConsultationFee } from '../staff';
import type { DbOrTransaction } from '../versioned';
import { demoCentres, demoStaff } from './context';

/**
 * The clinic set up the way the screens need it (docs/runbooks/demo-data.md): working hours for
 * the test physios, consultation fees, packages, discounts, a few library exercises, a kiosk tablet
 * per centre and some leave. Each part is skipped when something like it is already there, so
 * nothing the people testing have set up is changed. Kept by `demo:remove`.
 */

/** Monday to Saturday, 9:00 to 13:00 and 16:00 to 20:00 IST; Sunday off. */
export const DEMO_WEEK: Weekly = Array.from({ length: 7 }, (_, day) =>
  day === 6
    ? []
    : [
        { starts: 9 * 60, ends: 13 * 60 },
        { starts: 16 * 60, ends: 20 * 60 },
      ],
);

/** Hours start this long before today, so the history's visits show on the calendar. */
export const DEMO_HISTORY_DAYS = 190;

const exercises = [
  { name: 'Clamshells', defaultDose: '3 sets of 12, each side' },
  { name: 'Glute bridge', defaultDose: '3 sets of 15' },
  { name: 'Wall slides', defaultDose: '2 sets of 10' },
  { name: 'Heel raises', defaultDose: '3 sets of 15' },
  { name: 'Chin tucks', defaultDose: '10 holds of 5 seconds' },
  { name: 'Bird dog', defaultDose: '2 sets of 10, each side' },
  { name: 'Terminal knee extension', defaultDose: '3 sets of 15' },
  { name: 'Wrist flexor stretch', defaultDose: '3 holds of 30 seconds' },
];

export interface SetupCounts {
  rosters: number;
  fees: number;
  packageTypes: number;
  discounts: number;
  exercises: number;
  kiosks: number;
  leave: number;
}

export async function demoSetup(tx: DbOrTransaction, now = new Date()): Promise<SetupCounts> {
  const counts: SetupCounts = {
    rosters: 0,
    fees: 0,
    packageTypes: 0,
    discounts: 0,
    exercises: 0,
    kiosks: 0,
    leave: 0,
  };
  const by = demoStaff.superAdmin.id;
  const today = istDate(now);

  for (const centre of demoCentres()) {
    for (const member of new Set([centre.consultant, centre.physio])) {
      // Hours only for someone with none at this centre yet.
      const [has] = await tx
        .select({ id: roster.id })
        .from(roster)
        .where(and(eq(roster.staffUserId, member.id), eq(roster.centreId, centre.id)))
        .limit(1);
      if (!has) {
        await saveRoster(tx, {
          staffUserId: member.id,
          centreId: centre.id,
          effectiveFrom: addDays(today, -DEMO_HISTORY_DAYS),
          weekly: DEMO_WEEK,
          createdBy: by,
        });
        counts.rosters += 1;
      }
    }
    // A consultant without a fee makes no consultation bill (BIL-05).
    const [fee] = await tx
      .select({ item: staffUser.consultationPriceItemId })
      .from(staffUser)
      .where(eq(staffUser.id, centre.consultant.id));
    if (!fee?.item) {
      const key = centre.consultant.role === 'super_admin' ? 'senior_consultation' : 'consultation';
      const [item] = await tx
        .select({ id: priceItem.id })
        .from(priceItem)
        .where(eq(priceItem.key, key));
      if (item && (await setConsultationFee(tx, centre.consultant.id, item.id))) counts.fees += 1;
    }
    const [tablet] = await tx
      .select({ id: kioskDevice.id })
      .from(kioskDevice)
      .where(eq(kioskDevice.centreId, centre.id))
      .limit(1);
    if (!tablet) {
      await insertKioskDevice(tx, {
        centreId: centre.id,
        name: 'Reception tablet',
        createdBy: by,
        tokenHash: hashKioskToken(newKioskToken()),
      });
      counts.kiosks += 1;
    }
  }

  const [anyPackage] = await tx
    .select({ id: packageType.id })
    .from(packageType)
    .where(eq(packageType.active, true))
    .limit(1);
  if (!anyPackage) {
    const [session] = await tx
      .select({ id: priceItem.id, amount: priceItem.amountPaise })
      .from(priceItem)
      .where(eq(priceItem.key, 'rehabilitation_session'));
    if (session) {
      for (const [sessions, off] of [
        [6, 0.9],
        [12, 0.8],
      ] as const) {
        await insertPackageType(tx, {
          name: `Rehabilitation ${sessions} sessions`,
          sessions,
          price: Math.round((session.amount * sessions * off) / 100) * 100,
          itemIds: [session.id],
        });
        counts.packageTypes += 1;
      }
    }
  }

  const [anyDiscount] = await tx
    .select({ id: discountPreset.id })
    .from(discountPreset)
    .where(eq(discountPreset.active, true))
    .limit(1);
  if (!anyDiscount) {
    await insertDiscountPreset(tx, { name: 'Senior citizen', kind: 'percent', percent: 10 });
    await insertDiscountPreset(tx, { name: 'Staff family', kind: 'flat', amount: 50000 });
    counts.discounts += 2;
  }

  const [libraryCount] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(exercise)
    .where(isNull(exercise.retiredAt));
  if ((libraryCount?.n ?? 0) < exercises.length) {
    const have = new Set(
      (
        await tx.select({ name: exercise.name }).from(exercise).where(isNull(exercise.retiredAt))
      ).map((row) => row.name),
    );
    for (const one of exercises) {
      if (have.has(one.name)) continue;
      await insertExercise(tx, { ...one, by });
      counts.exercises += 1;
    }
  }

  // Leave: one approved day next week for the Whitefield physio, one asked for at Koramangala.
  const [anyLeave] = await tx
    .select({ id: staffLeave.id })
    .from(staffLeave)
    .where(sql`${staffLeave.endsAt} > now()`)
    .limit(1);
  if (!anyLeave) {
    const [, kor, wfd] = demoCentres();
    if (kor && wfd) {
      const day = (offset: number) => addDays(today, offset);
      await insertLeave(tx, {
        staffUserId: wfd.physio.id,
        startsAt: istInstant(day(8), 0),
        endsAt: istInstant(day(9), 0),
        allDay: true,
        note: 'Family function',
        status: 'approved',
        requestedBy: by,
      });
      await insertLeave(tx, {
        staffUserId: kor.physio.id,
        startsAt: istInstant(day(12), 16 * 60),
        endsAt: istInstant(day(12), 20 * 60),
        allDay: false,
        note: 'Course in the afternoon',
        status: 'requested',
        requestedBy: kor.physio.id,
      });
      counts.leave += 2;
    }
  }
  return counts;
}
