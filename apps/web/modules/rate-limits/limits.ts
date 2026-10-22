import 'server-only';
import {
  clearRateLimit,
  rateLimitHits,
  recordRateLimitHit,
  type RateLimitWindow,
} from '@clinic-mx/db';
import { appDb } from '../../lib/db';
import { getSetting } from '../settings/settings';

/**
 * Rate limits (IAM-11, TAD section 8) on sign in, patient links and webhooks. Each limit is a
 * setting `limits.<name>`, `{ count, minutes }` (user decision 22 October 2026: the balanced
 * set), counted in fixed windows in `rate_limit` on the owner connection: no person drives these
 * counts, and only hashes of the keys are stored.
 */
export type LimitName =
  | 'sign_in_per_email'
  | 'sign_in_per_network'
  | 'reset_email_per_email'
  | 'reset_email_per_network'
  | 'two_step_per_person'
  | 'bad_links_per_network'
  | 'link_opens_per_network'
  | 'webhook_failures_per_network';

export interface LimitState {
  limited: boolean;
  /** Until the window ends; 0 when not limited. */
  retryAfterSeconds: number;
}

/** The key for a network: its address, or one shared key when the address is unknown. */
export const networkKey = (address: string | undefined): string => address ?? 'unknown';

const setting = (name: LimitName) => getSetting(`limits.${name}`);

function state(window: RateLimitWindow, isLimited: boolean, now = Date.now()): LimitState {
  if (!isLimited) return { limited: false, retryAfterSeconds: 0 };
  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil((window.endsAt.getTime() - now) / 1000)),
  };
}

/** Whether the next attempt is refused: the window already holds `count` attempts. */
export async function limited(name: LimitName, key: string): Promise<LimitState> {
  const { count, minutes } = await setting(name);
  const window = await rateLimitHits(appDb(), name, key, minutes);
  return state(window, window.hits >= count);
}

/** Counts an attempt that failed (a wrong password, a link that is not valid, a wrong secret). */
export async function count(name: LimitName, key: string): Promise<void> {
  const { minutes } = await setting(name);
  await recordRateLimitHit(appDb(), name, key, minutes);
}

/** Counts this attempt, then says whether it is over the limit: where every request counts. */
export async function take(name: LimitName, key: string): Promise<LimitState> {
  const { count: allowed, minutes } = await setting(name);
  const window = await recordRateLimitHit(appDb(), name, key, minutes);
  return state(window, window.hits > allowed);
}

/** Forgets the attempts for a key, for example an email that has now signed in. */
export async function clear(name: LimitName, key: string): Promise<void> {
  await clearRateLimit(appDb(), name, key);
}

/** The first of several limits that refuses, or a state that allows. */
export async function firstLimited(checks: Promise<LimitState>[]): Promise<LimitState> {
  const states = await Promise.all(checks);
  return states.find((s) => s.limited) ?? { limited: false, retryAfterSeconds: 0 };
}

/** "Try again in N minutes", for staff. */
export function tryAgainIn({ retryAfterSeconds }: LimitState): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}
