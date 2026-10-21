import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Checks the tick's `Authorization: Bearer <JOBS_SECRET>` header in constant time, so the secret
 * cannot be guessed from response times. Hashing first gives both sides the same length.
 */
export function isAuthorisedTick(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header.slice('Bearer '.length)), digest(secret));
}
