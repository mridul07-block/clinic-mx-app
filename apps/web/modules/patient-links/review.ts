import 'server-only';
import { episodeForMessage } from '@clinic-mx/db';
import { appDb } from '../../lib/db';

/**
 * Where the review request's button leads (WA-06; PAT-09): the Google review page of the centre
 * of the link's episode, or null when the centre has none. A public address, read as the server;
 * nothing of the patient is shown or stored.
 */
export async function reviewPageOf(link: { episodeId: string | null }): Promise<string | null> {
  if (!link.episodeId) return null;
  return (await episodeForMessage(appDb(), link.episodeId))?.reviewLink ?? null;
}
