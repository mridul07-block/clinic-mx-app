import { formatIstDate, formatIstDateTime, istDate } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { aiSheetView } from '../../../../../modules/ai/switch';
import { AiSwitchForm } from './ai-switch-form';

export const metadata: Metadata = { title: 'AI preparation sheet · Clinic Mx' };

// The AI on and off gate (AI-09, PRD decision 23): the AI preparation sheet stays off until the
// Super Admin records the blind test pass and the legal clearance. Switched on for the live
// knowledge base version; a newer live version switches it off until a new blind test.
export default async function AiPreparationSheetPage() {
  const staff = await requirePermission('settings.manage');
  const view = await aiSheetView(staff);
  const { state, setting } = view;
  const recorded = setting?.on ? setting : null;

  let status: string;
  if (state.on && recorded) {
    status = `On since ${formatIstDateTime(new Date(recorded.since))}, for knowledge base version ${String(state.kbVersionNumber)}`;
  } else if (!state.on && state.reason === 'knowledge_base_changed') {
    status = `Off: knowledge base version ${String(view.live?.number ?? '')} went live after the blind test on version ${String(state.switchedOnFor ?? '')}. Record a new blind test to switch on again.`;
  } else if (!state.on && state.reason === 'no_knowledge_base') {
    status = 'Off: no knowledge base is imported.';
  } else {
    status = 'Off';
  }

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">AI preparation sheet</h1>
        <p className="text-ink-secondary">
          The AI suggestions consultants read before a consultation. They stay off until the blind
          test on Movementology cases has passed and the legal check on diagnosis suggestion
          software has cleared. Consultations work as usual while they are off.
        </p>
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="ai-status-heading">
        <h2 id="ai-status-heading" className="font-semibold text-ink">
          Status
        </h2>
        <p className="text-ink" data-testid="ai-sheet-status">
          {status}
        </p>
        {recorded ? (
          <dl
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
            data-testid="ai-sheet-records"
          >
            <dt className="text-ink-muted">Blind test</dt>
            <dd className="text-ink">
              {formatIstDate(recorded.blindTest.date)}, {recorded.blindTest.reference}
            </dd>
            <dt className="text-ink-muted">Legal check</dt>
            <dd className="text-ink">
              {formatIstDate(recorded.legalCheck.date)}, {recorded.legalCheck.reference}
            </dd>
          </dl>
        ) : null}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="ai-switch-heading">
        <h2 id="ai-switch-heading" className="font-semibold text-ink">
          {view.choices.switchOn ? 'Switch on' : 'Switch off'}
        </h2>
        {staff.support ? (
          <FormMessage tone="info">Velyx support access is read only.</FormMessage>
        ) : (
          <AiSwitchForm choices={view.choices} today={istDate(new Date())} />
        )}
      </section>
    </main>
  );
}
