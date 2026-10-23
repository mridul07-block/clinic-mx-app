import {
  messageTemplates,
  templateButtonKindLabels,
  templateHeaderLabels,
  templateStatusLabels,
  type MessageTemplate,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';

export const metadata: Metadata = { title: 'WhatsApp templates · Clinic Mx' };

function TemplateCard({ template }: { template: MessageTemplate }) {
  const buttons: readonly { kind: keyof typeof templateButtonKindLabels; text: string }[] =
    template.buttons;
  return (
    <li
      data-testid="message-template"
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{template.name}</span>
        <Tag tone="neutral">Utility</Tag>
        <Tag tone="outline">{templateStatusLabels[template.status]}</Tag>
      </span>
      <span className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
        <span className="font-mono text-ink-secondary" data-testid="template-key">
          {template.key}
        </span>
        <span>Version {template.version}</span>
      </span>
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
// variables and version (packages/schemas/src/message-templates.ts). View only: a template changes
// in code as a new version, and Meta approves it again (docs/runbooks/whatsapp-templates.md).
export default async function TemplatesPage() {
  await requirePermission('templates.manage');
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">WhatsApp templates</h1>
        <p className="text-ink-secondary">
          Every message the platform sends outside a conversation, with the details each one
          carries. The text is written and submitted to Meta in WA-06; any change to an approved
          template needs Meta’s approval again.
        </p>
      </div>
      <p className="text-sm text-ink-muted" data-testid="template-count">
        {messageTemplates.length} templates, all in Meta’s utility category.
      </p>
      <ul className="flex flex-col gap-3">
        {messageTemplates.map((template) => (
          <TemplateCard key={template.key} template={template} />
        ))}
      </ul>
    </main>
  );
}
