/**
 * The address a request came from (IAM-11), for rate limits and the audit trail. On Vercel,
 * `x-real-ip` is set by Vercel itself and a browser cannot change it; `x-forwarded-for` is the
 * fallback elsewhere (local and CI runs). Undefined when neither is there.
 */
export function requestAddress(headers: Pick<Headers, 'get'>): string | undefined {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
}
