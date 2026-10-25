import 'server-only';
import {
  episodeRecord,
  packageTypeList,
  patientRecord,
  planForPricing,
  priceItemList,
  type PlanForPricing,
  type StaffMember,
} from '@clinic-mx/db';
import {
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
 * type (user decision, 25 October 2026); prices are never edited here. The patient's choice,
 * consent and payment come with BIL-02 onwards.
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
}

/** The sheet for an episode; undefined when the reader does not see the episode. */
export async function planSheetOf(
  actor: StaffMember,
  episodeId: string,
  sessionKey?: string,
): Promise<PlanSheet | undefined> {
  assertMay(actor, 'bills.view_amounts');
  const [sessionKeys, validityMonths] = await Promise.all([
    getSetting('billing.session_price_items'),
    getSetting('packages.validity_months'),
  ]);
  return asStaff(actor, async (tx) => {
    const episode = await episodeRecord(tx, episodeId);
    if (!episode) return undefined;
    const patient = await patientRecord(tx, episode.patientId);
    if (!patient) return undefined;
    const plan = await planForPricing(tx, episodeId);
    const active: PriceItemPrice[] = (await priceItemList(tx))
      .filter((item) => item.active)
      .map(({ id, key, label, amountPaise }) => ({ id, key, label, amountPaise }));
    const sessionItems = sessionKeys.flatMap((key) => active.filter((item) => item.key === key));
    const sessionItem = sessionItems.find((item) => item.key === sessionKey) ?? sessionItems.at(0);
    const packages = (await packageTypeList(tx))
      .filter((type) => type.active)
      .map((type) => ({
        id: type.id,
        name: type.name,
        sessions: type.sessions,
        pricePaise: type.pricePaise,
        itemIds: type.items.map((item) => item.id),
      }));
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
    };
  });
}
