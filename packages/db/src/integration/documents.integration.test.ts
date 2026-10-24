import type { DocumentKind } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  documentFileOf,
  insertDocument,
  logDocumentView,
  nextDocumentVersion,
  patientDocuments,
} from '../documents';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { auditEvent, document } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient } from './fake-schedule';

// ALT-05: generated documents. Under row level security, in transactions rolled back: clinical
// documents are read by clinicians at any centre, the invoice by those who see bill amounts at
// its centre; nobody signed in writes one; the file's path is never read from the table; each
// version is kept; opening one is logged. CI only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const physioKoramangala = member('physio.koramangala@clinicmx.test');
const manager = member('manager@clinicmx.test');
const finance = member('finance@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The Postgres error code a statement failed with, inside a savepoint. */
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const asOwner = (tx: Tx) => tx.execute(sql`reset role`);

async function addDocument(
  tx: Tx,
  values: { kind: DocumentKind; patientId: string; episodeId: string; sourceId?: string },
) {
  const id = crypto.randomUUID();
  const sourceId = values.sourceId ?? crypto.randomUUID();
  await insertDocument(tx, {
    id,
    kind: values.kind,
    patientId: values.patientId,
    episodeId: values.episodeId,
    centreId: centreIds.hsrLayout,
    sourceId,
    version: await nextDocumentVersion(tx, values.kind, sourceId),
    filePath: [values.patientId, `${id}.pdf`].join('/'),
    sizeBytes: 2048,
  });
  return { id, sourceId };
}

/** A patient at HSR Layout with a consultation summary and an invoice. */
async function setUp(tx: Tx) {
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  const summary = await addDocument(tx, { kind: 'consultation_summary', patientId, episodeId });
  const invoice = await addDocument(tx, { kind: 'invoice_receipt', patientId, episodeId });
  return { patientId, episodeId, summary, invoice };
}

describe('document row level security', () => {
  it('lets clinicians read clinical documents anywhere and amounts readers the invoice', async () => {
    await rolledBack(async (tx) => {
      const { patientId, summary, invoice } = await setUp(tx);
      const reads = async (actor: StaffMember) => {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        const ids = (await patientDocuments(tx, patientId)).map((d) => d.id);
        return [ids.includes(summary.id), ids.includes(invoice.id)];
      };
      expect(await reads(superAdmin), 'super admin').toEqual([true, true]);
      expect(await reads(physioKoramangala), 'physio at another centre').toEqual([true, false]);
      expect(await reads(deskHsr), 'desk at its centre').toEqual([false, true]);
      expect(await reads(deskKoramangala), 'desk elsewhere').toEqual([false, false]);
      expect(await reads(finance), 'finance').toEqual([false, true]);
      expect(await reads(manager), 'centre manager').toEqual([false, false]);
      expect(await reads(support), 'Velyx support').toEqual([false, true]);
    });
  });

  it('gives the file only to someone who reads the document, never from the table', async () => {
    await rolledBack(async (tx) => {
      const { summary, invoice } = await setUp(tx);
      await becomeStaff(tx, physioKoramangala);
      expect((await documentFileOf(tx, summary.id))?.kind).toBe('consultation_summary');
      expect(await documentFileOf(tx, invoice.id)).toBeUndefined();
      expect(await failure(tx, (sp) => sp.execute(sql`select file_path from document`))).toBe(
        '42501',
      );
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      expect(await documentFileOf(tx, summary.id)).toBeUndefined();
      expect((await documentFileOf(tx, invoice.id))?.version).toBe(1);
    });
  });

  it('lets nobody signed in add, change or delete a document', async () => {
    await rolledBack(async (tx) => {
      const { patientId, episodeId, summary } = await setUp(tx);
      await becomeStaff(tx, superAdmin);
      expect(
        await failure(tx, (sp) =>
          addDocument(sp, { kind: 'consultation_summary', patientId, episodeId }),
        ),
      ).toBe('42501');
      const changed = await tx
        .update(document)
        .set({ version: 9 })
        .where(eq(document.id, summary.id))
        .returning({ id: document.id });
      expect(changed).toEqual([]);
      const deleted = await tx
        .delete(document)
        .where(eq(document.id, summary.id))
        .returning({ id: document.id });
      expect(deleted).toEqual([]);
    });
  });
});

describe('document versions', () => {
  it('numbers each regeneration and never takes a version twice', async () => {
    await rolledBack(async (tx) => {
      const { patientId, episodeId, summary } = await setUp(tx);
      expect(await nextDocumentVersion(tx, 'consultation_summary', summary.sourceId)).toBe(2);
      await addDocument(tx, {
        kind: 'consultation_summary',
        patientId,
        episodeId,
        sourceId: summary.sourceId,
      });
      expect(await nextDocumentVersion(tx, 'consultation_summary', summary.sourceId)).toBe(3);
      // A different kind of document from the same record starts at 1.
      expect(await nextDocumentVersion(tx, 'referral_letter', summary.sourceId)).toBe(1);
      expect(
        await failure(tx, (sp) =>
          insertDocument(sp, {
            id: crypto.randomUUID(),
            kind: 'consultation_summary',
            patientId,
            episodeId,
            centreId: centreIds.hsrLayout,
            sourceId: summary.sourceId,
            version: 2,
            filePath: [patientId, 'again.pdf'].join('/'),
            sizeBytes: 10,
          }),
        ),
      ).toBe('23505');
    });
  });
});

describe('document views', () => {
  it('logs a reader opening a document, and refuses anyone else', async () => {
    await rolledBack(async (tx) => {
      const { summary } = await setUp(tx);
      await becomeStaff(tx, physioKoramangala);
      await logDocumentView(tx, summary.id);
      await asOwner(tx);
      const views = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.action, 'view'),
            eq(auditEvent.entity, 'document'),
            eq(auditEvent.entityId, summary.id),
          ),
        );
      expect(views).toEqual([{ actor: `staff:${physioKoramangala.id}` }]);
      await becomeStaff(tx, deskHsr);
      expect(await failure(tx, (sp) => logDocumentView(sp, summary.id))).toBe('42501');
    });
  });
});
