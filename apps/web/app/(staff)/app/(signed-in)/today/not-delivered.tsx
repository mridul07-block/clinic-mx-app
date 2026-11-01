import { ChevronRight, PhoneMissed } from 'lucide-react';
import type { UndeliveredMessage } from '@clinic-mx/db';
import { formatIstDateTime, messageLabel, undeliveredReason } from '@clinic-mx/schemas';
import Link from 'next/link';
import { secondaryButtonClass } from '../../../../../components/forms';
import { markUndeliveredDoneAction } from '../../../../../modules/messaging/undelivered-actions';

/**
 * "Not delivered" (WA-13): the centre's WhatsApp messages Meta could not deliver, newest first,
 * each with the patient, which message, when and why; Done once the desk has called them. Hidden
 * when there are none. Amber, not red (design system v3: needs attention, not an emergency), and
 * folded to its heading so the day's board stays the first thing on the screen (UIX-13).
 */
export function NotDelivered({
  messages,
  centreId,
  show,
}: {
  messages: UndeliveredMessage[];
  centreId: string;
  show?: string;
}) {
  if (messages.length === 0) return null;
  return (
    <section
      aria-labelledby="not-delivered-heading"
      data-testid="not-delivered"
      className="flex flex-col gap-2 rounded-panel border border-waiting-line bg-waiting-soft px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <PhoneMissed
          aria-hidden
          size={18}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-waiting"
        />
        <div className="flex flex-col gap-0.5">
          <h2 id="not-delivered-heading" className="font-semibold text-waiting">
            Not delivered ({messages.length})
          </h2>
          <p className="text-sm text-ink-secondary">
            WhatsApp could not reach these patients. Call them, then mark each Done.
          </p>
        </div>
      </div>
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            size={16}
            strokeWidth={1.75}
            className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          {messages.length === 1
            ? 'Show the patient'
            : `Show the ${String(messages.length)} patients`}
        </summary>
        <ul className="mt-1 flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
          {messages.map((message) => (
            <li
              key={message.id}
              data-testid="not-delivered-item"
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={['/app/patients', message.patientId].join('/')}
                  className="font-medium break-words text-ink underline-offset-2 hover:underline"
                >
                  {message.patientName}
                  {message.patientNumber ? (
                    <span className="font-mono text-sm text-ink-muted">
                      {' · '}
                      {message.patientNumber}
                    </span>
                  ) : null}
                </Link>
                <span className="text-sm text-ink-secondary">
                  {messageLabel(message.templateKey)} · {formatIstDateTime(message.failedAt)}
                </span>
                <span className="text-sm text-ink" data-testid="not-delivered-reason">
                  {undeliveredReason(message.errorCode)}
                </span>
              </div>
              <form action={markUndeliveredDoneAction} className="shrink-0">
                <input type="hidden" name="messageId" value={message.id} />
                <input type="hidden" name="centreId" value={centreId} />
                {show ? <input type="hidden" name="show" value={show} /> : null}
                <button
                  type="submit"
                  className={`${secondaryButtonClass} w-full sm:w-auto`}
                  aria-label={['Done: called', message.patientName].join(' ')}
                >
                  Done
                </button>
              </form>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
