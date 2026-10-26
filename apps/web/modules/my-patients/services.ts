import 'server-only';
import {
  NoKnowledgeVersionError,
  colleaguesToday,
  contentVersion,
  myPatientsToday,
  openConsultation,
  sessionProgress,
  startVisit as startVisitRow,
  visitToStart,
  type ColleagueVisit,
  type MyPatientVisit,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  coversSessionsAt,
  istDate,
  sessionGate,
  sessionView,
  startVisitSchema,
  type SessionView,
} from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { SchedulingError, appointmentTarget } from '../scheduling/services';
import { SessionError, openSessionNote } from '../sessions/services';

/**
 * My patients today (CLN-01, Frontend Specification "Physiotherapist"): the signed in clinician's
 * own visits today, at every centre, in time order. Start marks a checked in visit In progress
 * ("With physio" on Today); only the appointment's own physio starts it, on its day (user
 * decision 24 October 2026). Start consultation also opens the consultation (CLN-02): only a
 * consultant starts one, and only once the health form has opened the episode (user decision 24
 * October 2026). Start session opens the session screen (SES-02).
 *
 * Cover between physios (SES-08, user decisions 26 October 2026): below their own visits, a
 * physio with the Treats patients tick sees their colleagues' visits today at the centres they
 * work at, and may start a colleague's checked in session there. The note is then theirs to write
 * and sign; the visit stays booked with its own physio and says who covered it.
 */

/**
 * A visit with, for a treatment session, its number and gate (SES-01), and who covered it when a
 * colleague started it (SES-08).
 */
export type MyPatientRow = MyPatientVisit & {
  session: SessionView | null;
  coveredBy: string | null;
};

/** A colleague's visit today, with its session's number and gate. */
export type ColleagueRow = ColleagueVisit & { session: SessionView | null };

export interface MyPatientsView {
  date: string;
  visits: MyPatientRow[];
  version: string;
}

/** The person's visits today and their fingerprint, for the live check. */
export async function loadMyPatients(actor: StaffMember): Promise<MyPatientsView> {
  assertMay(actor, 'visits.start');
  const date = istDate(new Date());
  const visits = await asStaff(actor, async (tx) => {
    const rows = await myPatientsToday(tx, { staffId: actor.id, date });
    const progress = await sessionProgress(
      tx,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      ...row,
      session: sessionView(progress.get(row.id)),
      coveredBy: row.startedBy && row.startedBy !== actor.id ? row.startedByName : null,
    }));
  });
  return { date, visits, version: contentVersion(visits) };
}

/** Colleagues' visits today at the centres the person works at, for cover (SES-08). */
export async function loadColleagues(actor: StaffMember): Promise<ColleagueRow[]> {
  assertMay(actor, 'visits.start');
  if (!actor.treatsPatients || actor.support) return [];
  const date = istDate(new Date());
  return asStaff(actor, async (tx) => {
    const rows = (await colleaguesToday(tx, { staffId: actor.id, date })).filter((row) =>
      coversSessionsAt(actor, row.centreId),
    );
    const progress = await sessionProgress(
      tx,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({ ...row, session: sessionView(progress.get(row.id)) }));
  });
}

/**
 * What Start opened: the consultation, the session screen of a treatment session, or the
 * episode's Review and discharge screen of a review (OUT-07).
 */
export interface StartedVisit {
  consultationId?: string;
  sessionAppointmentId?: string;
  reviewEpisodeId?: string;
}

export const HEALTH_FORM_NEEDED =
  'The health form is needed before the consultation. The front desk can open it on the tablet.';

/** Starts the consultation or session of a checked in patient (CLN-01, CLN-02). */
export const startVisit = staffService({
  action: 'visits.start',
  input: startVisitSchema,
  target: (input, tx) => appointmentTarget(tx, input.appointmentId),
  run: async (tx, input, actor): Promise<StartedVisit> => {
    const found = await visitToStart(tx, input.appointmentId);
    if (!found) throw new SchedulingError('That appointment was not found.');
    const session = (await sessionProgress(tx, [found.id])).get(found.id);
    // SES-08: a colleague at its centre covers a session; anything else is its own physio's.
    if (found.physioId !== actor.id && !(session && coversSessionsAt(actor, found.centreId))) {
      throw new SchedulingError('Only the physio of this appointment can start it.');
    }
    if (found.status === 'in_progress') {
      throw new SchedulingError('This visit has started already.');
    }
    if (found.status !== 'checked_in') throw new SchedulingError('Check the patient in first.');
    const now = new Date();
    if (istDate(found.startsAt) !== istDate(now)) {
      throw new SchedulingError('A visit is started on its own day.');
    }
    const consulting = found.typeKey === 'consultation';
    if (consulting && !can(actor, 'consultant_records.write')) {
      throw new SchedulingError('Only a consultant starts a consultation.');
    }
    if (consulting && !found.episodeId) throw new SchedulingError(HEALTH_FORM_NEEDED);
    // SES-01: a treatment session starts only once its gate is met.
    if (session) {
      const gate = sessionGate(session.episodeStatus);
      if (!gate.met) throw new SchedulingError(gate.message);
    }
    if (!(await startVisitRow(tx, { appointmentId: found.id, by: actor.id, now }))) {
      throw new SchedulingError('Check the patient in first.');
    }
    if (session && found.episodeId) {
      // SES-03: the session's note opens with it, prefilled.
      try {
        await openSessionNote(tx, { id: found.id, episodeId: found.episodeId, physioId: actor.id });
      } catch (error) {
        if (error instanceof SessionError) throw new SchedulingError(error.message);
        throw error;
      }
      return { sessionAppointmentId: found.id };
    }
    if (found.typeKey === 'review' && found.episodeId) return { reviewEpisodeId: found.episodeId };
    if (!consulting || !found.episodeId) return {};
    try {
      const consultationId = await openConsultation(tx, {
        appointmentId: found.id,
        episodeId: found.episodeId,
        physioId: actor.id,
      });
      return { consultationId };
    } catch (error) {
      if (error instanceof NoKnowledgeVersionError) {
        throw new SchedulingError(
          'The knowledge base is not loaded yet. Ask the Super Admin to import it.',
        );
      }
      throw error;
    }
  },
});
