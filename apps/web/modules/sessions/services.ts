import 'server-only';
import {
  addSessionAddendum as addSessionAddendumRow,
  episodePrecautions,
  episodeRecord,
  lastSignedSessionNote,
  latestKnowledgeVersion,
  logClinicalView,
  newestPlanOfCareId,
  nextVisitOf,
  openSession,
  patientAlertHistory,
  planForSession,
  recordBaseline,
  recordReassessment,
  saveSessionNote as saveSessionNoteRow,
  sessionAddenda,
  sessionAdherence,
  sessionModalities,
  sessionNoteById,
  sessionNoteOf,
  sessionProgress,
  sessionVisit,
  signSession,
  staffTreatsNow,
  type AddendumEntry,
  type DbOrTransaction,
  type NextVisitEntry,
  type SessionVisit,
  type StaffMember,
} from '@clinic-mx/db';
import {
  adherenceSnapshotSchema,
  baselineRecordings,
  reassessmentRecordings,
  can,
  closeSessionSchema,
  coversSessionsAt,
  modalityWarnings,
  prefilledSessionNote,
  readSessionNote,
  saveSessionNoteSchema,
  sessionAddendumSchema,
  sessionNoteBlockers,
  sessionView,
  worksAtCentre,
  type AdherenceSnapshot,
  type DraftSaveResponse,
  type InterventionKind,
  type SessionModality,
  type SessionNote,
  type SessionView,
  phaseNotSetUp,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';
import { asStaffViewing } from '../access/staff-db';
import { episodePhaseLine } from '../phases/phases';
import { episodeSummary, recordNotes, type PatientSummary } from '../patients/record';
import { baselineView, workedOutBaseline, type BaselineView } from './baseline';
import { reassessedItems, reassessmentView, type ReassessmentView } from './reassessment';
import { getSetting } from '../settings/settings';

/**
 * The session screen (SES-02, PRD J5.2; docs/runbooks/sessions.md): the treating physio's summary
 * card for a Session or Zero Gravity Treadmill appointment, from the signed plan of its episode,
 * with no AI sheet. Only the appointment's own physio opens it, and the Super Admin reads it (user
 * decision 25 October 2026; cover between physios is SES-08). Each open is logged as a record
 * view. Row level security holds the same reads: nobody outside the centre reads any of it.
 *
 * Under the card, the session note (SES-03, PRD J5.4 and J5.5; user decisions 26 October 2026):
 * opened by Start session, written by the appointment's physio with autosave, and signed by Close
 * session, which completes the visit, uses a package session and gives the consultant a task for
 * new symptoms (the database does those, `internal.session_closed`). Session 1 also records the
 * episode's baseline (OUT-01, `./baseline`): its signing freezes it. The reassessment session
 * measures it again for the consultant to review (OUT-05, `./reassessment`).
 *
 * A signed note changes only by addenda (CLN-12 follow up, user decisions 26 October 2026), added
 * here or on the patient record's Notes as for a consultation: the Treats patients tick, at the
 * episode's centre or on one's own note.
 */

/** Why a session note was refused, for the screen. */
export class SessionError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_found' | 'signed' | 'refused' | 'stale',
  ) {
    super(message);
    this.name = 'SessionError';
  }
}

/** The note on the session screen, with what its form needs from the plan. */
export interface SessionNoteView {
  /** The session's own id. */
  id: string;
  value: SessionNote;
  version: number;
  signed: { by: string; at: Date } | null;
  /** The physio writes it: their own draft, with session_notes.write. */
  editable: boolean;
  /**
   * The episode's previous signed note, for "Same as last time" (SES-04); only while the physio
   * writes this one.
   */
  lastTime: { number: number; signedAt: Date; note: SessionNote } | null;
  /**
   * Every modality at the note's knowledge base version, with its parameters and the episode's
   * precautions it warns about (SES-05).
   */
  modalities: SessionModality[];
  /** Once signed, its addenda, and whether the reader may add one. */
  addenda: AddendumEntry[];
  addsAddenda: boolean;
  plan: {
    interventions: InterventionKind[];
    modalities: { key: string; name: string }[];
    homeProgramme: { exercise: string; dose: string; note: string }[];
  };
  /**
   * Home exercise adherence (PAT-02): worked out now while a draft, as kept at signing once
   * signed; null without a plan, or for a note signed before PAT-02.
   */
  adherence: AdherenceSnapshot | null;
  /** Session 1's baseline (OUT-01); null for any other session. */
  baseline: BaselineView | null;
  /** The reassessment session's section (OUT-05); null for any other session. */
  reassessment: ReassessmentView | null;
}

export interface SessionScreen {
  visit: SessionVisit;
  session: SessionView;
  /** The appointment's own episode's card; undefined outside an episode. */
  summary: PatientSummary | undefined;
  nextVisit: NextVisitEntry | undefined;
  /** Anyone but the note's writer: the booked physio, a colleague, the Super Admin. */
  readOnly: boolean;
  /** Who writes the note: whoever started it, else the booked physio (SES-08). */
  writerName: string;
  /** The colleague who covered it, when not the booked physio (SES-08). */
  coveredBy: string | null;
  /** The note, once Start session opened it. */
  note: SessionNoteView | undefined;
  /** The summary card's phase line (OUT-04). */
  phase: string;
}

/**
 * The modalities of a knowledge base version as the note records them (SES-05), each with the
 * episode's signed precautions it warns about (as the plan's own check, `modalityWarnings`).
 */
async function noteModalities(
  tx: DbOrTransaction,
  kbVersionId: string,
  episodeId: string,
): Promise<SessionModality[]> {
  const inForce = (await episodePrecautions(tx, episodeId)).map((precaution) => ({
    ...precaution,
    by: 'clinician' as const,
  }));
  return (await sessionModalities(tx, kbVersionId)).map((modality) => ({
    key: modality.key,
    name: modality.name,
    parameters: modality.parameters,
    warnings: modalityWarnings({ ...modality, signedOff: false }, inForce).map((warning) => ({
      label: warning.label,
      source: warning.source,
    })),
  }));
}

/**
 * Opens the note of a session the physio has just started (SES-03), once: the treatment given last
 * time in the episode, or the plan's for the first session. Run inside Start session.
 */
export async function openSessionNote(
  tx: DbOrTransaction,
  visit: { id: string; episodeId: string; physioId: string },
): Promise<string> {
  const version = await latestKnowledgeVersion(tx);
  if (!version) {
    throw new SessionError(
      'The knowledge base is not loaded yet. Ask the Super Admin to import it.',
      'refused',
    );
  }
  const last = await lastSignedSessionNote(tx, visit.episodeId);
  let from: Parameters<typeof prefilledSessionNote>[0];
  if (last) {
    from = { lastNote: readSessionNote(last.note) };
  } else {
    const planId = await newestPlanOfCareId(tx, visit.episodeId);
    const plan = planId ? await planForSession(tx, planId) : undefined;
    if (plan) {
      from = {
        plan: {
          interventions: plan.interventions,
          modalities: plan.modalities.map((modality) => modality.key),
        },
      };
    }
  }
  return openSession(tx, {
    appointmentId: visit.id,
    physioId: visit.physioId,
    kbVersionId: version.id,
    note: prefilledSessionNote(from),
  });
}

/**
 * The session screen of an appointment; undefined when it is not found or not a session. Its
 * note's writer edits it; the booked physio, colleagues with the Treats patients tick at its
 * centre (SES-08) and the Super Admin read it; anyone else is refused.
 */
export async function loadSession(
  actor: StaffMember,
  appointmentId: string,
  now: Date = new Date(),
): Promise<SessionScreen | undefined> {
  if (!can(actor, 'clinical.read')) throw new NotAllowedError();
  return asStaffViewing(actor, async (tx) => {
    const visit = await sessionVisit(tx, appointmentId);
    if (!visit) return undefined;
    const session = sessionView((await sessionProgress(tx, [visit.id])).get(visit.id));
    if (!session) return undefined;
    const stored = await sessionNoteOf(tx, visit.id);
    const writer = stored?.physioId ?? visit.startedBy ?? visit.physioId;
    const own = writer === actor.id;
    const reads =
      own ||
      visit.physioId === actor.id ||
      coversSessionsAt(actor, visit.centreId) ||
      (actor.role === 'super_admin' && !actor.support);
    if (!reads) throw new NotAllowedError();
    const episode = visit.episodeId ? await episodeRecord(tx, visit.episodeId) : undefined;
    const summary =
      episode &&
      (await episodeSummary(
        tx,
        episode,
        await recordNotes(tx, actor, visit.patientId),
        await patientAlertHistory(tx, visit.patientId),
      ));
    const nextVisit = await nextVisitOf(tx, visit.patientId, now);
    const plan = stored?.planOfCareId ? await planForSession(tx, stored.planOfCareId) : undefined;
    const signed = stored?.status === 'signed';
    const editable = own && stored?.status === 'draft' && can(actor, 'session_notes.write');
    const last = editable ? await lastSignedSessionNote(tx, stored.episodeId) : undefined;
    const note: SessionNoteView | undefined = stored && {
      id: stored.id,
      value: readSessionNote(stored.note),
      version: stored.version,
      signed:
        stored.signedAt && stored.signedByName
          ? { by: stored.signedByName, at: stored.signedAt }
          : null,
      editable,
      lastTime: last
        ? { number: last.number, signedAt: last.signedAt, note: readSessionNote(last.note) }
        : null,
      modalities: await noteModalities(tx, stored.kbVersionId, stored.episodeId),
      addenda: signed ? await sessionAddenda(tx, stored.id) : [],
      addsAddenda:
        signed &&
        actor.treatsPatients &&
        !actor.support &&
        (own || worksAtCentre(actor, stored.centreId)),
      plan: plan ?? { interventions: [], modalities: [], homeProgramme: [] },
      adherence: signed
        ? readSessionNote(stored.note).adherence
        : await adherenceNow(tx, stored.id),
      baseline: await baselineView(tx, stored),
      reassessment: await reassessmentView(tx, stored),
    };
    await logClinicalView(tx, 'patient', visit.patientId);
    const covered = visit.startedBy !== null && visit.startedBy !== visit.physioId;
    return {
      visit,
      session,
      summary,
      nextVisit,
      readOnly: !own,
      writerName: (covered ? visit.startedByName : null) ?? visit.physioName,
      coveredBy: covered ? visit.startedByName : null,
      note,
      phase: episode ? await episodePhaseLine(tx, episode.id) : phaseNotSetUp,
    };
  });
}

/** The caller's own draft note of an appointment, or a refusal. */
async function ownDraft(tx: DbOrTransaction, appointmentId: string, actor: StaffMember) {
  const found = await sessionNoteOf(tx, appointmentId);
  if (!found || found.physioId !== actor.id) {
    throw new SessionError('That session was not found.', 'not_found');
  }
  if (found.status === 'signed') {
    throw new SessionError('This session is closed. Its note is signed.', 'signed');
  }
  return found;
}

/** A session's adherence as it stands now (PAT-02); null without a plan. */
async function adherenceNow(
  tx: DbOrTransaction,
  sessionId: string,
): Promise<AdherenceSnapshot | null> {
  const raw = await sessionAdherence(tx, sessionId);
  return raw === null ? null : adherenceSnapshotSchema.parse(raw);
}

/**
 * Autosave of the note (FND-08): the physio's own draft, only at the version they saw. Adherence
 * is never typed: a draft holds none, and signing keeps the figure as it then stands (PAT-02).
 */
export const saveSessionNote = staffService({
  action: 'session_notes.write',
  input: saveSessionNoteSchema,
  run: async (tx, input, actor): Promise<DraftSaveResponse<SessionNote>> => {
    const found = await ownDraft(tx, input.appointmentId, actor);
    const saved = await saveSessionNoteRow(tx, found.id, input.baseVersion, {
      ...input.value,
      adherence: null,
    });
    if (saved.status === 'saved') return saved;
    return {
      status: 'conflict',
      version: saved.version,
      value: readSessionNote(saved.row.note),
    };
  },
});

/**
 * Close session (SES-03, PRD J5.5): signs the physio's own note at the version they saw, once
 * nothing holds it back, with the Treats patients tick read now. The database then completes the
 * visit, uses a session of the episode's active package and raises any new symptoms task.
 */
export const closeSession = staffService({
  action: 'session_notes.write',
  input: closeSessionSchema,
  run: async (tx, input, actor): Promise<{ status: 'signed' }> => {
    const found = await ownDraft(tx, input.appointmentId, actor);
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new SessionError('Closing a session needs the Treats patients tick.', 'refused');
    }
    if (found.version !== input.baseVersion) {
      throw new SessionError('Your latest changes are still saving. Try again.', 'stale');
    }
    const note = readSessionNote(found.note);
    // Session 1 records the baseline (OUT-01), worked out again here as the signing sees it.
    const baseline = found.number === 1 ? await workedOutBaseline(tx, found) : undefined;
    // The reassessment session measures the baseline's measures again (OUT-05).
    const reassessed =
      found.number === (await getSetting('clinical.reassessment_session'))
        ? (await reassessedItems(tx, found.episodeId, found.kbVersionId)).map((i) => i.measure)
        : [];
    const blockers = sessionNoteBlockers(
      note,
      await noteModalities(tx, found.kbVersionId, found.episodeId),
      baseline?.missing,
      reassessed,
    );
    if (blockers.length > 0) throw new SessionError(blockers.join(' '), 'refused');
    const { rest, activity, after } = note.pain;
    if (rest === null || activity === null || after === null) {
      throw new SessionError('Set the three pain readings.', 'refused');
    }
    // The adherence kept with the note (PAT-02), so the signed note never changes.
    const kept = await saveSessionNoteRow(tx, found.id, input.baseVersion, {
      ...note,
      adherence: await adherenceNow(tx, found.id),
    });
    if (kept.status !== 'saved') {
      throw new SessionError('Your latest changes are still saving. Try again.', 'stale');
    }
    const signed = await signSession(tx, {
      sessionId: found.id,
      baseVersion: kept.version,
      by: actor.id,
      pain: { rest, activity, after },
    });
    if (signed === 'stale') {
      throw new SessionError('Your latest changes are still saving. Try again.', 'stale');
    }
    if (baseline) {
      await recordBaseline(tx, {
        sessionId: found.id,
        episodeId: found.episodeId,
        kbVersionId: found.kbVersionId,
        by: actor.id,
        reused: baseline.reused.map((r) => ({
          key: r.measure.key,
          consultationId: r.consultationId,
        })),
        recordings: baselineRecordings(note.baseline, baseline.missing),
      });
    }
    if (reassessed.length > 0) {
      await recordReassessment(tx, {
        sessionId: found.id,
        episodeId: found.episodeId,
        kbVersionId: found.kbVersionId,
        by: actor.id,
        ...reassessmentRecordings(note.reassessment, reassessed),
      });
    }
    return { status: 'signed' };
  },
});

/**
 * Adds an addendum to a signed session note (CLN-12 follow up), with the Treats patients tick read
 * now. Row level security decides the centre: the episode's, or the writer's own note.
 */
export const addSessionAddendum = staffService({
  action: 'clinical.read',
  input: sessionAddendumSchema,
  run: async (tx, input, actor): Promise<{ id: string; appointmentId: string }> => {
    const found = await sessionNoteById(tx, input.sessionId);
    if (!found) throw new SessionError('That session was not found.', 'not_found');
    if (found.status !== 'signed') {
      throw new SessionError('Addenda are added once the session is closed.', 'refused');
    }
    if (!(await staffTreatsNow(tx, actor.id))) {
      throw new SessionError('Adding an addendum needs the Treats patients tick.', 'refused');
    }
    const added = await addSessionAddendumRow(tx, {
      sessionId: found.id,
      episodeId: found.episodeId,
      text: input.text,
      authorId: actor.id,
    });
    return { id: added.id, appointmentId: found.appointmentId };
  },
});
