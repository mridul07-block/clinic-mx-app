/**
 * Packages (BIL-08, PRD J4.7, TAD section 4). Paying a package's bill activates it: its sessions,
 * valid until `packages.validity_months` after the payment date (`packageValidUntil`), and its
 * reschedule allowance. Closing a treatment session uses one (SES-07). Its state is worked out
 * from the row, so nothing has to run when it expires (user decisions, 25 October 2026).
 */

export const packageStates = ['active', 'used_up', 'expired', 'cancelled'] as const;
export type PackageState = (typeof packageStates)[number];

export const packageStateLabels: Record<PackageState, string> = {
  active: 'Active',
  used_up: 'Used up',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

/**
 * A package's state on an IST day (`today`, YYYY-MM-DD): cancelled when its payment was undone,
 * used up when every session is used, expired once its valid until day has passed (the sessions
 * left stay on record; credits and extensions wait for the client, DECISION 12), else active.
 */
export function packageState(
  held: {
    sessionsTotal: number;
    sessionsUsed: number;
    validUntil: string;
    cancelledAt: Date | null;
  },
  today: string,
): PackageState {
  if (held.cancelledAt) return 'cancelled';
  if (held.sessionsUsed >= held.sessionsTotal) return 'used_up';
  if (today > held.validUntil) return 'expired';
  return 'active';
}

/**
 * The reschedules a package allows (PRD section 7: 1 per 10 booked sessions), rounded down (user
 * decision, 25 October 2026): 10 or 12 sessions allow 1, 20 allow 2, 6 allow none.
 */
export function rescheduleAllowance(sessions: number, perTen: number): number {
  return Math.floor(sessions / 10) * perTen;
}

/** Finance's package lists (Frontend Specification, Finance's Packages tab). */
export const packageListFilters = ['active', 'expiring', 'expired'] as const;
export type PackageListFilter = (typeof packageListFilters)[number];

export const packageListFilterLabels: Record<PackageListFilter, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired with sessions left',
};
