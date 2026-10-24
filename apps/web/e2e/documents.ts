import {
  createDb,
  insertDocument,
  nextDocumentVersion,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import type { DocumentKind } from '@clinic-mx/schemas';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from './staff';

// Generated documents for end to end tests (ALT-05), made from the test runner the way the server
// makes them: a PDF in the private `documents` bucket and its row, written by the system. The PDF
// is a one page placeholder; ALT-05 itself renders no real document.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

const storage = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage.from('documents');
};

const placeholderPdf = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'),
);

/**
 * Stores the next version of a document for a patient's episode at a centre; returns its id and
 * version. Pass the same `sourceId` again to add the version after it.
 */
export async function testDocument(values: {
  kind: DocumentKind;
  patientId: string;
  episodeId: string;
  centreId: string;
  sourceId: string;
}): Promise<{ id: string; version: number }> {
  const id = crypto.randomUUID();
  const filePath = [values.patientId, `${id}.pdf`].join('/');
  const { error } = await storage().upload(filePath, placeholderPdf, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (error) throw error;
  return withActor(db(), systemActor('tests'), async (tx) => {
    const version = await nextDocumentVersion(tx, values.kind, values.sourceId);
    await insertDocument(tx, {
      id,
      ...values,
      version,
      filePath,
      sizeBytes: placeholderPdf.byteLength,
    });
    return { id, version };
  });
}
