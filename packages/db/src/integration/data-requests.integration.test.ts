import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  closeDataRequest,
  dataRequestList,
  dataRequestRecord,
  insertDataRequest,
  patientExport,
} from '../data-requests';
import type { StaffMember } from '../identity';
import { insertPatient } from '../patients';
import { dataRequest, episode } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { fakePatientDetails } from './fake-patients';
import { becomeStaff } from './fake-schedule';

// ADM-03 done when: the Super Admin records a patient's export or deletion request with its due
// date and exports their data; nobody else reads or writes one; a closed request never changes;
// the export only for an open export request, audited. Generated data only. Rolled back. CI
// database only.
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
const others = [
  member('manager@clinicmx.test'),
  member('finance@clinicmx.test'),
  member('desk.hsr@clinicmx.test'),
  member('physio.hsr@clinicmx.test'),
  member('support.velyx@clinicmx.test'),
];

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

async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

/** A patient with an episode, as the owner. */
async function setUp(tx: Tx) {
  const patient = await insertPatient(tx, fakePatientDetails(centreIds.hsrLayout));
  const [row] = await tx
    .insert(episode)
    .values({ patientId: patient.id, centreId: centreIds.hsrLayout })
    .returning({ id: episode.id });
  return { patientId: patient.id, episodeId: row?.id ?? '' };
}

const request = (patientId: string, kind: 'export' | 'deletion' = 'export') => ({
  patientId,
  kind,
  receivedOn: '2026-10-29',
  dueOn: '2026-11-28',
  details: 'Test request for a copy of their data',
  recordedBy: superAdmin.id,
});

describe('data requests', () => {
  it('are recorded and closed once by the Super Admin, and kept', async () => {
    await rolledBack(async (tx) => {
      const { patientId } = await setUp(tx);
      await becomeStaff(tx, superAdmin);
      const id = await insertDataRequest(tx, request(patientId));
      expect(await dataRequestRecord(tx, id)).toMatchObject({
        status: 'open',
        recordedByName: superAdmin.name,
        dueOn: '2026-11-28',
      });
      expect((await dataRequestList(tx)).map((entry) => entry.id)).toContain(id);
      // Open: it is only closed, not edited.
      expect(
        await failure(tx, (sp) =>
          sp
            .update(dataRequest)
            .set({ details: 'Changed' })
            .where(sql`id = ${id}`),
        ),
      ).toBe('23514');
      expect(
        await closeDataRequest(tx, {
          requestId: id,
          status: 'done',
          outcome: 'Sent by email',
          closedBy: superAdmin.id,
        }),
      ).toBe(true);
      expect(await dataRequestRecord(tx, id)).toMatchObject({
        status: 'done',
        outcome: 'Sent by email',
        closedByName: superAdmin.name,
      });
      // Closed: never again.
      expect(
        await closeDataRequest(tx, {
          requestId: id,
          status: 'declined',
          outcome: 'x',
          closedBy: superAdmin.id,
        }),
      ).toBe(false);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(dataRequest)
            .set({ outcome: 'Changed' })
            .where(sql`id = ${id}`),
        ),
      ).toBe('23514');
      await asOwner(tx);
      expect(await failure(tx, (sp) => sp.delete(dataRequest).where(sql`id = ${id}`))).toBe(
        '23514',
      );
    });
  });

  it('are read and written by nobody else', async () => {
    await rolledBack(async (tx) => {
      const { patientId } = await setUp(tx);
      await becomeStaff(tx, superAdmin);
      const id = await insertDataRequest(tx, request(patientId));
      await asOwner(tx);
      for (const who of others) {
        await becomeStaff(tx, who);
        expect(await dataRequestList(tx), who.email).toEqual([]);
        expect(
          await failure(tx, (sp) =>
            insertDataRequest(sp, { ...request(patientId), recordedBy: who.id }),
          ),
          who.email,
        ).toBe('42501');
        expect(await failure(tx, (sp) => patientExport(sp, id)), who.email).toBe('42501');
        await asOwner(tx);
      }
    });
  });

  it('export a patient’s data only for their open export request, audited on it', async () => {
    await rolledBack(async (tx) => {
      const { patientId, episodeId } = await setUp(tx);
      // The AI sheet was shown another patient's confirmed case (AI-05): never in this copy.
      const [version] = await tx.execute<{ id: string }>(sql`select id from kb_version limit 1`);
      await tx.execute(sql`
        insert into ai_preparation_sheet (episode_id, kb_version_id, status, unavailable_reason, ready_at, shortlist,
          "similar")
        values (${episodeId}, ${version?.id ?? ''}, 'unavailable', 'not_configured', now(),
          '[]'::jsonb,
          '[{"age": 41, "sex": "female", "confirmed": "Test Other Patient Diagnosis"}]'::jsonb)`);
      await becomeStaff(tx, superAdmin);
      // A deletion request opens no export.
      const deletion = await insertDataRequest(tx, request(patientId, 'deletion'));
      expect(await failure(tx, (sp) => patientExport(sp, deletion))).toBe('23514');

      const id = await insertDataRequest(tx, request(patientId));
      const exported = await patientExport(tx, id);
      expect(exported).toMatchObject({ patient: { id: patientId } });
      const records = exported.records as Record<string, Record<string, unknown>[]>;
      expect(records.episode?.map((row) => row.id)).toEqual([episodeId]);
      expect(records.data_request?.map((row) => row.id).sort()).toEqual([deletion, id].sort());
      expect(records.ai_preparation_sheet).toHaveLength(1);
      expect(records.ai_preparation_sheet?.[0]).not.toHaveProperty('similar');
      expect(JSON.stringify(exported)).not.toContain('Test Other Patient Diagnosis');
      expect(records).not.toHaveProperty('audit_event');
      expect(records).not.toHaveProperty('task');

      await asOwner(tx);
      const [audited] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from audit_event
          where action = 'export' and entity = 'data_request' and entity_id = ${id}
            and actor = ${`staff:${superAdmin.id}`} and category = 'admin'`,
      );
      expect(audited?.n).toBe(1);

      // Once the request is closed, no more exports.
      await becomeStaff(tx, superAdmin);
      await closeDataRequest(tx, {
        requestId: id,
        status: 'done',
        outcome: 'Sent',
        closedBy: superAdmin.id,
      });
      expect(await failure(tx, (sp) => patientExport(sp, id))).toBe('23514');
    });
  });

  it('keep who recorded and closed them, their id, and every request', async () => {
    await rolledBack(async (tx) => {
      const { patientId } = await setUp(tx);
      const someone = others[0]?.id ?? '';
      await becomeStaff(tx, superAdmin);
      const id = await insertDataRequest(tx, { ...request(patientId), recordedBy: someone });
      await asOwner(tx);
      const [row] = await tx.execute<{ recorded_by: string; outcome: string | null }>(
        sql`select recorded_by, outcome from data_request where id = ${id}`,
      );
      expect(row?.recorded_by).toBe(superAdmin.id);
      await becomeStaff(tx, superAdmin);
      // Closing while changing anything else, its id included, is refused.
      expect(
        await failure(tx, (sp) =>
          sp.execute(sql`update data_request set status = 'done', outcome = 'x',
            id = gen_random_uuid() where id = ${id}`),
        ),
      ).toBe('23514');
      await closeDataRequest(tx, {
        requestId: id,
        status: 'done',
        outcome: 'x',
        closedBy: someone,
      });
      const closed = await dataRequestRecord(tx, id);
      expect(closed?.closedByName).toBe(superAdmin.name);
      await asOwner(tx);
      expect(await failure(tx, (sp) => sp.execute(sql`truncate data_request`))).toBe('23514');
    });
  });

  it('copy only tables reviewed for a patient’s copy, or left out on purpose', async () => {
    // A new table that points at a patient fails here until it is reviewed: added to
    // internal.patient_export_tables (with any columns to hide) or to the list left out.
    // whatsapp_flow_session (WA-04): an open WhatsApp form's number and choices, deleted within
    // days; the appointment it booked is in the copy.
    const leftOut = ['notification', 'task', 'whatsapp_flow_session'];
    const linked = await db.execute<{ name: string }>(sql`
      select distinct c.table_name as name from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.column_name in ('patient_id', 'episode_id', 'appointment_id', 'consultation_id',
          'session_id', 'plan_of_care_id', 'bill_id', 'sheet_id', 'patient_link_id')`);
    const reviewed = await db.execute<{ name: string }>(
      sql`select name from internal.patient_export_tables()`,
    );
    expect(linked.map((row) => row.name).sort()).toEqual(
      [...reviewed.map((row) => row.name), ...leftOut].sort(),
    );
  });
});
