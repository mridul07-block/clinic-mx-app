import { earlierToday } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  claimRecheck,
  claimSheet,
  finishRecheck,
  finishSheet,
  setDisposition,
  sheetForEpisode,
} from '../ai-sheet';
import { insertAiRun } from '../ai-runs';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { latestKnowledgeVersion } from '../knowledge';
import { aiSuggestion, appointment, auditEvent, consultation } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// AI-03 done when: unknown IDs dropped; knowledge base text shown word for word; Keep and Dismiss
// stored; ready within 15 s. Here, against the CI database (each case rolled back): who reads a
// sheet (consultants at the episode's centre), who keeps or dismisses (the visit's consultant,
// until a consultation on the episode is signed), and that nothing else of a suggestion changes.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

class Rollback extends Error {}
async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('audit.actor', 'system:ai', true)`);
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** The Postgres error code a statement failed with, inside a savepoint; undefined if none. */
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
  await tx.execute(sql`select set_config('audit.actor', 'system:ai', true)`);
}

async function setUp(tx: Tx) {
  const version = await latestKnowledgeVersion(tx);
  if (!version) throw new Error('The knowledge base is not imported.');
  const physio = (centre: string, consultant: boolean) =>
    testPhysio(tx, { centreIds: [centre], consultant, createdBy: superAdmin.id });
  const visitConsultant = await physio(centreIds.hsrLayout, true);
  const otherConsultant = await physio(centreIds.hsrLayout, true);
  const elsewhere = await physio(centreIds.whitefield, true);
  const notConsultant = await physio(centreIds.hsrLayout, false);
  await tx.execute(sql`select set_config('audit.actor', 'system:ai', true)`);
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  const startsAt = earlierToday(-30);
  const [visit] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId: centreIds.hsrLayout,
      physioId: visitConsultant.id,
      appointmentTypeId: await typeId(tx, 'consultation'),
      episodeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60000),
      channel: 'front_desk',
      bookedBy: superAdmin.id,
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: desk.id,
    })
    .returning({ id: appointment.id });
  const runId = await insertAiRun(tx, {
    kind: 'rank_diagnoses',
    episodeId,
    kbVersionId: version.id,
    model: 'vendor/model-1',
    promptVersion: 'rank_diagnoses.v1',
    inputHash: 'a'.repeat(64),
    status: 'ok',
    attempts: 1,
    latencyMs: 900,
  });
  const claim = await claimSheet(tx, {
    episodeId,
    kbVersionId: version.id,
    shortlist: { status: 'ok', knowledgeRegion: 'knee', items: [], candidateCount: 0, gaps: [] },
    case: null,
    similar: [],
    retryAfterSeconds: 60,
  });
  if (!claim || !visit) throw new Error('no sheet');
  const sheetId = claim.id;
  await finishSheet(tx, claim, {
    status: 'ready',
    aiRunId: runId,
    suggestions: [
      {
        conditionId: 'KNE-001',
        region: 'knee',
        rowNumber: 3,
        rank: 1,
        section: 'top',
        reason: 'Stairs',
      },
      {
        conditionId: 'KNE-002',
        region: 'knee',
        rowNumber: 4,
        rank: 2,
        section: 'top',
        reason: 'Onset',
      },
    ],
  });
  const [first] = await tx
    .select({ id: aiSuggestion.id })
    .from(aiSuggestion)
    .where(and(eq(aiSuggestion.sheetId, sheetId), eq(aiSuggestion.rank, 1)));
  if (!first) throw new Error('no suggestion');
  return {
    version,
    episodeId,
    visitId: visit.id,
    sheetId,
    suggestionId: first.id,
    visitConsultant,
    otherConsultant,
    elsewhere,
    notConsultant,
  };
}

describe('the AI preparation sheet', () => {
  it('is read by consultants at the episode’s centre only', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const reads = async (who: StaffMember) => {
        await becomeStaff(tx, who);
        const sheet = await sheetForEpisode(tx, s.episodeId);
        await asSystem(tx);
        return sheet?.suggestions.length ?? -1;
      };
      expect(await reads(s.visitConsultant)).toBe(2);
      expect(await reads(s.otherConsultant)).toBe(2);
      for (const someone of [s.elsewhere, s.notConsultant, desk, finance]) {
        expect(await reads(someone), someone.email).toBe(-1);
      }
    });
  });

  it('is kept or dismissed by the visit’s consultant only, audited', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      await becomeStaff(tx, s.otherConsultant);
      expect(await setDisposition(tx, s.suggestionId, 'kept', s.otherConsultant.id)).toBe(0);
      await asSystem(tx);
      await becomeStaff(tx, s.visitConsultant);
      expect(await setDisposition(tx, s.suggestionId, 'kept', s.visitConsultant.id)).toBe(1);
      expect(await setDisposition(tx, s.suggestionId, 'dismissed', s.visitConsultant.id)).toBe(1);
      // Never someone else's name, nothing but the disposition, and never back to none.
      expect(
        await failure(tx, (sp) => setDisposition(sp, s.suggestionId, 'kept', s.otherConsultant.id)),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(aiSuggestion)
            .set({ reason: 'Changed' })
            .where(eq(aiSuggestion.id, s.suggestionId)),
        ),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(aiSuggestion)
            .set({ disposition: null, disposedBy: null, disposedAt: null })
            .where(eq(aiSuggestion.id, s.suggestionId)),
        ),
      ).toBe('42501');
      await asSystem(tx);
      const [audited] = await tx
        .select({ actor: auditEvent.actor, after: auditEvent.after })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'ai_suggestion'), eq(auditEvent.entityId, s.suggestionId)))
        .orderBy(sql`${auditEvent.id} desc`)
        .limit(1);
      expect(audited?.actor).toBe(`staff:${s.visitConsultant.id}`);
      expect(audited?.after).toMatchObject({ disposition: 'dismissed' });
    });
  });

  it('is closed to Keep and Dismiss once a consultation on the episode is signed', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      await tx.insert(consultation).values({
        appointmentId: s.visitId,
        episodeId: s.episodeId,
        physioId: s.visitConsultant.id,
        kbVersionId: s.version.id,
        sections: {},
        status: 'signed',
        signedBy: s.visitConsultant.id,
        signedAt: new Date(),
      });
      await becomeStaff(tx, s.visitConsultant);
      expect(await setDisposition(tx, s.suggestionId, 'kept', s.visitConsultant.id)).toBe(0);
      await asSystem(tx);
    });
  });

  it('is written by nobody signed in, and taken once while being made', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, s.visitConsultant);
          await sp.execute(sql`delete from ai_suggestion where id = ${s.suggestionId}`);
        }),
      ).toBe('42501');
      await asSystem(tx);
      // A made sheet is never finished again, nor taken again.
      expect(
        await finishSheet(
          tx,
          { id: s.sheetId, claimedAt: new Date() },
          { status: 'unavailable', reason: 'failed', aiRunId: null },
        ),
      ).toBe(false);
      expect(
        await claimSheet(tx, {
          episodeId: s.episodeId,
          kbVersionId: s.version.id,
          shortlist: {
            status: 'ok',
            knowledgeRegion: 'knee',
            items: [],
            candidateCount: 0,
            gaps: [],
          },
          case: null,
          similar: [],
          retryAfterSeconds: 60,
        }),
      ).toBeNull();
    });
  });

  it('is finished only by the run that holds its claim', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const episodeId = await insertEpisode(tx, {
        patientId: await testPatient(tx),
        centreId: centreIds.hsrLayout,
      });
      const empty = {
        status: 'ok' as const,
        knowledgeRegion: null,
        items: [],
        candidateCount: 0,
        gaps: [],
      };
      const claim = await claimSheet(tx, {
        episodeId,
        kbVersionId: s.version.id,
        shortlist: empty,
        case: null,
        similar: [],
        retryAfterSeconds: 60,
      });
      if (!claim) throw new Error('no claim');
      const result = { status: 'unavailable' as const, reason: 'failed' as const, aiRunId: null };
      // A run whose claim was taken over writes nothing.
      expect(await finishSheet(tx, { id: claim.id, claimedAt: new Date(0) }, result)).toBe(false);
      expect(await finishSheet(tx, claim, result)).toBe(true);
    });
  });

  // AI-04: the recheck is its own run beside the first ranking, one paid call per set of findings.
  it('is rechecked with findings once per set, beside the first ranking', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const findings = ['Lachman test: Positive'];
      const recheck = {
        sheetId: s.sheetId,
        findings,
        by: s.visitConsultant.id,
        retryAfterSeconds: 60,
      };
      const held = await claimRecheck(tx, recheck);
      if (!held) throw new Error('no recheck claim');
      // One at a time: a second tap while it runs takes nothing.
      expect(await claimRecheck(tx, recheck)).toBeNull();
      const runId = await insertAiRun(tx, {
        kind: 'recheck_with_findings',
        episodeId: s.episodeId,
        kbVersionId: s.version.id,
        model: 'vendor/model-1',
        promptVersion: 'recheck_with_findings.v1',
        inputHash: 'b'.repeat(64),
        status: 'ok',
        attempts: 1,
        latencyMs: 700,
      });
      const ready = {
        status: 'ready' as const,
        aiRunId: runId,
        suggestions: [
          {
            conditionId: 'KNE-002',
            region: 'knee' as const,
            rowNumber: 4,
            rank: 1,
            section: 'top' as const,
            reason: 'Lachman positive',
          },
        ],
      };
      // A run whose claim was taken over writes nothing.
      expect(await finishRecheck(tx, { sheetId: s.sheetId, claimedAt: new Date(0) }, ready)).toBe(
        false,
      );
      expect(await finishRecheck(tx, { sheetId: s.sheetId, ...held }, ready)).toBe(true);
      expect(await finishRecheck(tx, { sheetId: s.sheetId, ...held }, ready)).toBe(false);
      // The same findings are never paid for twice; new findings are.
      expect(await claimRecheck(tx, recheck)).toBeNull();

      await becomeStaff(tx, s.visitConsultant);
      const sheet = await sheetForEpisode(tx, s.episodeId);
      expect(sheet?.suggestions.map((x) => x.conditionId)).toEqual(['KNE-001', 'KNE-002']);
      expect(sheet?.recheck).toMatchObject({ status: 'ready', reason: null, findings });
      expect(sheet?.recheck?.suggestions.map((x) => [x.conditionId, x.rank])).toEqual([
        ['KNE-002', 1],
      ]);
      // Kept or dismissed by the visit's consultant, like the first ranking.
      const rechecked = sheet?.recheck?.suggestions[0]?.id ?? '';
      expect(await setDisposition(tx, rechecked, 'kept', s.visitConsultant.id)).toBe(1);
      // Nobody signed in writes the recheck.
      expect(
        await failure(tx, (sp) =>
          sp.execute(
            sql`update ai_preparation_sheet set recheck_status = 'pending' where id = ${s.sheetId}`,
          ),
        ),
      ).toBe('42501');
      await asSystem(tx);
      expect(
        await claimRecheck(tx, { ...recheck, findings: ['Lachman test: Negative'] }),
      ).not.toBeNull();
    });
  });

  it('keeps a recheck whole: findings, author and moment with every status', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const broken = (set: string) =>
        failure(tx, (sp) =>
          sp.execute(sql`update ai_preparation_sheet set ${sql.raw(set)} where id = ${s.sheetId}`),
        );
      expect(await broken(`recheck_status = 'pending'`)).toBe('23514');
      const held = await claimRecheck(tx, {
        sheetId: s.sheetId,
        findings: ['Lachman test: Positive'],
        by: s.visitConsultant.id,
        retryAfterSeconds: 60,
      });
      if (!held) throw new Error('no recheck claim');
      expect(await broken(`recheck_status = 'unavailable', recheck_ready_at = now()`)).toBe(
        '23514',
      );
      expect(await broken(`recheck_reason = 'anything'`)).toBe('23514');
      expect(await broken(`recheck_findings = null`)).toBe('23514');
      expect(
        await finishRecheck(
          tx,
          { sheetId: s.sheetId, ...held },
          { status: 'unavailable', reason: 'not_configured', aiRunId: null },
        ),
      ).toBe(true);
      const sheet = await sheetForEpisode(tx, s.episodeId);
      expect(sheet?.recheck).toMatchObject({ status: 'unavailable', reason: 'not_configured' });
      expect(sheet?.recheck?.suggestions).toEqual([]);
    });
  });
});
