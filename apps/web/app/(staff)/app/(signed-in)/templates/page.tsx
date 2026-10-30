import type { MessageEntry, WhatsappTemplate } from '@clinic-mx/db';
import {
  TEMPLATE_LANGUAGE,
  bodyWithNames,
  formatIstDateTime,
  inboundKindLabels,
  inboundRouteLabels,
  maskNumber,
  messageStatusLabels,
  messageTemplates,
  sessionReplyLabels,
  templateButtonKindLabels,
  templateApprovalLabels,
  templateHeaderLabels,
  type InboundKind,
  type MessageStatus,
  type MessageTemplate,
  type SessionReply,
  type TemplateApprovalStatus,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { recentMessagesOf, templateVersionsOf } from '../../../../../modules/messaging/services';
import { getSetting } from '../../../../../modules/settings/settings';
import { TestMessageForm } from './test-message';

export const metadata: Metadata = { title: 'WhatsApp templates · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Design system v2: a word always; amber for "needs attention", never the emergency red.
const statusTone: Record<MessageStatus, Tone> = {
  queued: 'outline',
  sent: 'active',
  failed: 'waiting',
  skipped: 'neutral',
  delivered: 'active',
  read: 'done',
  received: 'info',
};

/**
 * What a message is, never what an inbound one says (user decision, 30 October 2026): an incoming
 * one with where the router sent it (WA-03), a router reply by what it was.
 */
function messageName(entry: MessageEntry): string {
  if (entry.direction === 'inbound') {
    const kind = `Incoming · ${inboundKindLabels[entry.kind as InboundKind]}`;
    return entry.route ? `${kind} → ${inboundRouteLabels[entry.route]}` : kind;
  }
  if (entry.kind === 'session') {
    return `Reply · ${sessionReplyLabels[entry.templateKey as SessionReply]}`;
  }
  return entry.kind === 'test' ? 'Test message' : (entry.templateKey ?? '');
}

function RecentMessages({ messages }: { messages: MessageEntry[] }) {
  if (messages.length === 0) return <p className="text-ink-muted">No messages yet.</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="recent-messages">
      {messages.map((entry) => (
        <li
          key={entry.id}
          data-testid="recent-message"
          data-status={entry.status}
          data-direction={entry.direction}
          className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-3"
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink">{messageName(entry)}</span>
            <Tag tone={statusTone[entry.status]}>{messageStatusLabels[entry.status]}</Tag>
          </span>
          <span className="text-sm text-ink-secondary tabular-nums">
            {maskNumber(entry.phone)} · {formatIstDateTime(entry.createdAt)}
            {entry.attempts > 1 ? ` · ${String(entry.attempts)} attempts` : null}
          </span>
          {entry.errorTitle ? (
            <span className="text-sm text-ink-secondary" data-testid="message-reason">
              {entry.errorTitle}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// Design system v2: amber where Meta stopped a template, never the emergency red.
const approvalTone: Record<TemplateApprovalStatus | 'not_submitted', Tone> = {
  not_submitted: 'neutral',
  pending: 'outline',
  approved: 'active',
  rejected: 'waiting',
  paused: 'waiting',
  disabled: 'neutral',
};

function TemplateCard({
  template,
  versions,
}: {
  template: MessageTemplate;
  versions: readonly WhatsappTemplate[];
}) {
  const buttons: readonly { kind: keyof typeof templateButtonKindLabels; text: string }[] =
    template.buttons;
  const current = versions.find((entry) => entry.version === template.version);
  const status = current?.status ?? 'not_submitted';
  // An older approved version keeps sending until this one is approved.
  const sending = versions.find((entry) => entry.status === 'approved');
  const held = 'held' in template ? template.held : undefined;
  return (
    <li
      data-testid="message-template"
      data-approval={status}
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{template.name}</span>
        <Tag tone="neutral">
          {current && current.category !== 'UTILITY' ? 'Marketing (moved by Meta)' : 'Utility'}
        </Tag>
        <Tag tone={approvalTone[status]}>{templateApprovalLabels[status]}</Tag>
      </span>
      <span className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
        <span className="font-mono text-ink-secondary" data-testid="template-key">
          {template.key}
        </span>
        <span>Version {template.version}</span>
      </span>
      {current?.reason ? (
        <p className="text-sm text-ink-secondary" data-testid="template-reason">
          Meta: {current.reason}
        </p>
      ) : null}
      {sending && sending.version !== template.version ? (
        <p className="text-sm text-ink-secondary">
          Version {sending.version} is sent until this version is approved.
        </p>
      ) : null}
      {held ? <p className="text-sm text-ink-secondary">Not submitted yet: {held}</p> : null}
      <p
        className="whitespace-pre-wrap rounded-control bg-surface-sunken p-3 text-sm text-ink"
        data-testid="template-body"
      >
        {bodyWithNames(template)}
      </p>
      <p className="text-sm text-ink-secondary">{template.purpose}</p>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">Variables</span>
        <ul className="flex flex-col gap-0.5" data-testid="template-variables">
          {template.variables.map((variable) => (
            <li key={variable.name} className="text-ink-secondary">
              <span className="font-mono text-ink">{variable.name}</span>: {variable.label}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-ink-secondary">
        <span className="font-medium text-ink">Header: </span>
        {templateHeaderLabels[template.header]}
      </p>
      <p className="text-sm text-ink-secondary">
        <span className="font-medium text-ink">Buttons: </span>
        {buttons.length === 0
          ? 'None'
          : buttons
              .map((button) => `${button.text} (${templateButtonKindLabels[button.kind]})`)
              .join(', ')}
      </p>
      <p className="text-sm text-ink-muted">Source: {template.source}</p>
    </li>
  );
}

// WhatsApp templates (SET-11): the registry of every template the platform sends, with its key,
// text, variables and version (packages/schemas/src/message-templates.ts), and what Meta decided
// about it on this environment's number (WA-06). View only: a template changes in code as a new
// version, and Meta approves it again (docs/runbooks/whatsapp-templates.md).
// WhatsApp (WA-01): a test message to a number on the test list, and the recent messages with
// what became of each (docs/runbooks/whatsapp.md).
export default async function TemplatesPage() {
  const staff = await requirePermission('templates.manage');
  const [recipients, messages, versions] = await Promise.all([
    getSetting('whatsapp.test_recipients'),
    recentMessagesOf(staff),
    templateVersionsOf(staff),
  ]);
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">WhatsApp templates</h1>
        <p className="text-ink-secondary">
          Every message the platform sends outside a conversation, with its text and the details it
          carries. Only a template Meta approved on this number is sent; any change to the text is a
          new version, approved again.
        </p>
      </div>
      <section aria-labelledby="test-message" className="flex flex-col gap-3">
        <h2 id="test-message" className="font-semibold text-ink">
          Test message
        </h2>
        <p className="text-sm text-ink-secondary">
          Sends Meta’s “Hello World” sample from the WhatsApp test number, to prove the connection.
        </p>
        {staff.support ? (
          <p className="text-sm text-ink-muted">Velyx support access is read only.</p>
        ) : (
          <TestMessageForm recipients={recipients} />
        )}
      </section>
      <section aria-labelledby="recent-messages" className="flex flex-col gap-3">
        <h2 id="recent-messages" className="font-semibold text-ink">
          Recent messages
        </h2>
        <RecentMessages messages={messages} />
      </section>
      <h2 className="font-semibold text-ink">Templates</h2>
      <p className="text-sm text-ink-muted" data-testid="template-count">
        {messageTemplates.length} templates, all in Meta’s utility category.
      </p>
      <ul className="flex flex-col gap-3">
        {messageTemplates.map((template) => (
          <TemplateCard
            key={template.key}
            template={template}
            versions={versions.filter(
              (entry) => entry.key === template.key && entry.language === TEMPLATE_LANGUAGE,
            )}
          />
        ))}
      </ul>
    </main>
  );
}
