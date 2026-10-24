import type { AlertHistoryEntry, EpisodeEntry } from '@clinic-mx/db';
import {
  dischargeReasonLabels,
  episodeStatusLabels,
  formatIstDate,
  formatIstDateTime,
  interventionLabels,
  irritabilityLabels,
  istDate,
  redFlagAlertStatusLabels,
  redFlagTriageLabels,
  screeningRegionLabels,
  stageLabels,
  type AlertDisplay,
  type EpisodeStatus,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import Link from 'next/link';
import { Tag } from '../../../../../../components/tag';
import type {
  ClinicalRecord,
  PatientSummary,
  RecordNote,
} from '../../../../../../modules/patients/record';
import { Addenda } from '../../consultations/[consultationId]/addenda';

// SCH-03: one tone per episode status (design system v2: a word always; amber only for "needs
// attention"; danger stays for the emergency banner).
export const episodeTone = {
  intake_pending: 'outline',
  awaiting_consultation: 'info',
  on_hold: 'waiting',
  plan_proposed: 'info',
  active: 'active',
  under_review: 'waiting',
  discharged: 'done',
  lost_to_follow_up: 'neutral',
} as const satisfies Record<EpisodeStatus, Tone>;

// As the Alerts page (ALT-01): red for an emergency, amber for a review.
const displayTone: Record<AlertDisplay, Tone> = {
  emergency: 'danger',
  review: 'waiting',
  information: 'neutral',
};

const panelClass = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-4';

/** One episode's heading: region, status, centre and dates, and the discharge reason. */
export function EpisodeHeading({ episode }: { episode: EpisodeEntry }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink">
          {episode.bodyRegion
            ? screeningRegionLabels[episode.bodyRegion]
            : 'Region not recorded yet'}
        </span>
        <Tag tone={episodeTone[episode.status]}>{episodeStatusLabels[episode.status]}</Tag>
      </span>
      <span className="text-sm text-ink-secondary">
        {episode.centreName ?? 'Another centre'} · opened {formatIstDate(istDate(episode.openedAt))}
        {episode.closedAt ? ` · closed ${formatIstDate(istDate(episode.closedAt))}` : null}
      </span>
      {episode.dischargeReason ? (
        <span className="text-sm text-ink-secondary">
          {dischargeReasonLabels[episode.dischargeReason]}
          {episode.dischargeNote ? `: ${episode.dischargeNote}` : null}
        </span>
      ) : null}
    </div>
  );
}

function DiagnosisLine({ note }: { note: RecordNote }) {
  if (!note.diagnosis) return null;
  const { conditionName, conditionId, movementDx, irritability, stage, provisional } =
    note.diagnosis;
  return (
    <p className="text-ink">
      <span className="font-medium">{conditionName ?? conditionId}</span>
      {provisional ? ' (provisional)' : null}
      <span className="text-ink-secondary">
        {' '}
        · {movementDx} · {irritabilityLabels[irritability]} irritability · {stageLabels[stage]}
      </span>
    </p>
  );
}

/**
 * The summary card (CLN-12; Frontend Specification principle 2, red flags and precautions first):
 * the current episode's open alerts and precautions, then its signed diagnosis and plan, the last
 * signed note and the next visit.
 */
export function SummaryCard({
  patientId,
  summary,
  nextVisit,
}: {
  patientId: string;
  summary: PatientSummary | undefined;
  nextVisit: ClinicalRecord['nextVisit'];
}) {
  if (!summary) {
    return (
      <section aria-labelledby="summary" className={panelClass} data-testid="summary-card">
        <h2 id="summary" className="font-semibold text-ink">
          Summary
        </h2>
        <p className="text-ink-muted">No episodes yet. Booking a consultation opens one.</p>
      </section>
    );
  }
  const { episode, plan, precautions, lastNote, openAlerts } = summary;
  return (
    <section aria-labelledby="summary" className={panelClass} data-testid="summary-card">
      <h2 id="summary" className="font-semibold text-ink">
        Summary
      </h2>
      {openAlerts > 0 ? (
        <Link
          href={`/app/patients/${patientId}?tab=alerts`}
          data-testid="summary-alerts"
          className="flex flex-col gap-0.5 rounded-control border border-waiting-line bg-waiting-soft px-3 py-2.5 font-semibold text-waiting-strong underline-offset-2 hover:underline"
        >
          {openAlerts === 1
            ? '1 open red flag alert'
            : `${String(openAlerts)} open red flag alerts`}
        </Link>
      ) : null}
      <div className="flex flex-col gap-1" data-testid="summary-precautions">
        <h3 className="text-sm font-medium text-ink-secondary">Precautions</h3>
        {precautions.length === 0 ? (
          <p className="text-ink-muted">None recorded.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {precautions.map((item) => (
              <li key={item.key}>
                <Tag tone="waiting">{item.label}</Tag>
              </li>
            ))}
          </ul>
        )}
      </div>
      <EpisodeHeading episode={episode} />
      {lastNote ? (
        <>
          <div className="flex flex-col gap-1" data-testid="summary-diagnosis">
            <h3 className="text-sm font-medium text-ink-secondary">Diagnosis</h3>
            {lastNote.diagnosis ? <DiagnosisLine note={lastNote} /> : <p>Not recorded.</p>}
          </div>
          {plan ? (
            <div className="flex flex-col gap-1" data-testid="summary-plan">
              <h3 className="text-sm font-medium text-ink-secondary">Plan of care</h3>
              {plan.goals.length > 0 ? (
                <ul className="list-disc pl-5">
                  {plan.goals.map((goal, index) => (
                    <li key={[index, goal.text].join('-')}>
                      {goal.text}
                      {goal.patient ? (
                        <span className="text-sm text-ink-muted"> (the patient&apos;s goal)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-ink-secondary">
                {plan.sessionsPerWeek && plan.weeks
                  ? `${String(plan.sessionsPerWeek)} a week for ${String(plan.weeks)} weeks`
                  : 'Frequency not set'}
                {' · review '}
                {formatIstDate(plan.reviewDate)}
                {plan.treatingPhysioName ? ` · treating physio ${plan.treatingPhysioName}` : null}
              </p>
              {plan.interventions.length > 0 ? (
                <p className="text-ink-secondary">
                  {plan.interventions.map((kind) => interventionLabels[kind]).join(', ')}
                  {plan.modalities.length > 0 ? `: ${plan.modalities.join(', ')}` : null}
                </p>
              ) : null}
              {plan.homeExercises > 0 ? (
                <p className="text-sm text-ink-muted">
                  Home programme of {plan.homeExercises}{' '}
                  {plan.homeExercises === 1 ? 'exercise' : 'exercises'}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-sm text-ink-secondary">
            Last signed note {formatIstDateTime(lastNote.signedAt)}
            {lastNote.signedByName ? ` by ${lastNote.signedByName}` : null}
          </p>
        </>
      ) : (
        <p className="text-ink-muted">No signed consultation yet.</p>
      )}
      <p className="text-sm text-ink-secondary" data-testid="summary-next-visit">
        {nextVisit
          ? `Next visit ${formatIstDateTime(nextVisit.startsAt)} · ${nextVisit.typeName}${
              nextVisit.physioName ? ` with ${nextVisit.physioName}` : ''
            }${nextVisit.centreName ? ` · ${nextVisit.centreName}` : ''}`
          : 'No visit booked.'}
      </p>
    </section>
  );
}

/** Each episode with its signed notes, newest first; each note opens to its addenda (CLN-12). */
export function NotesTab({
  patientId,
  episodes,
  notes,
}: {
  patientId: string;
  episodes: EpisodeEntry[];
  notes: RecordNote[];
}) {
  if (episodes.length === 0) {
    return <p className="text-ink-muted">No episodes yet. Booking a consultation opens one.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {episodes.map((episode) => {
        const own = notes.filter((note) => note.episodeId === episode.id);
        return (
          <li key={episode.id} data-testid="episode" className={panelClass}>
            <EpisodeHeading episode={episode} />
            {own.length === 0 ? (
              <p className="text-sm text-ink-muted">No signed notes yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {own.map((note) => (
                  <li
                    key={note.id}
                    data-testid="signed-note"
                    className="flex flex-col gap-2 rounded-control border border-line p-3"
                  >
                    <p className="font-medium text-ink">
                      Consultation · {formatIstDateTime(note.signedAt)}
                      {note.signedByName ? ` · ${note.signedByName}` : null}
                    </p>
                    <DiagnosisLine note={note} />
                    <Link
                      href={`/app/consultations/${note.id}`}
                      className="self-start text-accent underline underline-offset-2 pointer-coarse:py-3"
                    >
                      Open note
                    </Link>
                    <details>
                      <summary className="cursor-pointer text-accent pointer-coarse:py-3">
                        Addenda ({note.addenda.length})
                      </summary>
                      <div className="mt-3">
                        <Addenda
                          consultationId={note.id}
                          addenda={note.addenda}
                          adds={note.addsAddenda}
                          patientId={patientId}
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AlertItem({ alert, opensAlerts }: { alert: AlertHistoryEntry; opensAlerts: boolean }) {
  const steps = [
    { label: 'Raised', at: alert.raisedAt, by: null },
    alert.reviewedAt && { label: 'Reviewed', at: alert.reviewedAt, by: alert.reviewedBy },
    alert.referredAt && {
      label: `Referred to ${alert.referredTo ?? ''}`,
      at: alert.referredAt,
      by: alert.referredBy,
    },
    alert.closedAt && { label: 'Closed', at: alert.closedAt, by: alert.closedBy },
  ].filter((step) => step !== null);
  return (
    <li data-testid="record-alert" data-status={alert.status} className={panelClass}>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{alert.name}</span>
        <Tag tone={displayTone[alert.display]}>{redFlagTriageLabels[alert.triage]}</Tag>
        <Tag tone={alert.status === 'closed' ? 'done' : 'outline'}>
          {redFlagAlertStatusLabels[alert.status]}
        </Tag>
      </span>
      <ol className="flex flex-col gap-1 border-l-2 border-line pl-3 text-sm text-ink-secondary">
        {steps.map((step) => (
          <li key={step.label}>
            <span className="font-medium text-ink">{step.label}</span> ·{' '}
            {formatIstDateTime(step.at)}
            {step.by ? ` · ${step.by}` : ''}
          </li>
        ))}
      </ol>
      {alert.decision ? (
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink">Decision: </span>
          {alert.decision}
        </p>
      ) : null}
      {opensAlerts && alert.status !== 'closed' ? (
        <Link
          href="/app/alerts"
          className="self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3"
        >
          Open in Alerts
        </Link>
      ) : null}
    </li>
  );
}

/** The patient's red flag alerts at every centre: open ones first, then closed, newest first. */
export function AlertsTab({
  alerts,
  opensAlerts,
}: {
  alerts: AlertHistoryEntry[];
  /** Whether the reader acts on this alert in the Alerts list (red_flags.act at its centre). */
  opensAlerts: (alert: AlertHistoryEntry) => boolean;
}) {
  if (alerts.length === 0) return <p className="text-ink-muted">No red flag alerts.</p>;
  const ordered = [
    ...alerts.filter((alert) => alert.status !== 'closed'),
    ...alerts.filter((alert) => alert.status === 'closed'),
  ];
  return (
    <ul className="flex flex-col gap-3">
      {ordered.map((alert) => (
        <AlertItem key={alert.id} alert={alert} opensAlerts={opensAlerts(alert)} />
      ))}
    </ul>
  );
}
