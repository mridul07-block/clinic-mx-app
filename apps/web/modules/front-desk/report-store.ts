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
  /** The file's bytes (ALT-08), once the service has checked the person may open it. */
  get(path: string): Promise<Uint8Array>;
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
    async get(path) {
      const { data, error } = await bucket().download(path);
      if (error) throw new Error(`The report could not be read: ${error.message}`);
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}
