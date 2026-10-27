import { istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { previousEpisodes, setEpisodeLink } from '../episodes';
import type { StaffMember } from '../identity';
import { auditEvent, episode } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, claimsOf, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPatient, testPhysio } from './fake-schedule';

// SCH-14: a recurrence links an episode to the same patient's discharged one (PRD J7.5), set by a
// consultant with the Treats patients tick while the episode is open; anything else is refused by
// the database. Everything rolled back. CI database only.
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
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

const hsr = centreIds.hsrLayout;
const treated = ['awaiting_consultation', 'plan_proposed', 'active'] as const;

/** A patient with a discharged episode (goals achieved) and a new one awaiting consultation. */
async function returning(tx: Tx, consultant: StaffMember) {
  const patientId = await testPatient(tx);
  const earlier = await episodeThrough(tx, hsr, [...treated], patientId);
  await claimsOf(tx, consultant);
  await tx
    .update(episode)
    .set({ status: 'discharged', dischargeReason: 'goals_achieved', closedAt: new Date() })
    .where(eq(episode.id, earlier.id));
  await asSystem(tx);
  const current = await episodeThrough(tx, hsr, ['awaiting_consultation'], patientId);
  return { patientId, earlier: earlier.id, current: current.id };
}

describe('recurrences', () => {
  it('refuses a consultant elsewhere, unless the consultation in the episode is their own', async () => {
    await rolledBack(async (tx) => {
      const kb = await knowledgeVersion(tx);
      const local = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const elsewhere = await testPhysio(tx, {
        centreIds: [centreIds.whitefield],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const { patientId, earlier, current } = await returning(tx, local);
      const tryAs = (who: StaffMember) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, who);
          await setEpisodeLink(sp, current, earlier);
        });
      expect(await tryAs(elsewhere)).toBe('42501');
      // Their own consultation in the episode (a consultant seeing a patient at another centre).
      const seen = await visit(tx, {
        centreId: hsr,
        physio: elsewhere,
        type: 'consultation',
        day: istDate(new Date()),
        status: 'in_progress',
        episodeId: current,
        patientId,
      });
      await note(tx, {
        appointmentId: seen.id,
        episodeId: current,
        physio: elsewhere,
        kbVersionId: kb,
      });
      expect(await tryAs(elsewhere)).toBeUndefined();
    });
  });

  it('lets a consultant link the open episode to the discharged one, audited, and unlink it', async () => {
    await rolledBack(async (tx) => {
      const consultant = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const { patientId, earlier, current } = await returning(tx, consultant);
      // The earlier episode is offered as a previous one; the current one is not.
      await becomeStaff(tx, consultant);
      const offered = await previousEpisodes(tx, patientId, current);
      expect(offered.map((row) => row.id)).toEqual([earlier]);
      expect(await setEpisodeLink(tx, current, earlier)).toBe(true);
      await asSystem(tx);
      const [linked] = await tx
        .select({ linkedEpisodeId: episode.linkedEpisodeId })
        .from(episode)
        .where(eq(episode.id, current));
      expect(linked?.linkedEpisodeId).toBe(earlier);
      const audited = await tx
        .select({ after: auditEvent.after })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'episode'), eq(auditEvent.entityId, current)));
      expect(
        audited.some(
          (row) =>
            (row.after as { linked_episode_id?: string } | null)?.linked_episode_id === earlier,
        ),
      ).toBe(true);
      await becomeStaff(tx, consultant);
      expect(await setEpisodeLink(tx, current, null)).toBe(true);
    });
  });

  it('refuses another patient’s episode, one not discharged, itself, and anyone but a consultant', async () => {
    await rolledBack(async (tx) => {
      const consultant = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const mine = await returning(tx, consultant);
      const theirs = await returning(tx, consultant);
      const asConsultant = (target: string, link: string) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, consultant);
          await setEpisodeLink(sp, target, link);
        });
      // Another patient's discharged episode.
      expect(await asConsultant(mine.current, theirs.earlier)).toBe('23514');
      // An episode not discharged, and the episode itself.
      expect(await asConsultant(mine.current, theirs.current)).toBe('23514');
      expect(await asConsultant(mine.current, mine.current)).toBe('23514');
      // A physio without the Consultant tick, and the desk.
      for (const someone of [physio, deskHsr]) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, someone);
            await setEpisodeLink(sp, mine.current, mine.earlier);
          }),
        ).toBe('42501');
      }
      // A discharged episode never changes, its link included.
      expect(await asConsultant(mine.earlier, theirs.earlier)).toBe('23514');
      // Opening one already linked to another patient's episode is refused too.
      expect(
        await failure(tx, (sp) =>
          sp
            .insert(episode)
            .values({ patientId: mine.patientId, centreId: hsr, linkedEpisodeId: theirs.earlier }),
        ),
      ).toBe('23514');
      const [count] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from episode where id = ${mine.current} and linked_episode_id is not null`,
      );
      expect(count?.n).toBe(0);
    });
  });
});
