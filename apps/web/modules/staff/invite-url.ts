import 'server-only';
import { headers } from 'next/headers';

/** Our own address for this request, for invite links (never supabase.co, rule 9). */
export async function inviteUrl(tokenHash: string): Promise<string> {
  const request = await headers();
  const host = request.get('x-forwarded-host') ?? request.get('host') ?? 'localhost:3000';
  const protocol =
    request.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const query = new URLSearchParams({ token_hash: tokenHash, type: 'invite' });
  return `${protocol}://${host}/app/reset-password?${query.toString()}`;
}
