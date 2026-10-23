import 'server-only';
import { headers } from 'next/headers';

/**
 * Our own address for this request, for links we hand out: invite links, the health form QR
 * (rule 9: never supabase.co). Vercel passes the public host and protocol in forwarded headers.
 */
export async function ownOrigin(): Promise<string> {
  const request = await headers();
  const host = request.get('x-forwarded-host') ?? request.get('host') ?? 'localhost:3000';
  const protocol =
    request.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}
