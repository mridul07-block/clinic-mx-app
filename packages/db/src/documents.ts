import type { DocumentKind } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { document } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Generated documents (ALT-05, TAD section 9). Staff list them under row level security; only the
 * server adds them, as the system, one row per version.
 */

export interface DocumentEntry {
  id: string;
  kind: DocumentKind;
  sourceId: string;
  version: number;
  sizeBytes: number;
  createdAt: Date;
}

/** The version a new document of this record gets: one after its latest, or 1. */
export async function nextDocumentVersion(
  db: DbOrTransaction,
  kind: DocumentKind,
  sourceId: string,
): Promise<number> {
  const [row] = await db
    .select({ latest: sql<number | null>`max(${document.version})` })
    .from(document)
    .where(and(eq(document.kind, kind), eq(document.sourceId, sourceId)));
  return (row?.latest ?? 0) + 1;
}

export interface NewDocument {
  id: string;
  kind: DocumentKind;
  patientId: string;
  episodeId: string | null;
  centreId: string;
  sourceId: string;
  version: number;
  filePath: string;
  sizeBytes: number;
}

/**
 * Records a stored PDF. Two generations of the same record at once cannot both take a version:
 * the second fails on `document_version_key` and its file is removed by the caller.
 */
export async function insertDocument(db: DbOrTransaction, values: NewDocument): Promise<void> {
  await db.insert(document).values(values);
}

/** A patient's documents the reader may open, newest first. */
export function patientDocuments(db: DbOrTransaction, patientId: string): Promise<DocumentEntry[]> {
  return db
    .select({
      id: document.id,
      kind: document.kind,
      sourceId: document.sourceId,
      version: document.version,
      sizeBytes: document.sizeBytes,
      createdAt: document.createdAt,
    })
    .from(document)
    .where(eq(document.patientId, patientId))
    .orderBy(desc(document.createdAt), desc(document.version));
}

/**
 * Where a document's file is, for someone who reads it: staff never read the path from the table;
 * `internal.document_file` gives it only to those who may open the document.
 */
export async function documentFileOf(
  db: DbOrTransaction,
  documentId: string,
): Promise<{ filePath: string; kind: DocumentKind; version: number } | undefined> {
  const [row] = await db.execute<{ file_path: string; kind: DocumentKind; version: number }>(
    sql`select file_path, kind, version from internal.document_file(${documentId}::uuid)`,
  );
  return row ? { filePath: row.file_path, kind: row.kind, version: row.version } : undefined;
}

/** Logs a staff member opening a document, as the transaction's own staff member. */
export async function logDocumentView(db: DbOrTransaction, documentId: string): Promise<void> {
  await db.execute(sql`select internal.document_view(${documentId}::uuid)`);
}
