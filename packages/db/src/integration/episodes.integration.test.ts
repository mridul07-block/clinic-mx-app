import { allowedStatusPairs, episodeStatuses, type EpisodeStatus } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withStaffAccess } from '../access';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { episodeRecord, episodesOf, insertEpisode, updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import { auditEvent, episode } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { fakePatientId } from './fake-patients';

// SCH-03: episodes in the database. The trigger allows exactly the status machine's pairs and
// keeps a discharged episode closed; the checks hold; every signed in staff member reads, the
// three booking roles open, any staff member moves; nobody deletes; every change is audited.
// Most tests run in a transaction that is rolled back; episodes a test commits are generated.
// CI database only.
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
const manager = member('manager@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const physio = member('physio.koramangala@clinicmx.test');
const finance = member('finance@clinicmx.test');
const support = member('support.velyx@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(actor: StaffMember, work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withStaffAccess(db, { actor }, async (tx) => {
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

const paused = (status: EpisodeStatus) => status === 'on_hold' || status === 'lost_to_follow_up';

/** Puts an episode straight into `status` (the guard off for this transaction only). */
async function forceStatus(
  tx: Tx,
  id: string,
  status: EpisodeStatus,
  pausedFrom: EpisodeStatus | null,
) {
  await tx.execute(sql`alter table public.episode disable trigger episode_transition_guard`);
  await tx
    .update(episode)
    .set({
      status,
      pausedFrom,
      ...(status === 'discharged'
        ? { closedAt: new Date(), dischargeReason: 'patient_choice' as const }
        : {}),
    })
    .where(eq(episode.id, id));
  await tx.execute(sql`alter table public.episode enable trigger episode_transition_guard`);
}

describe('episodes', () => {
  it('allow exactly the status machine’s pairs, and nothing after discharge', async () => {
    const patientId = await fakePatientId(db);
    const allowed = new Set(allowedStatusPairs().map(([from, to]) => `${from}>${to}`));
    const seen = new Set<string>();
    try {
      await withActor(db, systemActor('tests'), async (tx) => {
        const id = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
        for (const from of episodeStatuses) {
          for (const to of episodeStatuses) {
            if (from === to) continue;
            const code = await failure(tx, async (sp) => {
              // Paused episodes go back to where they paused: pause them from the target.
              const pausedFrom = paused(from)
                ? paused(to) || to === 'discharged'
                  ? 'active'
                  : to
                : null;
              await forceStatus(sp, id, from, pausedFrom);
              await sp
                .update(episode)
                .set({
                  status: to,
                  pausedFrom: paused(to) ? (pausedFrom ?? from) : null,
                  closedAt: to === 'discharged' ? new Date() : null,
                  dischargeReason: to === 'discharged' ? 'patient_choice' : null,
                })
                .where(eq(episode.id, id));
              throw new Rollback();
            });
            if (code === undefined) seen.add(`${from}>${to}`);
            else expect(code, `${from}>${to}`).toBe('23514');
          }
        }
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect([...seen].sort()).toEqual([...allowed].sort());
  });

  it('keep the checks: a reason to close, a note for Other, a paused status only when paused', async () => {
    const patientId = await fakePatientId(db);
    await rolledBack(superAdmin, async (tx) => {
      const id = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
      expect(
        await failure(tx, (sp) =>
          sp
            .update(episode)
            .set({ status: 'discharged', closedAt: new Date() })
            .where(eq(episode.id, id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(episode)
            .set({ status: 'discharged', closedAt: new Date(), dischargeReason: 'other' })
            .where(eq(episode.id, id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp.update(episode).set({ status: 'on_hold' }).where(eq(episode.id, id)),
        ),
      ).toBe('23514');
      // A recovered discharge needs treatment, in the database too.
      expect(
        await failure(tx, (sp) =>
          sp
            .update(episode)
            .set({ status: 'discharged', closedAt: new Date(), dischargeReason: 'goals_achieved' })
            .where(eq(episode.id, id)),
        ),
      ).toBe('23514');
      // A new episode starts as Intake pending.
      expect(
        await failure(tx, (sp) =>
          sp.insert(episode).values({ patientId, centreId: centreIds.hsrLayout, status: 'active' }),
        ),
      ).toBe('23514');
    });
  });

  it('change only from the status read, so two changes at once cannot both win', async () => {
    const patientId = await fakePatientId(db);
    await rolledBack(deskHsr, async (tx) => {
      const id = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
      const next = { status: 'awaiting_consultation' as const, pausedFrom: null };
      expect(await updateEpisodeState(tx, id, 'intake_pending', next)).toBe(true);
      expect(await updateEpisodeState(tx, id, 'intake_pending', next)).toBe(false);
      expect((await episodeRecord(tx, id))?.status).toBe('awaiting_consultation');
    });
  });

  it('are read by every role, opened by the booking roles, moved by any staff member', async () => {
    const patientId = await fakePatientId(db);
    const id = await withActor(db, systemActor('tests'), (tx) =>
      insertEpisode(tx, { patientId, centreId: centreIds.koramangala, bodyRegion: 'knee' }),
    );
    for (const reader of [superAdmin, manager, deskHsr, physio, finance, support]) {
      await rolledBack(reader, async (tx) => {
        const [found] = await episodesOf(tx, patientId);
        expect(found?.id, reader.email).toBe(id);
      });
    }
    await rolledBack(deskHsr, async (tx) => {
      expect(
        await failure(tx, (sp) =>
          insertEpisode(sp, { patientId, centreId: centreIds.koramangala }),
        ),
      ).toBe('42501');
    });
    for (const writer of [physio, finance]) {
      await rolledBack(writer, async (tx) => {
        expect(
          await failure(tx, (sp) =>
            insertEpisode(sp, { patientId, centreId: centreIds.koramangala }),
          ),
          writer.email,
        ).toBe('42501');
        expect(
          await updateEpisodeState(tx, id, 'intake_pending', {
            status: 'awaiting_consultation',
            pausedFrom: null,
          }),
          writer.email,
        ).toBe(true);
        const deleted = await tx
          .delete(episode)
          .where(eq(episode.id, id))
          .returning({ id: episode.id });
        expect(deleted, writer.email).toEqual([]);
      });
    }
    await rolledBack(support, async (tx) => {
      expect(
        await failure(tx, (sp) => insertEpisode(sp, { patientId, centreId: centreIds.hsrLayout })),
      ).toBeDefined();
    });
  });

  it('keep their history in the audit trail', async () => {
    const patientId = await fakePatientId(db);
    const id = await withStaffAccess(db, { actor: manager }, async (tx) => {
      const opened = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
      await updateEpisodeState(tx, opened, 'intake_pending', {
        status: 'on_hold',
        pausedFrom: 'intake_pending',
      });
      return opened;
    });
    const events = await db
      .select({ action: auditEvent.action, after: auditEvent.after })
      .from(auditEvent)
      .where(and(eq(auditEvent.entity, 'episode'), eq(auditEvent.entityId, id)))
      .orderBy(auditEvent.id);
    expect(events.map((e) => [e.action, (e.after as { status: string }).status])).toEqual([
      ['insert', 'intake_pending'],
      ['update', 'on_hold'],
    ]);
  });
});
