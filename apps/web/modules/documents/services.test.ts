import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentStore } from './document-store';
import {
  documentFile,
  documentsOfPatient,
  generateDocument,
  type DocumentRequest,
} from './services';

const db = vi.hoisted(() => ({
  nextDocumentVersion: vi.fn(),
  insertDocument: vi.fn(),
  patientDocuments: vi.fn(),
  documentFileOf: vi.fn(),
  logDocumentView: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const fakeTx = { kind: 'transaction' };
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
  asStaffViewing: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));

const store = { put: vi.fn(), remove: vi.fn(), get: vi.fn() } satisfies DocumentStore;
const pdf = new Uint8Array([37, 80, 68, 70]);
const render = vi.fn(() => Promise.resolve(pdf));
const patientId = '00000000-0000-4000-8000-000000000001';

const request: DocumentRequest = {
  kind: 'consultation_summary',
  patientId,
  episodeId: '00000000-0000-4000-8000-000000000002',
  centreId: '00000000-0000-4000-8000-000000000003',
  sourceId: '00000000-0000-4000-8000-000000000004',
  build: vi.fn(() => ({}) as never),
};

function staff(overrides: Partial<StaffMember>): StaffMember {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'test.person@clinicmx.test',
    name: 'Test Person',
    role: 'physiotherapist',
    treatsPatients: true,
    consultant: false,
    centreIds: [],
    support: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateDocument', () => {
  it('stores the next version with that version in its footer, and records it', async () => {
    db.nextDocumentVersion.mockResolvedValue(2);
    const result = await generateDocument(fakeTx as never, request, store, render);
    expect(result.version).toBe(2);
    expect(request.build).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    const path = `${patientId}/${result.id}.pdf`;
    expect(store.put).toHaveBeenCalledWith(path, pdf);
    expect(db.insertDocument).toHaveBeenCalledWith(fakeTx, {
      id: result.id,
      kind: 'consultation_summary',
      patientId,
      episodeId: request.episodeId,
      centreId: request.centreId,
      sourceId: request.sourceId,
      version: 2,
      filePath: path,
      sizeBytes: 4,
    });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('removes the stored file when the row is not written', async () => {
    db.nextDocumentVersion.mockResolvedValue(1);
    db.insertDocument.mockRejectedValue(new Error('duplicate key value'));
    await expect(generateDocument(fakeTx as never, request, store, render)).rejects.toThrow(
      'duplicate key value',
    );
    const [[path]] = store.put.mock.calls as [[string, Uint8Array]];
    expect(store.remove).toHaveBeenCalledWith([path]);
  });
});

describe('opening documents', () => {
  it('lists nothing for someone who opens no kind of document', async () => {
    const manager = staff({ role: 'centre_manager', treatsPatients: false });
    expect(await documentsOfPatient(manager, patientId)).toEqual([]);
    expect(await documentFile(manager, request.sourceId, store)).toBeUndefined();
    expect(db.patientDocuments).not.toHaveBeenCalled();
    expect(db.documentFileOf).not.toHaveBeenCalled();
  });

  it('gives a reader the file and logs the view', async () => {
    db.documentFileOf.mockResolvedValue({
      filePath: 'p/d.pdf',
      kind: 'consultation_summary',
      version: 3,
    });
    store.get.mockResolvedValue(pdf);
    const file = await documentFile(staff({}), 'doc-id', store);
    expect(file).toEqual({ bytes: pdf, kind: 'consultation_summary', version: 3 });
    expect(db.logDocumentView).toHaveBeenCalledWith(fakeTx, 'doc-id');
  });

  it('logs nothing and reads no file when the document is not theirs', async () => {
    db.documentFileOf.mockResolvedValue(undefined);
    expect(
      await documentFile(staff({ role: 'front_desk', treatsPatients: false }), 'doc-id', store),
    ).toBeUndefined();
    expect(db.logDocumentView).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
  });

  it('leaves a Velyx support login view to the proxy log (its transaction is read only)', async () => {
    db.documentFileOf.mockResolvedValue({
      filePath: 'p/d.pdf',
      kind: 'invoice_receipt',
      version: 1,
    });
    store.get.mockResolvedValue(pdf);
    const support = staff({ role: 'super_admin', treatsPatients: false, support: true });
    expect((await documentFile(support, 'doc-id', store))?.kind).toBe('invoice_receipt');
    expect(db.logDocumentView).not.toHaveBeenCalled();
  });
});
