import { z } from 'zod';

/**
 * Staff sign in and password reset (IAM-01). The browser posts these to our server, which calls
 * Supabase Auth; the browser never talks to Supabase (rule 9).
 */

/**
 * Shortest password allowed. Supabase Auth enforces the same minimum (`minimum_password_length`
 * in supabase/config.toml and in each project's auth settings); checking it here first gives a
 * clear message and keeps a reset link usable after a too short attempt.
 */
export const PASSWORD_MIN_LENGTH = 12;

// Trimmed before it is checked, so a pasted address with a space around it still works.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter your email address.' }));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: 'Enter your password.' }),
});

export const passwordResetRequestSchema = z.object({ email });

export const newPasswordSchema = z.object({
  tokenHash: z.string().min(1),
  /** Which email the link came from: a password reset, or an invite (IAM-06). */
  linkType: z.enum(['recovery', 'invite']).default('recovery'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, { error: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.` }),
});

export type SignInInput = z.infer<typeof signInSchema>;

const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { error: 'Enter the 6 digit code from your authenticator app.' });

/** A code from the authenticator app, to finish signing in (IAM-02). */
export const twoStepCodeSchema = z.object({ code });

/** The first code from a newly added authenticator app, to turn two step verification on. */
export const twoStepSetupSchema = z.object({ factorId: z.string().min(1), code });
