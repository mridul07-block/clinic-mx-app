import { z } from 'zod';

/**
 * The plan and payment sheet (BIL-01, PRD J4.2): the recommended plan read only, and what it costs
 * per session or as a package, from the price master. Pure: the page and its tests share it.
 * Decisions (user, 25 October 2026): the front desk picks the session type; modalities show their
 * price per use beside the total, not in it; packages are those covering the session type.
 */

/** What the sheet needs of the plan; nothing clinical (no diagnosis, goals or findings). */
export interface PricedPlan {
  sessionsPerWeek: number | null;
  weeks: number | null;
  modalities: { key: string; name: string }[];
}

export interface PriceItemPrice {
  id: string;
  key: string;
  label: string;
  amountPaise: number;
}

export interface PackageOffer {
  id: string;
  name: string;
  sessions: number;
  pricePaise: number;
  /** The price items it covers. */
  itemIds: readonly string[];
}

export interface PlanOptions {
  /** Sessions a week times weeks; null when the plan does not say both. */
  plannedSessions: number | null;
  perSession: { item: PriceItemPrice; totalPaise: number | null };
  /** Each planned modality, with its price per use; null where the price master has none. */
  modalities: { name: string; perUsePaise: number | null }[];
  packages: {
    id: string;
    name: string;
    sessions: number;
    pricePaise: number;
    perSessionPaise: number;
    cover: string;
    validity: string;
  }[];
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

/** How a package's sessions compare with the planned sessions. */
export function packageCover(sessions: number, planned: number | null): string {
  if (planned === null) return plural(sessions, 'session');
  if (sessions >= planned) {
    return planned === 1
      ? 'Covers the planned session'
      : `Covers all ${String(planned)} planned sessions`;
  }
  return `Covers ${String(sessions)} of ${plural(planned, 'planned session')}`;
}

/** The options for a plan at a session type, from the price master. */
export function planOptions(
  plan: PricedPlan,
  sessionItem: PriceItemPrice,
  prices: readonly PriceItemPrice[],
  packages: readonly PackageOffer[],
  validityMonths: number,
): PlanOptions {
  const plannedSessions =
    plan.sessionsPerWeek !== null && plan.weeks !== null ? plan.sessionsPerWeek * plan.weeks : null;
  return {
    plannedSessions,
    perSession: {
      item: sessionItem,
      totalPaise: plannedSessions === null ? null : plannedSessions * sessionItem.amountPaise,
    },
    modalities: plan.modalities.map((modality) => ({
      name: modality.name,
      perUsePaise: prices.find((price) => price.key === modality.key)?.amountPaise ?? null,
    })),
    packages: packages
      .filter((offer) => offer.itemIds.includes(sessionItem.id))
      .map((offer) => ({
        id: offer.id,
        name: offer.name,
        sessions: offer.sessions,
        pricePaise: offer.pricePaise,
        perSessionPaise: Math.round(offer.pricePaise / offer.sessions),
        cover: packageCover(offer.sessions, plannedSessions),
        validity: `Valid ${plural(validityMonths, 'month')} from payment`,
      }))
      .sort((a, b) => a.pricePaise - b.pricePaise),
  };
}

/** The sheet's address: the session type the desk picked, by its price item key. */
export const planSheetQuerySchema = z.object({
  session: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional()
    .catch(undefined),
});
