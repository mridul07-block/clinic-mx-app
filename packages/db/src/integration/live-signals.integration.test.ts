import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import { insertLeave } from '../rosters';
import type { StaffMember } from '../identity';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { bookAppointment } from '../slots';
import { becomeStaff, on, testPatient, testPhysio, typeId } from './fake-schedule';

// FND-09 done when: updates under 2 s. A change to what the live screens show tells the realtime
// relay which centres changed (never what changed), once the relay's URL and secret are in Vault;
// until then nothing is sent. Every test runs in a transaction that is rolled back, the Vault rows
// with it. Generated people only. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

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

const relayUrl = 'https://relay.example.test/signal';
const relaySecret = 's'.repeat(40);

async function relayOn(tx: Tx): Promise<void> {
  await tx.execute(sql`select vault.create_secret(${relayUrl}, 'live_relay_signal_url')`);
  await tx.execute(sql`select vault.create_secret(${relaySecret}, 'live_relay_signal_secret')`);
}

interface Signal extends Record<string, unknown> {
  body: { centres: string[]; all: boolean };
  authorization: string;
}

async function signals(tx: Tx): Promise<Signal[]> {
  return [
    ...(await tx.execute<Signal>(sql`
      select convert_from(body, 'utf8')::jsonb as body, headers ->> 'Authorization' as authorization
      from net.http_request_queue where url = ${relayUrl} order by id`)),
  ];
}

const sorted = (centres: string[]) => [...centres].sort();
const createdBy = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';

async function booking(tx: Tx, centreId: string) {
  const physio = await testPhysio(tx, { centreIds: [centreId], createdBy });
  return bookAppointment(tx, {
    physioId: physio.id,
    appointmentTypeId: await typeId(tx, 'session'),
    patientId: await testPatient(tx),
    channel: 'whatsapp',
    centreId,
    startsAt: on(540),
    holder: 'test:live',
    step: 15,
    now: new Date(),
  });
}

describe('live signals', () => {
  it('send nothing until the relay is set up', async () => {
    await rolledBack(async (tx) => {
      await booking(tx, centreIds.hsrLayout);
      expect(await signals(tx)).toEqual([]);
      const [sent] = await tx.execute<{ id: string | null }>(
        sql`select internal.live_signal(array[${centreIds.hsrLayout}::uuid], false) as id`,
      );
      expect(sent?.id).toBeNull();
    });
  });

  it('name the centre of a booking, with the relay’s secret, and nothing about the patient', async () => {
    await rolledBack(async (tx) => {
      await relayOn(tx);
      await booking(tx, centreIds.hsrLayout);
      const sent = await signals(tx);
      expect(sent.length).toBeGreaterThan(0);
      for (const signal of sent) {
        expect(signal.authorization).toBe(['Bearer', relaySecret].join(' '));
        expect(Object.keys(signal.body).sort()).toEqual(['all', 'centres']);
      }
      expect(sent.map((signal) => signal.body)).toContainEqual({
        centres: [centreIds.hsrLayout],
        all: false,
      });
      expect(sent.every((signal) => !signal.body.all)).toBe(true);
      expect(
        sent.flatMap((signal) => signal.body.centres).every((id) => id === centreIds.hsrLayout),
      ).toBe(true);
    });
  });

  it('send nothing for a change rolled back, or a statement that changed no row', async () => {
    await rolledBack(async (tx) => {
      await relayOn(tx);
      await tx
        .transaction(async (sp) => {
          await booking(sp, centreIds.koramangala);
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
      await tx.execute(sql`update public.appointment set status = status where false`);
      expect(await signals(tx)).toEqual([]);
    });
  });

  it('signal every centre for a physio’s leave, which belongs to none', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, { centreIds: [centreIds.whitefield], createdBy });
      await relayOn(tx);
      await insertLeave(tx, {
        staffUserId: physio.id,
        startsAt: on(600),
        endsAt: on(660),
        allDay: false,
        note: null,
        status: 'approved',
        requestedBy: createdBy,
      });
      expect((await signals(tx)).map((signal) => signal.body)).toContainEqual({
        centres: [],
        all: true,
      });
    });
  });

  it('reach the centre before and after a move, through an episode, or an appointment else the episode', async () => {
    await rolledBack(async (tx) => {
      const visit = await booking(tx, centreIds.hsrLayout);
      const episodeId = await insertEpisode(tx, {
        patientId: await testPatient(tx),
        centreId: centreIds.koramangala,
      });
      await tx.execute(sql`create temp table live_own (centre_id uuid) on commit drop`);
      await tx.execute(sql`create temp table live_ep (episode_id uuid) on commit drop`);
      await tx.execute(
        sql`create temp table live_link (appointment_id uuid, episode_id uuid) on commit drop`,
      );
      await tx.execute(sql`call internal.add_live_signal_triggers('pg_temp.live_own', 'centre')`);
      await tx.execute(sql`call internal.add_live_signal_triggers('pg_temp.live_ep', 'episode')`);
      await tx.execute(sql`call internal.add_live_signal_triggers('pg_temp.live_link', 'link')`);
      await relayOn(tx);

      await tx.execute(sql`insert into live_own values (${centreIds.hsrLayout})`);
      await tx.execute(sql`update live_own set centre_id = ${centreIds.whitefield}`);
      await tx.execute(sql`insert into live_ep values (${episodeId})`);
      await tx.execute(sql`insert into live_link values (${visit.id}, ${episodeId})`);
      await tx.execute(sql`delete from live_link`);
      await tx.execute(sql`insert into live_link values (null, ${episodeId})`);
      const sent = (await signals(tx)).map((signal) => signal.body.centres);
      expect(sent).toEqual([
        [centreIds.hsrLayout],
        sorted([centreIds.hsrLayout, centreIds.whitefield]),
        [centreIds.koramangala],
        [centreIds.hsrLayout],
        [centreIds.hsrLayout],
        [centreIds.koramangala],
      ]);
    });
  });

  it('never fail the change: a signal that cannot be made is only a warning', async () => {
    await rolledBack(async (tx) => {
      await tx.execute(sql`create temp table live_bad (centre_id uuid) on commit drop`);
      await tx.execute(sql`call internal.add_live_signal_triggers('pg_temp.live_bad', 'nonsense')`);
      await relayOn(tx);
      await tx.execute(sql`insert into live_bad values (${centreIds.hsrLayout})`);
      const [kept] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from live_bad`);
      expect(kept?.n).toBe(1);
      expect(await signals(tx)).toEqual([]);
    });
  });

  it('find the centre of a change made by staff, even one they cannot see', async () => {
    const desk = seedStaff.find((s) => s.email === 'desk.hsr@clinicmx.test');
    if (!desk?.id) throw new Error('seed has no desk.hsr');
    const deskHsr: StaffMember = {
      id: desk.id,
      email: desk.email,
      name: desk.name,
      role: desk.role,
      treatsPatients: false,
      consultant: false,
      centreIds: seedStaffCentres.filter((c) => c.staffUserId === desk.id).map((c) => c.centreId),
      support: false,
    };
    await rolledBack(async (tx) => {
      const episodeId = await insertEpisode(tx, {
        patientId: await testPatient(tx),
        centreId: centreIds.whitefield,
      });
      await tx.execute(sql`create temp table live_staff (episode_id uuid) on commit drop`);
      await tx.execute(sql`grant insert on live_staff to authenticated`);
      await tx.execute(
        sql`call internal.add_live_signal_triggers('pg_temp.live_staff', 'episode')`,
      );
      await relayOn(tx);
      await becomeStaff(tx, deskHsr);
      await tx.execute(sql`insert into live_staff values (${episodeId})`);
      await tx.execute(sql`reset role`);
      expect((await signals(tx)).map((signal) => signal.body.centres)).toEqual([
        [centreIds.whitefield],
      ]);
    });
  });

  it('are on every table the live screens show, for insert, update and delete', async () => {
    const rows = await db.execute<{ table: string; events: string }>(sql`
      select c.relname as table, string_agg(t.tgname, ',' order by t.tgname) as events
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and t.tgname like 'live_signal_%'
      group by c.relname order by c.relname`);
    expect([...rows]).toEqual(
      [
        'ai_preparation_sheet',
        'appointment',
        'bill',
        'consent_record',
        'consultation',
        'opening_entry',
        'patient_link',
        'plan_choice',
        'plan_of_care',
        'red_flag_alert',
        'roster',
        'session',
        'slot_hold',
        'staff_leave',
      ].map((table) => ({
        table,
        events: 'live_signal_delete,live_signal_insert,live_signal_update',
      })),
    );
  });
});
