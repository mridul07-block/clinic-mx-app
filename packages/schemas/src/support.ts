import { z } from 'zod';

/**
 * Velyx support access (IAM-08, PRD section 2): off by default; the Super Admin grants it for a
 * number of hours, from now, with a reason. Support logins sign in only while a grant is active,
 * and are read only.
 */

/**
 * A grant from now, for whole hours up to `maxHours` (the setting
 * `security.support_grant_max_hours`).
 */
export function grantSupportSchema(maxHours: number) {
  const range = `Choose from 1 to ${maxHours} hours.`;
  return z.object({
    hours: z.coerce
      .number({ error: range })
      .int({ error: range })
      .min(1, { error: range })
      .max(maxHours, { error: range }),
    reason: z
      .string()
      .trim()
      .min(1, { error: 'Say what Velyx support needs the access for.' })
      .max(500, { error: 'Keep the reason under 500 characters.' }),
  });
}

export type GrantSupportInput = z.output<ReturnType<typeof grantSupportSchema>>;

/** Ending a grant early. */
export const endSupportSchema = z.object({ grantId: z.guid() });

/** A new Velyx support login: who it is for and the email it signs in with. */
export const supportLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter their email address.' })),
  name: z.string().trim().min(1, { error: 'Enter their name.' }).max(120),
});

/** When a grant made now ends. */
export function grantEndsAt(hours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + hours * 3_600_000);
}
