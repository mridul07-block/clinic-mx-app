import { earlierToday, type EpisodeStatus, type KbReportBody } from '@clinic-mx/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { insertAiRun } from '../ai-runs';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { latestSignedDiagnosis, recordConfirmedDiagnosis } from '../confirmed-diagnosis';
import { insertEpisode, updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import { kbReportData, kbReportOf, kbReports, storeKbReport } from '../kb-report';
import { latestKnowledgeVersion } from '../knowledge';
import {
  aiPreparationSheet,
  aiSuggestion,
  appointment,
  confirmedDiagnosis,
  consultation,
  diagnosis,
  kbCondition,
  kbReport,
  task,
} from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// AI-08 done when: often dismissed suggestions, missed diagnoses, changes at review; sent to the
// Super Admin. Everything is generated inside a transaction that is rolled back, dated in March
// 2031 so no other row is counted. CI database only.
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
const desk = member('desk.hsr@clinicmx.test');
const finance = member('finance@clinicmx.test');
const support = seedStaff.find((s) => s.velyxSupport);

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

async function asSystem(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  await tx.execute(sql`select set_config('audit.actor', 'system:tests', true)`);
}

const MONTH = '2031-03';
const inMarch = (day: number) => new Date(Date.UTC(2031, 2, day, 6, 0));
const path: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

async function setUp(tx: Tx) {
  const version = await latestKnowledgeVersion(tx);
  if (!version) throw new Error('The knowledge base is not imported.');
  const knee = (
    await tx
      .select({ conditionId: kbCondition.conditionId })
      .from(kbCondition)
      .where(and(eq(kbCondition.kbVersionId, version.id), eq(kbCondition.homeRegion, 'knee')))
      .orderBy(asc(kbCondition.conditionId))
      .limit(5)
  ).map((row) => row.conditionId);
  if (knee.length < 5) throw new Error('The knowledge base has too few knee conditions.');
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  let visits = 0;

  /** An episode signed with `signedAs`, with a ranked sheet unless `sheet` is false. */
  const episodeWith = async (options: {
    signedAs: string;
    sheet?: {
      top: string[];
      also?: string[];
      shortlist: string[];
      recheckTop?: string[];
      marked?: { conditionId: string; disposition: 'kept' | 'dismissed' | null; at?: Date }[];
    };
  }) => {
    const patientId = await testPatient(tx);
    const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
    for (let step = 1; step < path.length; step++) {
      await updateEpisodeState(tx, episodeId, path[step - 1] as EpisodeStatus, {
        status: path[step] as EpisodeStatus,
        pausedFrom: null,
      });
    }
    visits += 1;
    const startsAt = earlierToday(-30 - 2 * visits);
    const [visit] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        centreId: centreIds.hsrLayout,
        physioId: consultant.id,
        appointmentTypeId: await typeId(tx, 'consultation'),
        episodeId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
      })
      .returning({ id: appointment.id });
    if (!visit) throw new Error('no visit');
    const [signed] = await tx
      .insert(consultation)
      .values({
        appointmentId: visit.id,
        episodeId,
        physioId: consultant.id,
        kbVersionId: version.id,
        sections: {},
        status: 'signed',
        signedBy: consultant.id,
        signedAt: new Date(),
      })
      .returning({ id: consultation.id });
    if (!signed) throw new Error('no consultation');
    await tx.insert(diagnosis).values({
      consultationId: signed.id,
      episodeId,
      kbVersionId: version.id,
      conditionId: options.signedAs,
      movementDx: 'Generated movement diagnosis',
      irritability: 'moderate',
      stage: 'subacute',
      provisional: true,
    });
    if (options.sheet) {
      const s = options.sheet;
      const run = (kind: 'rank_diagnoses' | 'recheck_with_findings') =>
        insertAiRun(tx, {
          kind,
          episodeId,
          kbVersionId: version.id,
          model: 'vendor/model-1',
          promptVersion:
            kind === 'rank_diagnoses' ? 'rank_diagnoses.v2' : 'recheck_with_findings.v2',
          inputHash: 'c'.repeat(64),
          status: 'ok',
          attempts: 1,
          latencyMs: 800,
        });
      const runId = await run('rank_diagnoses');
      const recheckRunId = s.recheckTop ? await run('recheck_with_findings') : null;
      const [sheet] = await tx
        .insert(aiPreparationSheet)
        .values({
          episodeId,
          kbVersionId: version.id,
          status: 'ready',
          aiRunId: runId,
          readyAt: inMarch(10),
          shortlist: {
            status: 'ok',
            knowledgeRegion: 'knee',
            items: s.shortlist.map((conditionId, i) => ({
              conditionId,
              region: 'knee',
              rowNumber: i + 1,
              fit: { age: 'match', onset: 'unknown', sex: 'neutral' },
              filtered: true,
              mustRuleOut: false,
            })),
            candidateCount: s.shortlist.length,
            gaps: [],
          },
          ...(recheckRunId
            ? {
                recheckStatus: 'ready' as const,
                recheckAiRunId: recheckRunId,
                recheckFindings: ['Generated finding'],
                recheckBy: consultant.id,
                recheckClaimedAt: inMarch(11),
                recheckReadyAt: inMarch(11),
              }
            : {}),
        })
        .returning({ id: aiPreparationSheet.id });
      if (!sheet) throw new Error('no sheet');
      const markedOf = (conditionId: string) =>
        s.marked?.find((m) => m.conditionId === conditionId);
      const rows = [
        ...s.top.map((conditionId) => ({ conditionId, section: 'top' as const, runId })),
        ...(s.also ?? []).map((conditionId) => ({
          conditionId,
          section: 'also_consider' as const,
          runId,
        })),
      ];
      await tx.insert(aiSuggestion).values(
        rows.map((row, i) => {
          const mark = markedOf(row.conditionId);
          return {
            sheetId: sheet.id,
            aiRunId: row.runId,
            conditionId: row.conditionId,
            region: 'knee' as const,
            rowNumber: i + 1,
            rank: i + 1,
            section: row.section,
            reason: 'Generated reason',
            ...(mark?.disposition
              ? {
                  disposition: mark.disposition,
                  disposedBy: consultant.id,
                  disposedAt: mark.at ?? inMarch(12),
                }
              : {}),
          };
        }),
      );
      if (recheckRunId) {
        await tx.insert(aiSuggestion).values(
          (s.recheckTop ?? []).map((conditionId, i) => ({
            sheetId: sheet.id,
            aiRunId: recheckRunId,
            conditionId,
            region: 'knee' as const,
            rowNumber: i + 1,
            rank: i + 1,
            section: 'top' as const,
            reason: 'Generated recheck reason',
          })),
        );
      }
    }
    return episodeId;
  };

  /** The episode's diagnosis confirmed as `conditionId` after review, dated in March 2031. */
  const confirm = async (episodeId: string, conditionId: string, day = 20) => {
    await updateEpisodeState(tx, episodeId, 'active', { status: 'under_review', pausedFrom: null });
    const source = await latestSignedDiagnosis(tx, episodeId);
    if (!source) throw new Error('no signed diagnosis');
    await becomeStaff(tx, consultant);
    await recordConfirmedDiagnosis(tx, { episodeId, source, conditionId, by: consultant.id });
    await asSystem(tx);
    await tx
      .update(confirmedDiagnosis)
      .set({ confirmedAt: inMarch(day) })
      .where(eq(confirmedDiagnosis.episodeId, episodeId));
  };
  return { version, knee, consultant, episodeWith, confirm };
}

const emptyBody = (month: string): KbReportBody => ({
  month,
  kbVersions: [],
  thresholds: { minMarked: 5, sharePercent: 50, topCount: 3 },
  totals: {
    sheetsReady: 0,
    sheetsUnavailable: 0,
    marked: 0,
    unmarked: 0,
    labels: 0,
    labelsCompared: 0,
    inTop: 0,
    labelsWithoutRanking: 0,
    labelsOtherVersion: 0,
    changed: 0,
  },
  oftenDismissed: [],
  missed: [],
  changed: [],
});

describe('the monthly knowledge base report', () => {
  it('counts the month’s dispositions once each, and grades what the sheet missed', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const [c1, c2, c3, c4, c5] = s.knee as [string, string, string, string, string];
      // In the top: confirmed as signed; c5 dismissed, c2 never marked.
      const hit = await s.episodeWith({
        signedAs: c1,
        sheet: {
          top: [c1, c5, c2],
          shortlist: [c1, c2, c3, c5],
          marked: [
            { conditionId: c1, disposition: 'kept' },
            { conditionId: c5, disposition: 'dismissed' },
          ],
        },
      });
      await s.confirm(hit, c1);
      // Under Also consider, then found at the recheck; c5 dismissed again, at both IST edges.
      const near = await s.episodeWith({
        signedAs: c2,
        sheet: {
          top: [c1, c3, c5],
          also: [c2],
          shortlist: [c1, c2, c3, c5],
          recheckTop: [c2],
          marked: [
            // 11:59:59 PM IST on 31 March: March.
            { conditionId: c5, disposition: 'dismissed', at: new Date('2031-03-31T18:29:59Z') },
            // Midnight IST: April, not counted.
            { conditionId: c1, disposition: 'kept', at: new Date('2031-03-31T18:30:00Z') },
          ],
        },
      });
      await s.confirm(near, c2);
      // On the shortlist, not suggested, and changed from the consultation's diagnosis.
      const changed = await s.episodeWith({
        signedAs: c1,
        sheet: { top: [c1, c2, c5], shortlist: [c1, c2, c3, c5] },
      });
      await s.confirm(changed, c3);
      // Not on the shortlist; and one with no sheet at all.
      const far = await s.episodeWith({
        signedAs: c4,
        sheet: { top: [c1, c2, c3], shortlist: [c1, c2, c3] },
      });
      await s.confirm(far, c4);
      const unranked = await s.episodeWith({ signedAs: c4 });
      await s.confirm(unranked, c4);
      // Confirmed in April: not this month's.
      const later = await s.episodeWith({ signedAs: c1 });
      await s.confirm(later, c1, 31);
      await tx
        .update(confirmedDiagnosis)
        .set({ confirmedAt: new Date('2031-03-31T18:30:00Z') })
        .where(eq(confirmedDiagnosis.episodeId, later));

      const data = await kbReportData(tx, MONTH);
      expect(data.sheetsReady).toBe(4);
      expect(data.dispositions.map((d) => [d.conditionId, d.kept, d.dismissed]).sort()).toEqual(
        [
          [c1, 1, 0],
          [c5, 0, 2],
        ].sort(),
      );
      // Never marked on this month's sheets: 1, 2 (the recheck's c2 once), 3 and 3; a Keep given
      // in April still counts as marked.
      expect(data.unmarked).toBe(9);
      const byLabel = new Map(data.labels.map((l) => [l.conditionId, l]));
      expect(data.labels).toHaveLength(5);
      expect(byLabel.get(c1)).toMatchObject({ sheet: 'ranked', inTop: true, topSize: 3 });
      expect(byLabel.get(c2)).toMatchObject({
        inTop: false,
        inAlsoConsider: true,
        inRecheckTop: true,
      });
      expect(byLabel.get(c3)).toMatchObject({
        inTop: false,
        inAlsoConsider: false,
        onShortlist: true,
        fromId: c1,
        stage: 'review',
      });
      const fours = data.labels.filter((l) => l.conditionId === c4);
      expect(fours.map((l) => [l.sheet, l.onShortlist]).sort()).toEqual(
        [
          ['no_ranking', false],
          ['ranked', false],
        ].sort(),
      );
      expect(data.kbVersions).toEqual([{ id: s.version.id, number: s.version.number }]);
    });
  });

  it('is kept once with one task for the Super Admin, read by nobody else, never changed', async () => {
    await rolledBack(async (tx) => {
      const id = await storeKbReport(tx, {
        month: MONTH,
        kbVersionId: null,
        body: emptyBody(MONTH),
      });
      expect(id).not.toBeNull();
      expect(
        await storeKbReport(tx, { month: MONTH, kbVersionId: null, body: emptyBody(MONTH) }),
      ).toBeNull();
      const tasks = await tx
        .select({ role: task.assigneeRole, details: task.details })
        .from(task)
        .where(and(eq(task.kind, 'ai.kb_report'), sql`${task.details} ->> 'month' = ${MONTH}`));
      expect(tasks).toEqual([{ role: 'super_admin', details: { reportId: id, month: MONTH } }]);
      // Never changed or deleted, even by the server.
      expect(
        await failure(tx, (sp) =>
          sp
            .update(kbReport)
            .set({ body: emptyBody('2031-04') })
            .where(eq(kbReport.month, MONTH)),
        ),
      ).toBe('23514');
      expect(await failure(tx, (sp) => sp.delete(kbReport).where(eq(kbReport.month, MONTH)))).toBe(
        '23514',
      );

      await becomeStaff(tx, superAdmin);
      expect((await kbReportOf(tx, MONTH))?.body.month).toBe(MONTH);
      expect((await kbReports(tx)).some((r) => r.month === MONTH)).toBe(true);
      expect(
        await failure(tx, (sp) =>
          sp.insert(kbReport).values({ month: '2031-05', body: emptyBody('2031-05') }),
        ),
      ).toBe('42501');
      await asSystem(tx);
      const consultantAtHsr = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const supportMember = support ? member(support.email) : undefined;
      for (const someone of [
        desk,
        finance,
        consultantAtHsr,
        ...(supportMember ? [supportMember] : []),
      ]) {
        await becomeStaff(tx, someone);
        expect(await kbReportOf(tx, MONTH), someone.email).toBeUndefined();
        await asSystem(tx);
      }
    });
  });
});
