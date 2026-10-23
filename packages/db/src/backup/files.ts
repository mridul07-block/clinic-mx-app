import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { FileEntry } from './manifest';

/**
 * Stored files in a backup (FND-13): every object in every storage bucket (signatures, report
 * photos and scans), copied server to server with the service role key. The database dump holds
 * the rows that describe them; these are the bytes.
 */
const PAGE = 1000;

export function storageAdmin(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type StorageAdmin = ReturnType<typeof storageAdmin>;

/** Every object path in a bucket, folders walked. */
async function objectPaths(storage: StorageAdmin, bucket: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.storage
      .from(bucket)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Listing ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders have no id.
      if (item.id === null) paths.push(...(await objectPaths(storage, bucket, path)));
      else paths.push(path);
    }
    if (data.length < PAGE) return paths;
  }
}

/** Downloads every object into `<dir>/<bucket>/<path>`; returns how many per bucket. */
export async function downloadAllFiles(
  storage: StorageAdmin,
  dir: string,
): Promise<Record<string, number>> {
  const { data: buckets, error } = await storage.storage.listBuckets();
  if (error) throw new Error(`Listing buckets: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const bucket of buckets) {
    const paths = await objectPaths(storage, bucket.id);
    for (const path of paths) {
      const { data, error: failed } = await storage.storage.from(bucket.id).download(path);
      if (failed) throw new Error(`Downloading ${bucket.id}/${path}: ${failed.message}`);
      const target = join(dir, bucket.id, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await data.arrayBuffer()));
    }
    counts[bucket.id] = paths.length;
  }
  return counts;
}

/**
 * Puts a backup's files back (`<bucket>/<path>` entries) into a restored project, whose buckets
 * and object rows came back with the database; each with the type its row records, since buckets
 * accept only some types. Overwrites, so it can be run again.
 */
export async function uploadFiles(
  storage: StorageAdmin,
  dir: string,
  files: FileEntry[],
  contentTypes: ReadonlyMap<string, string>,
): Promise<number> {
  for (const file of files) {
    const [bucket = '', ...rest] = file.path.split('/');
    const { error } = await storage.storage
      .from(bucket)
      .upload(rest.join('/'), await readFile(join(dir, file.path)), {
        upsert: true,
        contentType: contentTypes.get(file.path),
      });
    if (error) throw new Error(`Uploading ${file.path}: ${error.message}`);
  }
  return files.length;
}
