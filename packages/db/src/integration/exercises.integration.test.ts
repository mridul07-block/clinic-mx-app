import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  activeExercises,
  exerciseRecord,
  insertExercise,
  myPlanExerciseVideo,
  retireExercise,
} from '../exercises';
import type { StaffMember } from '../identity';
import { insertPatientLink } from '../patient-links';
import { exercise, planOfCare } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { signedPlan } from './fake-plan';
import { becomeStaff, testPhysio } from './fake-schedule';

// SET-07 done when: exercises with dose defaults and video playable on phones. The database's
// side: the Super Admin adds and retires library exercises, which never change otherwise; staff
// read them; a patient reaches a video only for an exercise in their own plan, through their My
// plan link. Generated data only. Rolled back. CI database only.
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
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

async function as(tx: Tx, actor: StaffMember) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  await becomeStaff(tx, actor);
}

const video = (name: string) => ({
  path: `tests/${name}.mp4`,
  type: 'video/mp4' as const,
  bytes: 1_000,
});

describe('the exercise library', () => {
  it('is kept by the Super Admin, read by staff, and never changed but to be retired', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const add = (by: StaffMember, name: string) =>
        failure(tx, (sp) =>
          insertExercise(sp, { name, defaultDose: '3 × 10', by: by.id, video: video(name) }),
        );
      await as(tx, physio);
      expect(await add(physio, 'Test Wall Sit'), 'a physio').toBe('42501');
      await as(tx, deskHsr);
      expect(await add(deskHsr, 'Test Wall Sit'), 'the desk').toBe('42501');
      await as(tx, superAdmin);
      const id = await insertExercise(tx, {
        name: 'Test Wall Sit',
        defaultDose: '3 × 30 s',
        by: superAdmin.id,
        video: video('wall-sit'),
      });
      const plain = await insertExercise(tx, {
        name: 'Test Calf Raise',
        defaultDose: '3 × 15',
        by: superAdmin.id,
      });
      expect(
        await failure(tx, (sp) =>
          sp.update(exercise).set({ defaultDose: '5 × 30 s' }).where(eq(exercise.id, id)),
        ),
        'a change is a new exercise',
      ).toBe('23514');
      expect(
        await failure(tx, (sp) => sp.delete(exercise).where(eq(exercise.id, id))),
        'never removed',
      ).toBe('42501');

      await as(tx, physio);
      expect((await activeExercises(tx)).map((e) => e.name)).toEqual(
        expect.arrayContaining(['Test Calf Raise', 'Test Wall Sit']),
      );
      expect(await failure(tx, (sp) => retireExercise(sp, id)), 'a physio retires none').toBe(
        undefined,
      );
      expect((await exerciseRecord(tx, id))?.retired, 'not by a physio').toBe(false);

      // Replaced: the old one retired, naming the new.
      await as(tx, superAdmin);
      expect(await failure(tx, (sp) => retireExercise(sp, id, id)), 'not by itself').toBe('23514');
      expect(await retireExercise(tx, id, plain)).toBe(true);
      expect(await retireExercise(tx, id), 'once').toBe(false);
      expect((await activeExercises(tx)).map((e) => e.id)).not.toContain(id);
      expect((await exerciseRecord(tx, id))?.retired).toBe(true);
    });
  });

  it('gives a patient the video of an exercise in their own plan only', async () => {
    await rolledBack(async (tx) => {
      const consultant = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const plan = await signedPlan(tx, {
        centreId: centreIds.hsrLayout,
        consultant,
        checkedInBy: deskHsr.id,
        modalities: [],
      });
      await as(tx, superAdmin);
      const planned = await insertExercise(tx, {
        name: 'Test Bridge',
        defaultDose: '3 × 12',
        by: superAdmin.id,
        video: video('bridge'),
      });
      const other = await insertExercise(tx, {
        name: 'Test Plank',
        defaultDose: '3 × 30 s',
        by: superAdmin.id,
        video: video('plank'),
      });
      // The plan's next version sets the bridge from the library.
      await tx.execute(sql`reset role`);
      await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
      await tx.insert(planOfCare).values({
        episodeId: plan.episodeId,
        consultationId: plan.consultationId,
        version: 2,
        goals: [],
        homeProgramme: [{ exercise: 'Test Bridge', dose: '3 × 12', note: '', exerciseId: planned }],
        reviewDate: '2026-12-05',
        treatingPhysioId: consultant.id,
        createdBy: consultant.id,
      });
      const link = async (purpose: 'my_plan' | 'questionnaire') => {
        await tx.execute(sql`reset role`);
        await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
        return insertPatientLink(tx, {
          patientId: plan.patientId,
          episodeId: plan.episodeId,
          purpose,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
      };
      const myPlan = await link('my_plan');
      const asPatient = async (id: string, purpose: string) => {
        await tx.execute(sql`reset role`);
        await setAuditContext(tx, { actor: patientActor(plan.patientId) });
        const claims = JSON.stringify({
          role: 'clinic_patient',
          patient_link: { id, patient_id: plan.patientId, purpose },
        });
        await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
        await tx.execute(sql`set local role clinic_patient`);
      };
      await asPatient(myPlan.id, 'my_plan');
      expect(await myPlanExerciseVideo(tx, planned)).toEqual(video('bridge'));
      expect(await myPlanExerciseVideo(tx, other), 'not in their plan').toBeUndefined();
      expect(
        await failure(tx, (sp) => sp.select().from(exercise)),
        'the library itself is staff only',
      ).toBe('42501');
    });
  });
});
