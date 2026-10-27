import type { Metadata } from 'next';
import { requireStaff } from '../../../../../../modules/auth/session';
import { feedbackDashboard } from '../../../../../../modules/reporting/manager';

export const metadata: Metadata = { title: 'Feedback · Dashboard · Clinic Mx' };

// Feedback (DSH-03): the recommendation score, themes and open complaints arrive with the patient
// feedback tickets (PAT-04, PAT-07, PAT-08); until then the page says so.
export default async function DashboardFeedbackPage() {
  const view = await feedbackDashboard(await requireStaff());
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-secondary" data-testid="feedback-empty">
        Feedback starts when patients are asked for it after their consultation and at discharge.
        The recommendation score, the themes of what they say and any open complaints will show
        here.
      </p>
      <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
        {view.figures.map((figure) => (
          <li key={figure.label} className="flex flex-col gap-1 p-4">
            <span className="font-medium text-ink">{figure.label}</span>
            {figure.target ? (
              <span className="text-sm text-ink-secondary">Target: {figure.target}</span>
            ) : null}
            <span className="text-sm text-ink-muted">Not measured yet: {figure.needs}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
