import { addDays, istDate, type EpisodeStatus } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { kpiDiagnosisOutcomes, kpiFunnel } from '../dashboards';
import type { StaffMember } from '../identity';
import { kpiDaily } from '../kpis';
import { episode, planOfCare } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, claimsOf, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// DSH-06: a treating clinician's own outcomes, the Centre Manager's figures (DSH-03) over the
// episodes whose newest plan names them, at any centre; nobody else's; the same definitions as
// the centres' figures (a parity check keeps the copies equal). Refused to the desk, Finance, a
// Centre Manager, anyone without the Treats patients tick and Velyx support. Rolled back. CI
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
const manager = member('manager@clinicmx.test');
const finance = member('finance@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
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

async function as<R>(tx: Tx, staff: StaffMember, read: (tx: Tx) => Promise<R>): Promise<R> {
  await becomeStaff(tx, staff);
  const result = await read(tx);
  await asSystem(tx);
  return result;
}

const today = istDate(new Date());
const from = addDays(today, -29);
// Read up to tomorrow: rows stamped now still count if the run crosses midnight IST.
const to = addDays(today, 1);
const hsr = centreIds.hsrLayout;

/**
 * An episode at `centreId`, consulted and signed by `consultant`, whose plan names `treating`,
 * moved through `statuses`; discharged with `reason` when given.
 */
async function treated(
  tx: Tx,
  options: {
    consultant: StaffMember;
    treating: StaffMember;
    centreId?: string;
    statuses: EpisodeStatus[];
    reason?: 'goals_achieved' | 'patient_choice';
  },
) {
  const centreId = options.centreId ?? hsr;
  const kb = await knowledgeVersion(tx);
  const held = await episodeThrough(tx, centreId, ['awaiting_consultation']);
  const seen = await visit(tx, {
    centreId,
    physio: options.consultant,
    type: 'consultation',
    day: addDays(today, -3),
    status: 'completed',
    episodeId: held.id,
    patientId: held.patientId,
  });
  const consultationId = await note(tx, {
    appointmentId: seen.id,
    episodeId: held.id,
    physio: options.consultant,
    kbVersionId: kb,
    signedAt: new Date(),
  });
  await tx.insert(planOfCare).values({
    episodeId: held.id,
    consultationId,
    version: 1,
    goals: [],
    homeProgramme: [],
    reviewDate: addDays(today, 40),
    treatingPhysioId: options.treating.id,
    createdBy: options.consultant.id,
  });
  for (const status of options.statuses) {
    await tx.update(episode).set({ status }).where(eq(episode.id, held.id));
  }
  if (options.reason) {
    await claimsOf(tx, options.consultant);
    await tx
      .update(episode)
      .set({ status: 'discharged', dischargeReason: options.reason, closedAt: new Date() })
      .where(eq(episode.id, held.id));
    await asSystem(tx);
  }
  return { ...held, consultationId };
}

const tally = (rows: Awaited<ReturnType<typeof kpiDaily>>, metric: string, centreId?: string) =>
  rows
    .filter((row) => row.metric === metric && (centreId === undefined || row.centreId === centreId))
    .reduce(
      (sum, row) => ({
        numerator: sum.numerator + row.numerator,
        denominator: sum.denominator + (row.denominator ?? 0),
      }),
      { numerator: 0, denominator: 0 },
    );
const stage = (rows: Awaited<ReturnType<typeof kpiFunnel>>, name: string, centreId?: string) =>
  rows
    .filter((row) => row.stage === name && (centreId === undefined || row.centreId === centreId))
    .reduce((sum, row) => sum + row.episodes, 0);

describe('a clinician’s own outcomes', () => {
  it('counts only the episodes whose plan names them, as the centres’ figures count them', async () => {
    await rolledBack(async (tx) => {
      const mine = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const theirs = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const centresBefore = await as(tx, manager, (t) => kpiDaily(t, from, to));
      const funnelBefore = await as(tx, manager, (t) => kpiFunnel(t, from, to));

      const proposed: EpisodeStatus[] = ['plan_proposed'];
      const active: EpisodeStatus[] = ['plan_proposed', 'active'];
      await treated(tx, { consultant: mine, treating: mine, statuses: proposed });
      await treated(tx, { consultant: mine, treating: mine, statuses: active });
      await treated(tx, {
        consultant: mine,
        treating: mine,
        statuses: active,
        reason: 'goals_achieved',
      });
      await treated(tx, {
        consultant: mine,
        treating: theirs,
        statuses: active,
        reason: 'patient_choice',
      });

      const own = await as(tx, mine, (t) => kpiDaily(t, from, to, 'own'));
      expect(tally(own, 'consultation_conversion')).toEqual({ numerator: 2, denominator: 3 });
      expect(tally(own, 'treatment_completion')).toEqual({ numerator: 1, denominator: 1 });
      // Only the two outcome figures; never another metric or centre-wide row.
      expect(new Set(own.map((row) => row.metric))).toEqual(
        new Set(['consultation_conversion', 'treatment_completion']),
      );
      const others = await as(tx, theirs, (t) => kpiDaily(t, from, to, 'own'));
      expect(tally(others, 'treatment_completion')).toEqual({ numerator: 0, denominator: 1 });
      expect(tally(others, 'consultation_conversion')).toEqual({ numerator: 1, denominator: 1 });

      const funnel = await as(tx, mine, (t) => kpiFunnel(t, from, to, 'own'));
      expect(
        [
          'consultation_held',
          'plan_proposed',
          'active',
          'discharged',
          'discharged_goals_met',
          'in_treatment',
        ].map((name) => stage(funnel, name)),
      ).toEqual([3, 3, 2, 1, 1, 1]);

      // Parity: the two clinicians together are what the centre's figures gained.
      const centresAfter = await as(tx, manager, (t) => kpiDaily(t, from, to));
      const funnelAfter = await as(tx, manager, (t) => kpiFunnel(t, from, to));
      for (const metric of ['consultation_conversion', 'treatment_completion']) {
        const gained = {
          numerator:
            tally(centresAfter, metric, hsr).numerator -
            tally(centresBefore, metric, hsr).numerator,
          denominator:
            tally(centresAfter, metric, hsr).denominator -
            tally(centresBefore, metric, hsr).denominator,
        };
        expect(gained, metric).toEqual({
          numerator: tally(own, metric).numerator + tally(others, metric).numerator,
          denominator: tally(own, metric).denominator + tally(others, metric).denominator,
        });
      }
      const theirFunnel = await as(tx, theirs, (t) => kpiFunnel(t, from, to, 'own'));
      for (const name of ['plan_proposed', 'active', 'discharged', 'discharged_goals_met']) {
        expect(stage(funnelAfter, name, hsr) - stage(funnelBefore, name, hsr), name).toBe(
          stage(funnel, name) + stage(theirFunnel, name),
        );
      }
    });
  });

  it('follows the newest plan, at any centre, with the diagnoses as the centres count them', async () => {
    await rolledBack(async (tx) => {
      const first = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const second = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      // At Whitefield, where the first is not assigned: still theirs.
      const away = await treated(tx, {
        consultant: first,
        treating: first,
        centreId: centreIds.whitefield,
        statuses: ['plan_proposed', 'active'],
      });
      expect(
        tally(await as(tx, first, (t) => kpiDaily(t, from, to, 'own')), 'consultation_conversion'),
      ).toEqual({ numerator: 1, denominator: 1 });
      // A second plan names the other: the episode is theirs now, never both.
      await tx.insert(planOfCare).values({
        episodeId: away.id,
        consultationId: away.consultationId,
        version: 2,
        goals: [],
        homeProgramme: [],
        reviewDate: addDays(today, 40),
        treatingPhysioId: second.id,
        createdBy: first.id,
      });
      expect(
        tally(await as(tx, first, (t) => kpiDaily(t, from, to, 'own')), 'consultation_conversion')
          .denominator,
      ).toBe(0);
      expect(
        tally(await as(tx, second, (t) => kpiDaily(t, from, to, 'own')), 'consultation_conversion')
          .denominator,
      ).toBe(1);

      // A diagnosis on it: theirs counts it as the centres' figures do.
      const [condition] = await tx.execute<{ kb_version_id: string; condition_id: string }>(
        sql`select kb_version_id, condition_id from kb_condition order by kb_version_id desc limit 1`,
      );
      if (!condition) throw new Error('the knowledge base has no conditions');
      const centresBefore = await as(tx, superAdmin, (t) => kpiDiagnosisOutcomes(t, from, to));
      await tx.execute(sql`insert into diagnosis (consultation_id, episode_id, kb_version_id,
        condition_id, movement_dx, irritability, stage, provisional)
        values (${away.consultationId}, ${away.id}, ${condition.kb_version_id}, ${condition.condition_id},
          'Test movement diagnosis', 'moderate', 'subacute', false)`);
      const ofCondition = (
        rows: Awaited<ReturnType<typeof kpiDiagnosisOutcomes>>,
        centreId?: string,
      ) =>
        rows
          .filter(
            (row) =>
              row.conditionId === condition.condition_id &&
              (centreId === undefined || row.centreId === centreId),
          )
          .reduce((sum, row) => sum + row.diagnosed, 0);
      const theirs = await as(tx, second, (t) => kpiDiagnosisOutcomes(t, from, to, 'own'));
      const centresAfter = await as(tx, superAdmin, (t) => kpiDiagnosisOutcomes(t, from, to));
      expect(ofCondition(theirs)).toBe(1);
      expect(
        ofCondition(centresAfter, centreIds.whitefield) -
          ofCondition(centresBefore, centreIds.whitefield),
      ).toBe(1);
      expect(
        ofCondition(await as(tx, first, (t) => kpiDiagnosisOutcomes(t, from, to, 'own'))),
      ).toBe(0);
    });
  });

  // The copies match the centres' definitions line for line, but for who reads and whose episodes:
  // a change to internal.kpi_funnel or internal.kpi_diagnosis_outcomes must change these too.
  it('copies the centres’ funnel and diagnosis definitions exactly', async () => {
    const definition = async (name: string) => {
      const [row] = await db.execute<{ def: string }>(
        sql`select pg_get_functiondef(${`internal.${name}(date, date)`}::regprocedure) as def`,
      );
      return (row?.def ?? '')
        .replace(/FUNCTION internal\.\w+\(/, 'FUNCTION internal.f(')
        .replace(/IF NOT internal\.\w+\(\) THEN\s+RAISE EXCEPTION '[^']*'/, 'IF NOT reader THEN')
        .replace(/\s+AND internal\.jwt_sees_centre\([^)]*\)/g, '')
        .replace(/a\.episode_id IS NOT NULL AND a\.starts_at/, 'a.starts_at')
        .replace(
          /a\.episode_id IN \(SELECT o\.episode_id FROM internal\.own_episodes\(\) o\)\s+AND a\.starts_at/,
          'a.starts_at',
        )
        .replace(/e\.id IN \(SELECT o\.episode_id FROM internal\.own_episodes\(\) o\)\s+AND /, '')
        .replace(/\s+/g, ' ');
    };
    expect(await definition('own_funnel')).toBe(await definition('kpi_funnel'));
    expect(await definition('own_diagnosis_outcomes')).toBe(
      await definition('kpi_diagnosis_outcomes'),
    );
    // The two outcome figures keep the centres' exclusions and reasons.
    const daily = await definition('kpi_daily');
    const own = await definition('own_kpi_daily');
    for (const clause of [
      'AND NOT EXISTS (SELECT 1 FROM public.opening_entry o WHERE o.episode_id = e.id)',
      'AND NOT EXISTS (SELECT 1 FROM public.red_flag_alert r WHERE r.episode_id = e.id AND r.referred_at IS NOT NULL)',
      "count(*) FILTER (WHERE e.discharge_reason IN ('goals_achieved', 'independent_management'))",
      "e.status = 'discharged' AND e.activated_at IS NOT NULL AND e.closed_at >= range_start AND e.closed_at < range_end",
      'count(*) FILTER (WHERE p.activated_at IS NOT NULL)',
    ]) {
      expect(daily, clause).toContain(clause);
      expect(own, clause).toContain(clause);
    }
  });

  it('is refused to everyone but those who treat patients, and never helps read whose episodes', async () => {
    await rolledBack(async (tx) => {
      const readers = [
        (t: Tx) => kpiDaily(t, from, to, 'own'),
        (t: Tx) => kpiFunnel(t, from, to, 'own'),
        (t: Tx) => kpiDiagnosisOutcomes(t, from, to, 'own'),
      ];
      const refused: [string, StaffMember][] = [
        ['the desk', deskHsr],
        ['Finance', finance],
        ['a Centre Manager', manager],
        ['a Centre Manager with the tick', { ...manager, treatsPatients: true }],
        ['the Super Admin without the tick', { ...superAdmin, treatsPatients: false }],
        ['support', { ...superAdmin, support: true, treatsPatients: false }],
      ];
      for (const [who, staff] of refused) {
        for (const read of readers) {
          expect(
            await failure(tx, async (sp) => {
              await becomeStaff(sp, staff);
              await read(sp);
            }),
            who,
          ).toBe('42501');
        }
      }
      // A physio and the Super Admin who treats patients read their own.
      for (const staff of [physioHsr, superAdmin]) {
        for (const read of readers) {
          expect(
            await failure(tx, async (sp) => {
              await becomeStaff(sp, staff);
              await read(sp);
            }),
          ).toBeUndefined();
        }
      }
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, physioHsr);
          await kpiDaily(sp, addDays(today, -400), today, 'own');
        }),
      ).toBe('22023');
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, physioHsr);
          await sp.execute(sql`select * from internal.own_episodes()`);
        }),
      ).toBe('42501');
    });
  });
});
