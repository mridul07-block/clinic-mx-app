import 'server-only';
import {
  NoKnowledgeVersionError,
  contentVersion,
  myPatientsToday,
  openConsultation,
  sessionProgress,
  startVisit as startVisitRow,
  visitToStart,
  type MyPatientVisit,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
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

/**
 * My patients today (CLN-01, Frontend Specification "Physiotherapist"): the signed in clinician's
 * own visits today, at every centre, in time order. Start marks a checked in visit In progress
 * ("With physio" on Today); only the appointment's own physio starts it, on its day (user
 * decision 24 October 2026). Start consultation also opens the consultation (CLN-02): only a
 * consultant starts one, and only once the health form has opened the episode (user decision 24
 * October 2026). The session screen opens from Start session with SES-03.
 */

/** A visit with, for a treatment session, its number and gate (SES-01). */
export type MyPatientRow = MyPatientVisit & { session: SessionView | null };

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
    return rows.map((row) => ({ ...row, session: sessionView(progress.get(row.id)) }));
  });
  return { date, visits, version: contentVersion(visits) };
}

/** What Start opened: the consultation, for a consultation; nothing yet for a session. */
export interface StartedVisit {
  consultationId?: string;
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
    if (found.physioId !== actor.id) {
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
    const session = (await sessionProgress(tx, [found.id])).get(found.id);
    if (session) {
      const gate = sessionGate(session.episodeStatus);
      if (!gate.met) throw new SchedulingError(gate.message);
    }
    if (!(await startVisitRow(tx, { appointmentId: found.id, by: actor.id, now }))) {
      throw new SchedulingError('Check the patient in first.');
    }
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
