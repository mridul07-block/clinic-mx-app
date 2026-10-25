import 'server-only';
import {
  billsOfEpisode,
  consultationFeeState,
  episodeRecord,
  packagesOfEpisode,
  packageTypeList,
  patientRecord,
  planChoicesOf,
  planForPricing,
  priceItemList,
  type BillEntry,
  type PackageEntry,
  type DbOrTransaction,
  type PlanChoiceEntry,
  type PlanForPricing,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  consultationFeeDue,
  istDate,
  planOptions,
  type EpisodeStatus,
  type PlanOptions,
  type PriceItemPrice,
} from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * The plan and payment sheet (BIL-01, PRD J4.2): for those who see bill amounts (the front desk,
 * Finance, the Super Admin), the recommended plan read only, as far as pricing needs it, and what
 * it costs per session or as a package from the price master. The front desk picks the session
 * type (user decision, 25 October 2026); prices are never edited here. The patient's choice is
 * BIL-02's (`plan-choice.ts`); consent and payment come with BIL-03 onwards.
 */

export interface PlanSheet {
  episodeId: string;
  episodeStatus: EpisodeStatus;
  patientId: string;
  patientName: string;
  opNumber: string;
  centreName: string | null;
  /** Undefined until the consultation is signed (or for a reader who may not price it). */
  plan: PlanForPricing | undefined;
  /** The session types offered, from `billing.session_price_items`. */
  sessionItems: PriceItemPrice[];
  options: PlanOptions | undefined;
  /** The patient's choices, newest first (BIL-02); the first is the one that counts. */
  choices: PlanChoiceEntry[];
  /** Whether this person may record a choice now: Plan proposed, a plan, at their centre. */
  canRecordChoice: boolean;
  /** The episode's bills, newest first (BIL-05). */
  bills: BillEntry[];
  /** Whether this person takes payment here (BIL-06). */
  canCollect: boolean;
  /** The episode's packages, newest first (BIL-08). */
  packages: PackageEntry[];
  /** Today in IST and `packages.expiry_reminder_days`, for the meter's "Expiring" tag. */
  today: string;
  expiringDays: number;
  /** The consultation fee when it is due and not billed: why, and whether the desk can make it. */
  unbilledFee: { consultantName: string; feeSet: boolean; canMake: boolean } | undefined;
}

/** The active price items, the session types offered and the active packages, from Prices. */
export async function priceListsOf(tx: DbOrTransaction, sessionKeys: readonly string[]) {
  const active: PriceItemPrice[] = (await priceItemList(tx))
    .filter((item) => item.active)
    .map(({ id, key, label, amountPaise }) => ({ id, key, label, amountPaise }));
  const sessionItems = sessionKeys.flatMap((key) => active.filter((item) => item.key === key));
  const packages = (await packageTypeList(tx))
    .filter((type) => type.active)
    .map((type) => ({
      id: type.id,
      name: type.name,
      sessions: type.sessions,
      pricePaise: type.pricePaise,
      itemIds: type.items.map((item) => item.id),
    }));
  return { active, sessionItems, packages };
}

/** The sheet for an episode; undefined when the reader does not see the episode. */
export async function planSheetOf(
  actor: StaffMember,
  episodeId: string,
  sessionKey?: string,
): Promise<PlanSheet | undefined> {
  assertMay(actor, 'bills.view_amounts');
  const [sessionKeys, validityMonths, feeTiming, expiringDays] = await Promise.all([
    getSetting('billing.session_price_items'),
    getSetting('packages.validity_months'),
    getSetting('billing.consultation_fee_timing'),
    getSetting('packages.expiry_reminder_days'),
  ]);
  return asStaff(actor, async (tx) => {
    const episode = await episodeRecord(tx, episodeId);
    if (!episode) return undefined;
    const patient = await patientRecord(tx, episode.patientId);
    if (!patient) return undefined;
    const plan = await planForPricing(tx, episodeId);
    const { active, sessionItems, packages } = await priceListsOf(tx, sessionKeys);
    const sessionItem = sessionItems.find((item) => item.key === sessionKey) ?? sessionItems.at(0);
    const choices = await planChoicesOf(tx, episodeId);
    const bills = await billsOfEpisode(tx, episodeId);
    const now = new Date();
    const bought = await packagesOfEpisode(tx, episodeId, now);
    const fee = await consultationFeeState(tx, episodeId);
    const collects = can(actor, 'bills.create_and_collect', { centreId: episode.centreId });
    return {
      episodeId,
      episodeStatus: episode.status,
      patientId: patient.id,
      patientName: patient.name,
      opNumber: patient.opNumber,
      centreName: episode.centreName,
      plan,
      sessionItems,
      options:
        plan && sessionItem
          ? planOptions(plan, sessionItem, active, packages, validityMonths)
          : undefined,
      choices,
      canRecordChoice:
        plan !== undefined && episode.status === 'plan_proposed' && !actor.support && collects,
      bills,
      canCollect: !actor.support && collects,
      packages: bought,
      today: istDate(now),
      expiringDays,
      unbilledFee:
        fee && !fee.billed && consultationFeeDue(feeTiming, fee.status)
          ? {
              consultantName: fee.consultantName,
              feeSet: fee.feeLabel !== null,
              canMake: fee.feeLabel !== null && !actor.support && collects,
            }
          : undefined,
    };
  });
}
