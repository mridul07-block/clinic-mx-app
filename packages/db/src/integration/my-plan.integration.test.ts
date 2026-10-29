import { addDays, istDate, istInstant } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import {
  exerciseTickSubject,
  exerciseTickedDays,
  sessionAdherence,
  tickExercise,
  untickExercise,
} from '../exercise-ticks';
import { episodeHasPlan, liveMyPlanLink } from '../my-plan-link';
import { myPlanView } from '../my-plan';
import { insertPatientLink, revokeMyPlanLinks } from '../patient-links';
import {
  appointment,
  confirmedDiagnosis,
  diagnosis,
  episode,
  exerciseTick,
  kbPatientContent,
  patientLink,
  patientPackage,
  planOfCare,
  treatmentSession,
} from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPhysio, typeId } from './fake-schedule';

// PAT-01, in part: a My plan link reads its own episode's page through internal.my_plan(), and
// nothing else: not another episode's, nothing for a health form link or one revoked or expired,
// no price, no unsigned session; staff never call it. Those who check patients in read and issue
// My plan links for episodes they see; a physio does not. Rolled back. CI database only.
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
const physioHsr = member('physio.hsr@clinicmx.test');

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

/** From here on, as the patient behind `link`, the way `withPatientAccess` reads. */
async function asLink(tx: Tx, link: { id: string; patientId: string; purpose: string }) {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

const hsr = centreIds.hsrLayout;
const today = istDate(new Date());

/** An Active episode with a signed consultation, a plan with a home programme and a visit ahead. */
async function planned(tx: Tx) {
  const physio = await testPhysio(tx, {
    centreIds: [hsr],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const kb = await knowledgeVersion(tx);
  const opened = await episodeThrough(tx, hsr, [
    'awaiting_consultation',
    'plan_proposed',
    'active',
  ]);
  const seen = await visit(tx, {
    centreId: hsr,
    physio,
    type: 'consultation',
    day: addDays(today, -7),
    status: 'completed',
    episodeId: opened.id,
    patientId: opened.patientId,
  });
  const consultationId = await note(tx, {
    appointmentId: seen.id,
    episodeId: opened.id,
    physio,
    kbVersionId: kb,
    signedAt: new Date(Date.now() - 7 * 86_400_000),
  });
  await asSystem(tx);
  await tx.insert(planOfCare).values({
    episodeId: opened.id,
    consultationId,
    version: 1,
    goals: [],
    homeProgramme: [{ exercise: 'Test step downs', dose: '3 x 10', note: 'Slowly' }],
    weeks: 6,
    reviewDate: addDays(today, 35),
    treatingPhysioId: physio.id,
    createdBy: physio.id,
  });
  const startsAt = istInstant(addDays(today, 2), 10 * 60);
  await tx.insert(appointment).values({
    number: '',
    patientId: opened.patientId,
    centreId: hsr,
    physioId: physio.id,
    appointmentTypeId: await typeId(tx, 'session'),
    episodeId: opened.id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 45 * 60_000),
    channel: 'front_desk',
    bookedBy: superAdmin.id,
    status: 'booked',
  });
  const link = await insertPatientLink(tx, {
    patientId: opened.patientId,
    purpose: 'my_plan',
    episodeId: opened.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { ...opened, physio, link: { ...link, patientId: opened.patientId, purpose: 'my_plan' } };
}

describe('My plan', () => {
  it('shows a My plan link its own episode’s page, and nothing of another', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      const theirs = await planned(tx);
      await asLink(tx, mine.link);
      const page = (await myPlanView(tx)) as Record<string, unknown>;
      expect(page).toMatchObject({
        episodeStatus: 'active',
        plan: {
          homeProgramme: [{ exercise: 'Test step downs', dose: '3 x 10', note: 'Slowly' }],
          weeks: 6,
        },
        next: { type: 'Session', physio: mine.physio.name },
        package: null,
        pain: [],
      });
      // Never a price, an address, a phone of the patient or another episode's rows.
      expect(JSON.stringify(page)).not.toMatch(/paise|price|theirs/i);
      // The patient role reaches no table row itself.
      expect(await tx.select({ id: appointment.id }).from(appointment)).toEqual([]);
      await asSystem(tx);
      await asLink(tx, theirs.link);
      expect(((await myPlanView(tx)) as { plan: unknown }).plan).not.toBeNull();
    });
  });

  it('gives nothing to a health form link, a revoked or an expired one, or to staff', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      // A health form link of the same patient: no page.
      const form = await insertPatientLink(tx, {
        patientId: mine.patientId,
        purpose: 'health_form',
        appointmentId: (
          await tx
            .select({ id: appointment.id })
            .from(appointment)
            .where(eq(appointment.episodeId, mine.id))
            .limit(1)
        )[0]?.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await asLink(tx, { ...form, patientId: mine.patientId, purpose: 'health_form' });
      expect(await myPlanView(tx)).toBeNull();
      // A My plan link naming no episode: no page.
      await asSystem(tx);
      const orphan = await insertPatientLink(tx, {
        patientId: mine.patientId,
        purpose: 'my_plan',
        episodeId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await asLink(tx, { ...orphan, patientId: mine.patientId, purpose: 'my_plan' });
      expect(await myPlanView(tx)).toBeNull();
      await asSystem(tx);
      await tx
        .update(patientLink)
        .set({ revokedAt: new Date() })
        .where(eq(patientLink.id, mine.link.id));
      await asLink(tx, mine.link);
      expect(await myPlanView(tx)).toBeNull();
      await asSystem(tx);
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await myPlanView(sp);
        }),
      ).toBe('42501');
    });
  });

  it('lets those who check in read and issue My plan links at their centre, never a physio', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await becomeStaff(tx, deskHsr);
      expect((await liveMyPlanLink(tx, mine.id))?.id).toBe(mine.link.id);
      // The desk reads no plan of care, only whether there is one.
      expect(await episodeHasPlan(tx, mine.id)).toBe(true);
      expect(await tx.select({ id: planOfCare.id }).from(planOfCare)).toEqual([]);
      const issue = (staff: StaffMember) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, staff);
          await insertPatientLink(sp, {
            patientId: mine.patientId,
            purpose: 'my_plan',
            episodeId: mine.id,
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        });
      expect(await issue(deskHsr)).toBeUndefined();
      expect(await issue(deskKoramangala)).toBe('42501');
      expect(await issue(physioHsr)).toBe('42501');
      await becomeStaff(tx, deskKoramangala);
      expect(await liveMyPlanLink(tx, mine.id)).toBeUndefined();
      expect(await episodeHasPlan(tx, mine.id)).toBe(false);
      await becomeStaff(tx, physioHsr);
      expect(await episodeHasPlan(tx, mine.id)).toBe(false);
    });
  });

  it('stops the patient’s older My plan link when the desk issues one, and nobody else can', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await becomeStaff(tx, deskHsr);
      const newer = await insertPatientLink(tx, {
        patientId: mine.patientId,
        purpose: 'my_plan',
        episodeId: mine.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      // Neither another centre's desk nor a physio stops links through it.
      for (const staff of [deskKoramangala, physioHsr]) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, staff);
            await revokeMyPlanLinks(sp, mine.patientId, newer.id);
          }),
        ).toBe('42501');
      }
      // Nor for another patient's links.
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await revokeMyPlanLinks(sp, superAdmin.id, newer.id);
        }),
      ).toBe('42501');
      // A link must name the episode's own patient: the desk can neither issue nor stop through
      // another's, and a mismatched link (even the system's) shows nothing.
      await asSystem(tx);
      const theirs = await planned(tx);
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await insertPatientLink(sp, {
            patientId: theirs.patientId,
            purpose: 'my_plan',
            episodeId: mine.id,
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        }),
      ).toBe('42501');
      await asSystem(tx);
      const crossed = await insertPatientLink(tx, {
        patientId: theirs.patientId,
        purpose: 'my_plan',
        episodeId: mine.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await revokeMyPlanLinks(sp, theirs.patientId, crossed.id);
        }),
      ).toBe('42501');
      await asLink(tx, { ...crossed, patientId: theirs.patientId, purpose: 'my_plan' });
      expect(await myPlanView(tx)).toBeNull();
      await asSystem(tx);
      await becomeStaff(tx, deskHsr);
      expect(await revokeMyPlanLinks(tx, mine.patientId, newer.id)).toBe(1);
      await asSystem(tx);
      const [older] = await tx
        .select({ revokedAt: patientLink.revokedAt })
        .from(patientLink)
        .where(eq(patientLink.id, mine.link.id));
      expect(older?.revokedAt).not.toBeNull();
      await asLink(tx, mine.link);
      expect(await myPlanView(tx)).toBeNull();
    });
  });

  it('shows the package signing takes sessions from, signed pain only, and nothing once expired', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      const kb = await knowledgeVersion(tx);
      await asSystem(tx);
      // Placed directly, triggers off: two live packages and two sessions, one still a draft.
      await tx.execute(sql`set local session_replication_role = replica`);
      const held = (name: string, values: { daysAgo: number; total: number; used: number }) => ({
        patientId: mine.patientId,
        episodeId: mine.id,
        centreId: hsr,
        openingEntryId: crypto.randomUUID(),
        name,
        sessionsTotal: values.total,
        sessionsUsed: values.used,
        reschedulesLeft: 2,
        paidAt: new Date(Date.now() - values.daysAgo * 86_400_000),
        validUntil: addDays(today, 30),
      });
      const [older] = await tx
        .insert(patientPackage)
        .values(held('Test Six sessions', { daysAgo: 10, total: 6, used: 4 }))
        .returning({ id: patientPackage.id });
      await tx
        .insert(patientPackage)
        .values(held('Test Ten sessions', { daysAgo: 1, total: 10, used: 0 }));
      for (const [number, signed] of [
        [1, true],
        [2, false],
      ] as const) {
        await tx.insert(treatmentSession).values({
          appointmentId: crypto.randomUUID(),
          episodeId: mine.id,
          patientId: mine.patientId,
          centreId: hsr,
          physioId: mine.physio.id,
          number,
          kbVersionId: kb,
          ...(signed
            ? {
                status: 'signed' as const,
                signedBy: mine.physio.id,
                signedAt: new Date(),
                painRest: 2,
                painActivity: 5,
                painAfter: 1,
              }
            : { painActivity: 9 }),
        });
      }
      await tx.execute(sql`set local session_replication_role = origin`);
      await asLink(tx, mine.link);
      expect(await myPlanView(tx)).toMatchObject({
        package: { name: 'Test Six sessions', total: 6, used: 4, reschedulesLeft: 2 },
        pain: [{ number: 1, rest: 2, activity: 5, after: 1 }],
      });
      // Used up: the next one signing will take.
      await asSystem(tx);
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(patientPackage)
        .set({ sessionsUsed: 6 })
        .where(eq(patientPackage.id, older?.id ?? ''));
      await tx.execute(sql`set local session_replication_role = origin`);
      await asLink(tx, mine.link);
      expect(await myPlanView(tx)).toMatchObject({ package: { name: 'Test Ten sessions' } });
      // A link past its end reads nothing.
      await asSystem(tx);
      const [ended] = await tx
        .insert(patientLink)
        .values({
          patientId: mine.patientId,
          purpose: 'my_plan',
          episodeId: mine.id,
          createdAt: new Date(Date.now() - 2 * 3_600_000),
          expiresAt: new Date(Date.now() - 60_000),
        })
        .returning({ id: patientLink.id });
      await asLink(tx, { id: ended?.id ?? '', patientId: mine.patientId, purpose: 'my_plan' });
      expect(await myPlanView(tx)).toBeNull();
    });
  });
});

// CLN-08: the diagnosis in plain words, only as approved (AI-07), for the episode's confirmed
// diagnosis or else its newest signed one. Generated text only.
describe('About your condition', () => {
  /**
   * Two conditions of the newest version that has any (the fixture's own empty version may be the
   * live one here): content is kept by condition, whatever the version.
   */
  async function conditions(tx: Tx): Promise<{ live: string; first: string; second: string }> {
    const rows = await tx.execute<{ kb_version_id: string; condition_id: string }>(sql`
      select c.kb_version_id, c.condition_id from kb_condition c
      where c.kb_version_id = (select k.kb_version_id from kb_condition k
        join kb_version v on v.id = k.kb_version_id order by v.number desc limit 1)
      group by c.kb_version_id, c.condition_id order by c.condition_id limit 2`);
    const [first, second] = rows;
    if (!first || !second) throw new Error('No knowledge base version has conditions.');
    return { live: first.kb_version_id, first: first.condition_id, second: second.condition_id };
  }
  const content = async (
    tx: Tx,
    kbVersionId: string,
    conditionId: string,
    explanation: string,
    approved: boolean,
  ) => {
    const [row] = await tx
      .insert(kbPatientContent)
      .values({
        conditionId,
        kbVersionId,
        source: 'clinician',
        explanation,
        roadmap: 'Test roadmap',
        homeAdvice: 'Test home advice',
        warningSigns: 'Test warning signs',
      })
      .returning({ id: kbPatientContent.id });
    if (approved) {
      await tx
        .update(kbPatientContent)
        .set({ status: 'approved', approvedBy: superAdmin.id, approvedAt: new Date() })
        .where(eq(kbPatientContent.id, row?.id ?? ''));
    }
  };

  it('shows the approved explanation of the episode’s diagnosis, never a draft, the confirmed one first', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await asSystem(tx);
      const { live, first, second } = await conditions(tx);
      const [consultationRow] = await tx.execute<{ id: string }>(
        sql`select id from consultation where episode_id = ${mine.id} limit 1`,
      );
      await tx.execute(sql`set local session_replication_role = replica`);
      const [working] = await tx
        .insert(diagnosis)
        .values({
          consultationId: consultationRow?.id ?? '',
          episodeId: mine.id,
          kbVersionId: live,
          conditionId: first,
          movementDx: 'Test movement diagnosis',
          irritability: 'moderate',
          stage: 'subacute',
          provisional: false,
        })
        .returning({ id: diagnosis.id });
      await tx.execute(sql`set local session_replication_role = origin`);
      const about = async () => {
        await asSystem(tx);
        await asLink(tx, mine.link);
        const page = (await myPlanView(tx)) as { aboutCondition: string | null };
        await asSystem(tx);
        return page.aboutCondition;
      };
      expect(await about(), 'nothing approved').toBeNull();
      await content(tx, live, first, 'Test draft words', false);
      expect(await about(), 'a draft').toBeNull();
      await content(tx, live, second, 'Test second condition words', true);
      expect(await about(), 'another condition').toBeNull();
      // The draft goes (the guard allows a draft); the approved text is written in its place.
      await tx.delete(kbPatientContent).where(eq(kbPatientContent.conditionId, first));
      await content(tx, live, first, 'Test approved words', true);
      expect(await about()).toBe('Test approved words');
      // Confirmed at review as the second condition (AI-05): its explanation instead.
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.insert(confirmedDiagnosis).values({
        episodeId: mine.id,
        sourceDiagnosisId: working?.id ?? '',
        kbVersionId: live,
        conditionId: second,
        stage: 'review',
        confirmedBy: mine.physio.id,
      });
      await tx.execute(sql`set local session_replication_role = origin`);
      expect(await about()).toBe('Test second condition words');
    });
  });
});

// PAT-02: the patient ticks their newest plan's exercises for today through their My plan link, and
// unticks today's; nothing for another day, another row or wording, or another kind of link. A
// clinician reads the days done since the session before; the desk does not.
describe('Exercise ticks', () => {
  const ticksOf = async (tx: Tx, episodeId: string) => {
    await asSystem(tx);
    return tx
      .select({ day: exerciseTick.day, index: exerciseTick.exerciseIndex })
      .from(exerciseTick)
      .where(eq(exerciseTick.episodeId, episodeId));
  };

  it('ticks a row for today, once, unticks it, and shows it on My plan', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await asLink(tx, mine.link);
      const subject = await exerciseTickSubject(tx);
      if (!subject) throw new Error('no subject');
      expect(subject).toMatchObject({ episodeId: mine.id, today });
      const tick = { linkId: mine.link.id, subject, index: 0, exercise: 'Test step downs' };
      await tickExercise(tx, tick);
      await tickExercise(tx, tick);
      expect(await myPlanView(tx)).toMatchObject({
        today,
        tickedToday: [0],
        tickedDays: [today],
      });
      expect(await ticksOf(tx, mine.id)).toEqual([{ day: today, index: 0 }]);
      await asLink(tx, mine.link);
      await untickExercise(tx, { subject, index: 0 });
      expect(await myPlanView(tx)).toMatchObject({ tickedToday: [], tickedDays: [] });
    });
  });

  it('refuses another day, row or wording, and other links; and keeps earlier days', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await asLink(tx, mine.link);
      const subject = await exerciseTickSubject(tx);
      if (!subject) throw new Error('no subject');
      const refused = (values: Partial<{ index: number; exercise: string; today: string }>) =>
        failure(tx, async (sp) => {
          await tickExercise(sp, {
            linkId: mine.link.id,
            subject: { ...subject, today: values.today ?? subject.today },
            index: values.index ?? 0,
            exercise: values.exercise ?? 'Test step downs',
          });
        });
      expect(await refused({ exercise: 'Something else' })).toBe('42501');
      expect(await refused({ index: 1 })).toBe('42501');
      expect(await refused({ today: addDays(today, -1) })).toBe('42501');
      expect(await refused({ today: addDays(today, 1) })).toBe('42501');
      // Yesterday's tick stays: today's untick never reaches it.
      await asSystem(tx);
      const [plan] = await tx
        .select({ id: planOfCare.id })
        .from(planOfCare)
        .where(eq(planOfCare.episodeId, mine.id));
      await tx.insert(exerciseTick).values({
        patientId: mine.patientId,
        episodeId: mine.id,
        planOfCareId: plan?.id ?? '',
        exerciseIndex: 0,
        exercise: 'Test step downs',
        day: addDays(today, -1),
        patientLinkId: mine.link.id,
      });
      await asLink(tx, mine.link);
      await untickExercise(tx, { subject: { ...subject, today: addDays(today, -1) }, index: 0 });
      expect(await ticksOf(tx, mine.id)).toHaveLength(1);
      // Another episode's link ticks only its own plan, and other links tick nothing.
      const theirs = await planned(tx);
      await asLink(tx, theirs.link);
      expect((await exerciseTickSubject(tx))?.episodeId).toBe(theirs.id);
      expect(
        await failure(tx, (sp) =>
          tickExercise(sp, {
            linkId: theirs.link.id,
            subject,
            index: 0,
            exercise: 'Test step downs',
          }),
        ),
      ).toBe('42501');
      await asSystem(tx);
      await tx
        .update(patientLink)
        .set({ revokedAt: new Date() })
        .where(eq(patientLink.id, mine.link.id));
      await asLink(tx, mine.link);
      expect(await exerciseTickSubject(tx)).toBeUndefined();
      // Staff never tick.
      await asSystem(tx);
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await tickExercise(sp, { linkId: mine.link.id, subject, index: 0, exercise: 'x' });
        }),
      ).toBe('42501');
    });
  });

  it('gives a clinician the days done since the session before, and the desk nothing', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await asSystem(tx);
      const kb = await knowledgeVersion(tx);
      const [plan] = await tx
        .select({ id: planOfCare.id })
        .from(planOfCare)
        .where(eq(planOfCare.episodeId, mine.id));
      // The link from well before; session 1 signed 5 days ago; session 2 today, a draft.
      await tx
        .update(patientLink)
        .set({ createdAt: new Date(Date.now() - 10 * 86_400_000) })
        .where(eq(patientLink.id, mine.link.id));
      const first = await visit(tx, {
        centreId: hsr,
        physio: mine.physio,
        type: 'session',
        day: addDays(today, -5),
        status: 'completed',
        episodeId: mine.id,
        patientId: mine.patientId,
      });
      const second = await visit(tx, {
        centreId: hsr,
        physio: mine.physio,
        type: 'session',
        day: today,
        status: 'in_progress',
        episodeId: mine.id,
        patientId: mine.patientId,
      });
      await tx.execute(sql`set local session_replication_role = replica`);
      const base = {
        episodeId: mine.id,
        patientId: mine.patientId,
        centreId: hsr,
        physioId: mine.physio.id,
        kbVersionId: kb,
      };
      await tx.insert(treatmentSession).values({
        ...base,
        appointmentId: first.id,
        number: 1,
        status: 'signed',
        signedBy: mine.physio.id,
        // Signed 3 days after its visit: the window still starts the day after the visit.
        signedAt: istInstant(addDays(today, -2), 12 * 60),
        painRest: 2,
        painActivity: 4,
        painAfter: 1,
      });
      const [draft] = await tx
        .insert(treatmentSession)
        .values({ ...base, appointmentId: second.id, number: 2 })
        .returning({ id: treatmentSession.id });
      await tx.execute(sql`set local session_replication_role = origin`);
      for (const back of [6, 4, 3, 1]) {
        await tx.insert(exerciseTick).values({
          patientId: mine.patientId,
          episodeId: mine.id,
          planOfCareId: plan?.id ?? '',
          exerciseIndex: 0,
          exercise: 'Test step downs',
          day: addDays(today, -back),
          patientLinkId: mine.link.id,
        });
      }
      await becomeStaff(tx, mine.physio);
      expect(await sessionAdherence(tx, draft?.id ?? '')).toEqual({
        from: addDays(today, -4),
        to: addDays(today, -1),
        since: 'last_session',
        days: 4,
        daysDone: 3,
        tracked: true,
      });
      expect(await exerciseTickedDays(tx, mine.id, addDays(today, -6), today)).toEqual({
        days: [addDays(today, -6), addDays(today, -4), addDays(today, -3), addDays(today, -1)],
        // The plan was made today; the link 10 days ago: ticking became possible today.
        trackedFrom: today,
      });
      for (const staff of [deskHsr]) {
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, staff);
            await sessionAdherence(sp, draft?.id ?? '');
          }),
        ).toBe('42501');
        expect(
          await failure(tx, async (sp) => {
            await becomeStaff(sp, staff);
            await exerciseTickedDays(sp, mine.id, today, today);
          }),
        ).toBe('42501');
      }
    });
  });
});

// PAT-03: after discharge, My plan is the maintenance page: what the discharging consultant wrote
// for the patient, as written, and never the staff note. A My plan link is not issued for an
// older episode while the patient has a newer one.
describe('Maintenance mode', () => {
  const dischargedWith = async (tx: Tx, mine: Awaited<ReturnType<typeof planned>>) => {
    await becomeStaff(tx, mine.physio);
    expect(
      await updateEpisodeState(
        tx,
        mine.id,
        'active',
        { status: 'discharged', pausedFrom: null },
        {
          reason: 'other',
          note: 'Fake staff note',
          returnPlan: 'Fake return plan text',
          flarePlan: 'Fake flare plan text',
          recommendations: 'Fake recommendations text',
        },
      ),
    ).toBe(true);
    await asSystem(tx);
  };

  it('shows the maintenance section only after discharge, as written, never the staff note', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await asLink(tx, mine.link);
      expect(await myPlanView(tx)).toMatchObject({ maintenance: null });
      await asSystem(tx);
      await dischargedWith(tx, mine);
      await asLink(tx, mine.link);
      const page = (await myPlanView(tx)) as Record<string, unknown>;
      expect(page).toMatchObject({
        episodeStatus: 'discharged',
        maintenance: {
          returnPlan: 'Fake return plan text',
          flarePlan: 'Fake flare plan text',
          ongoingNeeds: null,
          recommendations: 'Fake recommendations text',
        },
      });
      expect(JSON.stringify(page)).not.toContain('Fake staff note');
      // Ticking still works after discharge.
      const subject = await exerciseTickSubject(tx);
      if (!subject) throw new Error('no subject');
      await tickExercise(tx, {
        linkId: mine.link.id,
        subject,
        index: 0,
        exercise: 'Test step downs',
      });
      expect((await myPlanView(tx)) as Record<string, unknown>).toMatchObject({
        tickedToday: [0],
      });
    });
  });

  it('keeps return and flare plans to discharged episodes', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await asSystem(tx);
      expect(
        await failure(tx, (sp) =>
          sp.update(episode).set({ dischargeFlarePlan: 'x' }).where(eq(episode.id, mine.id)),
        ),
      ).toBe('23514');
    });
  });

  it('issues a discharged episode’s link, but never an older episode’s while a newer one exists', async () => {
    await rolledBack(async (tx) => {
      const mine = await planned(tx);
      await dischargedWith(tx, mine);
      const issue = (episodeId: string) =>
        failure(tx, async (sp) => {
          await becomeStaff(sp, deskHsr);
          await insertPatientLink(sp, {
            patientId: mine.patientId,
            purpose: 'my_plan',
            episodeId,
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        });
      expect(await issue(mine.id)).toBeUndefined();
      // A recurrence: a newer episode for the same patient (made later).
      await asSystem(tx);
      const newer = await episodeThrough(tx, hsr, ['awaiting_consultation'], mine.patientId);
      await tx
        .update(episode)
        .set({ createdAt: new Date(Date.now() + 60_000) })
        .where(eq(episode.id, newer.id));
      // Still in intake, with no plan (and so no My plan): it stops nothing.
      expect(await issue(mine.id)).toBeUndefined();
      // Once the newer episode has a plan, a link for the older one would stop its link.
      await asSystem(tx);
      const kb = await knowledgeVersion(tx);
      const seen = await visit(tx, {
        centreId: hsr,
        physio: mine.physio,
        type: 'consultation',
        day: today,
        status: 'completed',
        episodeId: newer.id,
        patientId: mine.patientId,
      });
      const consultationId = await note(tx, {
        appointmentId: seen.id,
        episodeId: newer.id,
        physio: mine.physio,
        kbVersionId: kb,
        signedAt: new Date(),
      });
      await asSystem(tx);
      await tx.insert(planOfCare).values({
        episodeId: newer.id,
        consultationId,
        version: 1,
        goals: [],
        homeProgramme: [],
        reviewDate: addDays(today, 35),
        treatingPhysioId: mine.physio.id,
        createdBy: mine.physio.id,
      });
      expect(await issue(mine.id)).toBe('42501');
      expect(await issue(newer.id)).toBeUndefined();
    });
  });
});
