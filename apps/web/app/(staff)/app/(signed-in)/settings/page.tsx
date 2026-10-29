import {
  formatIstDateTime,
  isSettingKey,
  settingChangedElsewhere,
  settingChoices,
  settingDefinitions,
  settingDisplay,
  settingFieldText,
  settingInputKind,
  settingTakesNegative,
  settingsByArea,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { settingsForScreen } from '../../../../../modules/settings/services';
import { SettingForm } from './setting-form';

export const metadata: Metadata = { title: 'Settings · Clinic Mx' };

// The settings screen (ADM-02; PRD M16, section 7): every business rule the Super Admin changes
// without a release, by area, each with what it does, where it comes from, its value and its last
// change. One setting is changed at a time; a few have their own screen or flow and are read only
// here. Velyx support reads it only.
export default async function SettingsPage() {
  const staff = await requirePermission('settings.manage');
  const entries = new Map((await settingsForScreen(staff)).map((entry) => [entry.key, entry]));
  const areas = settingsByArea();
  const readOnly = staff.support;

  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Settings</h1>
        <p className="text-ink-secondary">
          The clinic’s rules, changed here without a new release. Each change is checked, takes
          effect within a minute and is kept in the{' '}
          <Link
            href="/app/audit?entity=setting"
            className="text-accent underline underline-offset-2"
          >
            audit log
          </Link>
          .
        </p>
      </div>
      {readOnly ? <FormMessage tone="info">Velyx support access is read only.</FormMessage> : null}

      <nav aria-label="Areas" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {areas.map(({ area, label }) => (
          <a key={area} href={`#${area}`} className="text-accent underline underline-offset-2">
            {label}
          </a>
        ))}
      </nav>

      {areas.map(({ area, label, keys }) => (
        <section
          key={area}
          id={area}
          aria-labelledby={[area, 'heading'].join('-')}
          className="flex scroll-mt-4 flex-col gap-3"
        >
          <h2 id={[area, 'heading'].join('-')} className="text-lg font-semibold text-ink">
            {label}
          </h2>
          <ul className="flex flex-col gap-3">
            {keys.map((key) => {
              const entry = entries.get(key);
              if (!entry || !isSettingKey(entry.key)) return null;
              const definition = settingDefinitions[key];
              const elsewhere = settingChangedElsewhere(key);
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3"
                  data-testid="setting"
                  data-key={key}
                >
                  <p className="font-mono text-sm font-semibold break-all text-ink">{key}</p>
                  <p className="text-ink">{definition.description}</p>
                  <p className="text-sm break-words text-ink-secondary" data-testid="setting-value">
                    Now: <span className="font-mono">{settingDisplay(key, entry.value)}</span>
                  </p>
                  <p className="text-xs text-ink-muted">
                    Changed {formatIstDateTime(entry.updatedAt)} by{' '}
                    {entry.updatedByName ?? 'the system'}. Source: {definition.source}
                  </p>
                  {elsewhere ? (
                    <p className="text-sm text-ink-secondary" data-testid="setting-elsewhere">
                      {elsewhere.reason}{' '}
                      {elsewhere.href ? (
                        <Link
                          href={elsewhere.href}
                          className="text-accent underline underline-offset-2"
                        >
                          Open it
                        </Link>
                      ) : null}
                    </p>
                  ) : readOnly ? null : (
                    <details>
                      <summary className="flex min-h-row cursor-pointer items-center text-sm font-medium text-accent pointer-coarse:min-h-row-touch">
                        Change
                      </summary>
                      <div className="mt-2">
                        <SettingForm
                          settingKey={key}
                          kind={settingInputKind(key)}
                          choices={settingChoices(key)}
                          text={settingFieldText(key, entry.value)}
                          seenAt={entry.updatedAt.toISOString()}
                          negative={settingTakesNegative(key)}
                        />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
