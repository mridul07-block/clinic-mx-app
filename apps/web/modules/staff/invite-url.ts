import 'server-only';
import { ownOrigin } from '../../lib/own-origin';

/** Our own address for this request, for invite links (never supabase.co, rule 9). */
export async function inviteUrl(tokenHash: string): Promise<string> {
  const query = new URLSearchParams({ token_hash: tokenHash, type: 'invite' });
  return `${await ownOrigin()}/app/reset-password?${query.toString()}`;
}
