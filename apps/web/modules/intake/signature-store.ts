import 'server-only';
import { supabaseAdmin } from '../../lib/supabase/admin';

/**
 * The private `signatures` bucket (INT-06, TAD section 9): consent signatures drawn on the pad.
 * Only this server reaches it, with the service role, after the link has been checked (rule 9:
 * the browser never calls supabase.co).
 */
export interface SignatureStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
}

export function signatureStore(): SignatureStore {
  const bucket = () => supabaseAdmin().storage.from('signatures');
  return {
    async put(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`The signature could not be stored: ${error.message}`);
    },
    async remove(paths) {
      if (paths.length === 0) return;
      await bucket().remove(paths);
    },
  };
}
