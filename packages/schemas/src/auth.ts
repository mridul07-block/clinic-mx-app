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

const email = z.email({ error: 'Enter your email address.' }).trim().toLowerCase();

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: 'Enter your password.' }),
});

export const passwordResetRequestSchema = z.object({ email });

export const newPasswordSchema = z.object({
  tokenHash: z.string().min(1),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, { error: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.` }),
});

export type SignInInput = z.infer<typeof signInSchema>;
