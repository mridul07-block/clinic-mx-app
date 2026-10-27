import { addDays, type EpisodeStatus } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode, updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import {
  addPhaseMark,
  addPhaseMove,
  episodePhaseRecords,
  latestPhaseVersion,
  regionProgramme,
} from '../phases';
import { appointment, consultation, kbVersion, phaseMove, planOfCare } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// OUT-04 done when: locked phases show unmet criteria in words; the treating physio progresses
// when met; a consultant overrides with a reason. User decisions, 27 October 2026: the treating
// physio marks each exit line Met or Not yet; Phase 0 first; a consultant moves to any phase with a
// reason. The database holds who, when and that every line is Met. Every test runs in a
// transaction that is rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
// A second connection, to see the per episode lock a write holds until it commits.
const other = createDb(url, { max: 1 });
afterAll(async () => {
  await close();
  await other.close();
});

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

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
}

const toActive: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

/** A consultant, the treating physio and another physio at HSR Layout; a knee programme. */
async function setUp(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const other = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const kbVersionId = (await latestPhaseVersion(tx, 'knee')) ?? '';
  const { criteria } = await regionProgramme(tx, kbVersionId, 'knee');
  const [anyVersion] = await tx.select({ id: kbVersion.id }).from(kbVersion).limit(1);
  let visits = 0;
  /** An episode at `status` with a signed plan whose treating physio is `physio` (or no plan). */
  const episodeAt = async (status: EpisodeStatus, { plan = true } = {}) => {
    const patientId = await testPatient(tx);
    const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
    visits += 1;
    const [visit] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        centreId: centreIds.hsrLayout,
        physioId: consultant.id,
        appointmentTypeId: await typeId(tx, 'consultation'),
        episodeId,
        startsAt: on(480 + visits * 60, addDays(testDate, -20)),
        endsAt: on(525 + visits * 60, addDays(testDate, -20)),
        channel: 'front_desk',
        bookedBy: deskHsr.id,
      })
      .returning({ id: appointment.id });
    const [signed] = await tx
      .insert(consultation)
      .values({
        appointmentId: visit?.id ?? '',
        episodeId,
        physioId: consultant.id,
        kbVersionId: anyVersion?.id ?? '',
        status: 'signed',
        signedBy: consultant.id,
        signedAt: new Date(),
      })
      .returning({ id: consultation.id });
    if (plan)
      await tx.insert(planOfCare).values({
        episodeId,
        consultationId: signed?.id ?? '',
        version: 1,
        goals: [],
        homeProgramme: [],
        reviewDate: testDate,
        treatingPhysioId: physio.id,
        createdBy: consultant.id,
      });
    for (let step = 1; step <= toActive.indexOf(status); step++) {
      await updateEpisodeState(tx, episodeId, toActive[step - 1] as EpisodeStatus, {
        status: toActive[step] as EpisodeStatus,
        pausedFrom: null,
      });
    }
    return episodeId;
  };
  const lines = (phase: number) => criteria.filter((c) => c.phase === phase).map((c) => c.key);
  return { consultant, physio, other, kbVersionId, lines, episodeAt };
}

describe('the phase stepper', () => {
  it('lets the treating physio mark the current phase and move on once every line is Met', async () => {
    await rolledBack(async (tx) => {
      const { physio, kbVersionId, lines, episodeAt } = await setUp(tx);
      expect(lines(0)).toHaveLength(3);
      const episodeId = await episodeAt('active');
      const mark = (sp: Tx, criterionKey: string, result: 'met' | 'not_yet' = 'met') =>
        addPhaseMark(sp, { episodeId, kbVersionId, criterionKey, result, by: physio.id });
      const progress = (sp: Tx, fromPhase = 0, toPhase = 1) =>
        addPhaseMove(sp, {
          episodeId,
          kbVersionId,
          region: 'knee',
          fromPhase,
          toPhase,
          kind: 'progress',
          reason: null,
          by: physio.id,
        });

      await becomeStaff(tx, physio);
      const [first = '', second = '', third = ''] = lines(0);
      await mark(tx, first);
      // Until this transaction ends, another writer to the episode's phases waits.
      const lockKey = `phase:episode:${episodeId}`;
      const [held] = await other.db.execute<{ free: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as free`,
      );
      expect(held?.free, 'the episode is locked for other writers').toBe(false);
      await mark(tx, second);
      await mark(tx, third, 'not_yet');
      expect(await failure(tx, (sp) => progress(sp)), 'a line Not yet').toBe('23514');
      expect(await failure(tx, (sp) => mark(sp, lines(1)[0] ?? '')), 'a later phase').toBe('23514');
      await mark(tx, third);
      await progress(tx);
      const records = await episodePhaseRecords(tx, episodeId);
      expect(records.moves.map((m) => [m.fromPhase, m.toPhase, m.kind])).toEqual([
        [0, 1, 'progress'],
      ]);
      expect(records.programme).toEqual({ kbVersionId, region: 'knee' });
      expect(records.marks).toHaveLength(4);
      // Now in Phase 1: its lines are marked, Phase 0's no longer.
      expect(await failure(tx, (sp) => mark(sp, first)), 'an earlier phase').toBe('23514');
      await mark(tx, lines(1)[0] ?? '');
      expect(
        await failure(tx, (sp) => sp.update(phaseMove).set({ toPhase: 4 })),
        'never changed',
      ).toBe('42501');
    });
  });

  it('refuses another physio, the desk, a skip, an untreated episode and a stale move', async () => {
    await rolledBack(async (tx) => {
      const { physio, other, kbVersionId, lines, episodeAt } = await setUp(tx);
      const episodeId = await episodeAt('active');
      const waiting = await episodeAt('plan_proposed');
      const planless = await episodeAt('active', { plan: false });
      const key = lines(0)[0] ?? '';
      const markAs = (sp: Tx, by: StaffMember, episode = episodeId) =>
        addPhaseMark(sp, {
          episodeId: episode,
          kbVersionId,
          criterionKey: key,
          result: 'met',
          by: by.id,
        });
      const move = (sp: Tx, by: StaffMember, fromPhase: number, toPhase: number) =>
        addPhaseMove(sp, {
          episodeId,
          kbVersionId,
          region: 'knee',
          fromPhase,
          toPhase,
          kind: 'progress',
          reason: null,
          by: by.id,
        });

      await becomeStaff(tx, other);
      expect(await failure(tx, (sp) => markAs(sp, other)), 'another physio').toBe('42501');
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      expect(await failure(tx, (sp) => markAs(sp, deskHsr)), 'the desk').toBe('42501');
      await asOwner(tx);
      await becomeStaff(tx, physio);
      expect(await failure(tx, (sp) => markAs(sp, physio, waiting)), 'not Active').toBe('23514');
      expect(await failure(tx, (sp) => markAs(sp, physio, planless)), 'no treating physio').toBe(
        '42501',
      );
      expect(await failure(tx, (sp) => move(sp, physio, 0, 2)), 'a skip').toBe('23514');
      expect(await failure(tx, (sp) => move(sp, physio, 1, 2)), 'a stale move').toBe('23514');
      await markAs(tx, physio);

      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      const read = await episodePhaseRecords(tx, episodeId);
      expect(read.marks, 'the desk reads nothing').toEqual([]);
    });
  });

  it('lets only a consultant with the Treats patients tick override, with a reason', async () => {
    await rolledBack(async (tx) => {
      const { consultant, physio, kbVersionId, episodeAt } = await setUp(tx);
      const episodeId = await episodeAt('active');
      const override = (sp: Tx, by: StaffMember, reason: string | null, toPhase = 3) =>
        sp.insert(phaseMove).values({
          episodeId,
          kbVersionId,
          region: 'knee',
          fromPhase: 0,
          toPhase,
          kind: 'override',
          reason,
          movedBy: by.id,
        });

      await becomeStaff(tx, physio);
      expect(await failure(tx, (sp) => override(sp, physio, 'Settled.')), 'a physio').toBe('42501');
      await asOwner(tx);
      await becomeStaff(tx, consultant);
      expect(await failure(tx, (sp) => override(sp, consultant, ' ')), 'no reason').toBe('23514');
      expect(await failure(tx, (sp) => override(sp, consultant, 'Settled.', 7)), 'no phase 7').toBe(
        '23514',
      );
      await override(tx, consultant, 'Arrived settled after surgery; range already full.');
      const records = await episodePhaseRecords(tx, episodeId);
      expect(records.moves).toEqual([
        expect.objectContaining({
          fromPhase: 0,
          toPhase: 3,
          kind: 'override',
          reason: 'Arrived settled after surgery; range already full.',
          movedByName: consultant.name,
        }),
      ]);
      await asOwner(tx);
      const [row] = await tx
        .select({ by: phaseMove.movedBy })
        .from(phaseMove)
        .where(eq(phaseMove.episodeId, episodeId));
      expect(row?.by, 'stamped by the database').toBe(consultant.id);
    });
  });
});
