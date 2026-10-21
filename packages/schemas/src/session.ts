import { z } from 'zod';

/**
 * Session rules (IAM-07, PRD section 2, TAD section 5): desktop sessions end after a while
 * without activity; phone sessions persist behind the phone lock for a number of days. Both
 * limits are settings (security.desktop_idle_logout_minutes, security.phone_session_days).
 */

/** Decision G7: a desktop has a fine pointer and is at least 1024 px wide. */
export const DESKTOP_MEDIA_QUERY = '(pointer: fine) and (min-width: 1024px)';

export const deviceClasses = ['desktop', 'phone'] as const;
export const deviceClassSchema = z.enum(deviceClasses);
export type DeviceClass = z.infer<typeof deviceClassSchema>;

/** The device class for a sign in; anything unknown counts as desktop, the stricter rule. */
export function deviceClass(value: unknown): DeviceClass {
  return value === 'phone' ? 'phone' : 'desktop';
}

/** Why the server ended a session, shown on the sign in page. */
export const sessionEndReasons = ['idle', 'expired', 'ended'] as const;
export type SessionEndReason = (typeof sessionEndReasons)[number];

export interface SessionFacts {
  device: DeviceClass;
  now: Date;
  /** The last activity on a desktop; undefined when not known yet. */
  lastSeen?: Date;
  /** When the person signed in with their password. */
  signedInAt?: Date;
  idleMinutes: number;
  phoneDays: number;
}

/** Whether a signed in session may go on, or why it ends now. */
export function sessionVerdict(facts: SessionFacts): 'ok' | 'idle' | 'expired' {
  const { device, now, lastSeen, signedInAt, idleMinutes, phoneDays } = facts;
  if (device === 'desktop') {
    if (lastSeen && now.getTime() - lastSeen.getTime() > idleMinutes * 60_000) return 'idle';
    return 'ok';
  }
  if (signedInAt && now.getTime() - signedInAt.getTime() > phoneDays * 86_400_000) {
    return 'expired';
  }
  return 'ok';
}

const amrSchema = z.array(z.object({ method: z.string(), timestamp: z.number() }));

/**
 * When the session was signed in with a password, from the signed token's `amr` list (Supabase
 * Auth). Later steps such as a two step code add their own entries; the password one is the start.
 */
export function passwordSignInTime(amr: unknown): Date | undefined {
  const entries = amrSchema.safeParse(amr);
  if (!entries.success) return undefined;
  const start = entries.data.find((entry) => entry.method === 'password') ?? entries.data.at(0);
  return start ? new Date(start.timestamp * 1000) : undefined;
}
