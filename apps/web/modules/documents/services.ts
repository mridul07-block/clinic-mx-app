import 'server-only';
import {
  documentFileOf,
  insertDocument,
  logDocumentView,
  nextDocumentVersion,
  patientDocuments,
  type DbOrTransaction,
  type DocumentEntry,
  type StaffMember,
} from '@clinic-mx/db';
import { can, documentKindAccess, type DocumentKind } from '@clinic-mx/schemas';
import type { DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { asStaff, asStaffViewing } from '../access/staff-db';
import { documentStore, type DocumentStore } from './document-store';
import { renderPdf } from './render';

/**
 * Generated documents (ALT-05, TAD section 9): rendered on the server, stored in the private
 * `documents` bucket, one row per version. Opening one goes through our server only (rule 9):
 * clinical documents for clinicians at any centre, the invoice for those who see bill amounts;
 * anyone else learns nothing, not even that it exists. Row level security checks the same.
 */

/** What a document is built from; `build` makes its PDF for the version it is given. */
export interface DocumentRequest {
  kind: DocumentKind;
  patientId: string;
  episodeId: string | null;
  centreId: string;
  /** The record it is built from (a signed consultation, a paid bill); its versions share it. */
  sourceId: string;
  build: (meta: { version: number; generatedAt: Date }) => ReactElement<DocumentProps>;
}

export interface GeneratedDocument {
  id: string;
  version: number;
}

/**
 * Renders and stores the next version of a document: version 1 the first time, and after an
 * addendum the next one, never overwriting (TAD section 9). Call it inside the system's own
 * transaction (`withActor`), which writes the row; if the row is not written, the file is removed.
 */
export async function generateDocument(
  tx: DbOrTransaction,
  request: DocumentRequest,
  store: DocumentStore = documentStore(),
  render: (element: ReactElement<DocumentProps>) => Promise<Uint8Array> = renderPdf,
): Promise<GeneratedDocument> {
  const version = await nextDocumentVersion(tx, request.kind, request.sourceId);
  const id = crypto.randomUUID();
  const bytes = await render(request.build({ version, generatedAt: new Date() }));
  const filePath = [request.patientId, `${id}.pdf`].join('/');
  await store.put(filePath, bytes);
  try {
    await insertDocument(tx, {
      id,
      kind: request.kind,
      patientId: request.patientId,
      episodeId: request.episodeId,
      centreId: request.centreId,
      sourceId: request.sourceId,
      version,
      filePath,
      sizeBytes: bytes.byteLength,
    });
  } catch (error) {
    await store.remove([filePath]);
    throw error;
  }
  return { id, version };
}

/** Whether a staff member opens any kind of document at all. */
function readsSomeDocument(actor: StaffMember): boolean {
  return Object.values(documentKindAccess).some((action) => can(actor, action));
}

/** A patient's documents the staff member may open, newest first; none for anyone else. */
export async function documentsOfPatient(
  actor: StaffMember,
  patientId: string,
): Promise<DocumentEntry[]> {
  if (!readsSomeDocument(actor)) return [];
  return asStaff(actor, (tx) => patientDocuments(tx, patientId));
}

export interface DocumentFile {
  bytes: Uint8Array;
  kind: DocumentKind;
  version: number;
}

/**
 * A document's PDF for someone who may open it, logged as a view; undefined when it is missing or
 * not theirs. A Velyx support login's transaction is read only (IAM-08); what it opens is logged
 * by the proxy instead.
 */
export async function documentFile(
  actor: StaffMember,
  documentId: string,
  store: DocumentStore = documentStore(),
): Promise<DocumentFile | undefined> {
  if (!readsSomeDocument(actor)) return undefined;
  const found = await asStaffViewing(actor, async (tx) => {
    const file = await documentFileOf(tx, documentId);
    if (file && !actor.support) await logDocumentView(tx, documentId);
    return file;
  });
  if (!found) return undefined;
  return { bytes: await store.get(found.filePath), kind: found.kind, version: found.version };
}
