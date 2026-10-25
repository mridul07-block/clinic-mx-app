import 'server-only';
import {
  episodeRecord,
  logClinicalView,
  nextVisitOf,
  patientAlertHistory,
  sessionProgress,
  sessionVisit,
  type NextVisitEntry,
  type SessionVisit,
  type StaffMember,
} from '@clinic-mx/db';
import { can, sessionView, type SessionView } from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { asStaffViewing } from '../access/staff-db';
import { episodeSummary, recordNotes, type PatientSummary } from '../patients/record';

/**
 * The session screen (SES-02, PRD J5.2; docs/runbooks/sessions.md): the treating physio's summary
 * card for a Session or Zero Gravity Treadmill appointment, from the signed plan of its episode,
 * with no AI sheet. Only the appointment's own physio opens it, and the Super Admin reads it (user
 * decision 25 October 2026; cover between physios is SES-08). Each open is logged as a record
 * view. Row level security holds the same reads: nobody outside the centre reads any of it.
 */

export interface SessionScreen {
  visit: SessionVisit;
  session: SessionView;
  /** The appointment's own episode's card; undefined outside an episode. */
  summary: PatientSummary | undefined;
  nextVisit: NextVisitEntry | undefined;
  /** The Super Admin reading another physio's session. */
  readOnly: boolean;
}

/**
 * The session screen of an appointment; undefined when it is not found or not a session. Refuses
 * anyone but its physio and the Super Admin.
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
    const own = visit.physioId === actor.id;
    if (!own && !(actor.role === 'super_admin' && !actor.support)) throw new NotAllowedError();
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
    await logClinicalView(tx, 'patient', visit.patientId);
    return { visit, session, summary, nextVisit, readOnly: !own };
  });
}
