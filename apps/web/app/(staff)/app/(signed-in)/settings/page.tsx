import {
  clinicRuleGroups,
  formatIstDateTime,
  isSettingKey,
  matchSettings,
  settingChangedElsewhere,
  settingChoices,
  settingDefinitions,
  settingDisplay,
  settingFieldText,
  settingInputKind,
  settingPlainDescription,
  settingTakesNegative,
  settingsByArea,
  type SettingKey,
} from '@clinic-mx/schemas';
import { Page, PageHeader } from '@clinic-mx/ui/components/page';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage, secondaryButtonClass } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { settingsForScreen } from '../../../../../modules/settings/services';
import { SettingForm } from './setting-form';

export const metadata: Metadata = { title: 'Settings · Clinic Mx' };

type Entry = Awaited<ReturnType<typeof settingsForScreen>>[number];

function SettingCard({
  settingKey,
  entry,
  readOnly,
  technical,
}: {
  settingKey: SettingKey;
  entry: Entry;
  readOnly: boolean;
  /** Under Advanced: its name in the table and where the value came from. */
  technical: boolean;
}) {
  const definition = settingDefinitions[settingKey];
  const elsewhere = settingChangedElsewhere(settingKey);
  return (
    <li
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
      data-testid="setting"
      data-key={settingKey}
    >
      {technical ? (
        <p className="font-mono text-sm font-semibold break-all text-ink">{settingKey}</p>
      ) : null}
      <p className="text-ink">{settingPlainDescription(definition.description)}</p>
      <p className="break-words text-ink" data-testid="setting-value">
        Now: <span className="font-medium">{settingDisplay(settingKey, entry.value)}</span>
      </p>
      <p className="text-sm text-ink-muted">
        Changed {formatIstDateTime(entry.updatedAt)} by {entry.updatedByName ?? 'the system'}.
        {technical ? ` Source: ${definition.source}` : ''}
      </p>
      {elsewhere ? (
        <p className="text-sm text-ink-secondary" data-testid="setting-elsewhere">
          {elsewhere.reason}{' '}
          {elsewhere.href ? (
            <Link href={elsewhere.href} className="text-accent underline underline-offset-2">
              Open it
            </Link>
          ) : null}
        </p>
      ) : readOnly ? null : (
        <details>
          <summary className="flex min-h-row cursor-pointer items-center font-medium text-accent pointer-coarse:min-h-row-touch">
            Change
          </summary>
          <div className="mt-2">
            <SettingForm
              settingKey={settingKey}
              kind={settingInputKind(settingKey)}
              choices={settingChoices(settingKey)}
              text={settingFieldText(settingKey, entry.value)}
              seenAt={entry.updatedAt.toISOString()}
              negative={settingTakesNegative(settingKey)}
            />
          </div>
        </details>
      )}
    </li>
  );
}

// The settings screen (ADM-02; PRD M16, section 7; the user's review, 3 November 2026): the clinic's
// own rules in plain groups and words, a search over everything, and every other setting folded
// under Advanced. One setting is changed at a time; a few have their own screen or flow and are
// read only here. Velyx support reads it only.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const staff = await requirePermission('settings.manage');
  const entries = new Map((await settingsForScreen(staff)).map((entry) => [entry.key, entry]));
  const readOnly = staff.support;
  const asked = (await searchParams).q;
  const typed = typeof asked === 'string' ? asked.trim() : '';
  const found = typed ? matchSettings(typed) : [];
  const clinicKeys = new Set<string>(clinicRuleGroups.flatMap((group) => group.keys));

  const card = (key: SettingKey, technical: boolean) => {
    const entry = entries.get(key);
    if (!entry || !isSettingKey(entry.key)) return null;
    return (
      <SettingCard
        key={key}
        settingKey={key}
        entry={entry}
        readOnly={readOnly}
        technical={technical}
      />
    );
  };

  return (
    <Page width="form">
      <PageHeader title="Settings" />
      <p className="text-ink-secondary">
        The clinic’s rules. Each change is checked, takes effect within a minute and is kept in the{' '}
        <Link href="/app/audit?entity=setting" className="text-accent underline underline-offset-2">
          audit log
        </Link>
        .
      </p>
      {readOnly ? <FormMessage tone="info">Velyx support access is read only.</FormMessage> : null}

      <form method="get" role="search" className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-ink">Find a setting</span>
          <input
            type="search"
            name="q"
            defaultValue={typed}
            className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs pointer-coarse:h-row-touch"
          />
        </label>
        <button type="submit" className={secondaryButtonClass.replace('w-full', 'w-auto')}>
          Find
        </button>
      </form>

      {typed ? (
        <section className="flex flex-col gap-3" aria-labelledby="settings-found">
          <h2 id="settings-found" className="font-semibold text-ink">
            {found.length === 1 ? '1 setting found' : `${String(found.length)} settings found`}
          </h2>
          <ul className="flex flex-col gap-3">
            {found.map((key) => card(key, !clinicKeys.has(key)))}
          </ul>
          <Link
            href="/app/settings"
            className="self-start text-accent underline underline-offset-2"
          >
            Show all settings
          </Link>
        </section>
      ) : (
        <>
          {clinicRuleGroups.map((group) => (
            <section key={group.label} className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-ink">{group.label}</h2>
              <ul className="flex flex-col gap-3">{group.keys.map((key) => card(key, false))}</ul>
            </section>
          ))}
          <details data-testid="settings-advanced" className="flex flex-col gap-3">
            <summary className="flex min-h-row-touch cursor-pointer items-center text-lg font-semibold text-ink">
              Advanced
            </summary>
            <p className="mb-3 text-ink-secondary">
              Technical settings, set when the system was set up. Most never need changing.
            </p>
            <div className="flex flex-col gap-6">
              {settingsByArea().map(({ area, label, keys }) => {
                const rest = keys.filter((key) => !clinicKeys.has(key));
                if (rest.length === 0) return null;
                return (
                  <section key={area} id={area} className="flex scroll-mt-4 flex-col gap-3">
                    <h3 className="font-semibold text-ink">{label}</h3>
                    <ul className="flex flex-col gap-3">{rest.map((key) => card(key, true))}</ul>
                  </section>
                );
              })}
            </div>
          </details>
        </>
      )}
    </Page>
  );
}
