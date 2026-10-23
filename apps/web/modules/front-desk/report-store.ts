import 'server-only';
import { supabaseAdmin } from '../../lib/supabase/admin';

/**
 * The private `reports` bucket (INT-02, TAD section 9). Only this server reaches it, with the
 * service role, after the service has checked the person's rights (rule 9: the browser never
 * calls supabase.co).
 */
export interface ReportStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
}

export function reportStore(): ReportStore {
  const bucket = () => supabaseAdmin().storage.from('reports');
  return {
    async put(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`The report could not be stored: ${error.message}`);
    },
    async remove(paths) {
      if (paths.length === 0) return;
      await bucket().remove(paths);
    },
  };
}
