import {
  latestKnowledgeVersion,
  redFlagPresentations,
  redFlagRules,
  type KnowledgeRedFlagPresentation,
  type KnowledgeRedFlagRule,
} from '@clinic-mx/db';
import {
  alertDisplay,
  knowledgeRegions,
  redFlagTriageLabels,
  redFlagTriages,
  screeningRegionLabels,
  screeningRegions,
  triggerText,
  type AlertDisplay,
  type KnowledgeRegion,
  type ScreeningThresholds,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { getSetting } from '../../../../../modules/settings/settings';

export const metadata: Metadata = { title: 'Red flags · Clinic Mx' };

const displayTone: Record<AlertDisplay, Tone> = {
  emergency: 'danger',
  review: 'waiting',
  information: 'neutral',
};

function RuleCard({
  rule,
  thresholds,
}: {
  rule: KnowledgeRedFlagRule;
  thresholds: ScreeningThresholds;
}) {
  return (
    <li
      data-testid="red-flag-rule"
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{rule.name}</span>
        <Tag tone={displayTone[alertDisplay(rule.triage)]}>{redFlagTriageLabels[rule.triage]}</Tag>
        {rule.signedOff ? null : <Tag tone="outline">Awaiting clinical sign-off</Tag>}
      </span>
      <p className="text-sm text-ink-secondary">
        <span className="font-medium text-ink">Raised when: </span>
        {triggerText(rule.trigger, thresholds)}
      </p>
      <p className="text-sm text-ink-secondary">
        <span className="font-medium text-ink">Action: </span>
        {rule.action}
      </p>
      <p className="text-sm text-ink-muted">{rule.source}</p>
    </li>
  );
}

function RegionPresentations({
  region,
  rows,
}: {
  region: KnowledgeRegion;
  rows: KnowledgeRedFlagPresentation[];
}) {
  const presentations = rows.filter((row) => row.kind === 'presentation');
  const notes = rows.filter((row) => row.kind === 'screening_note');
  return (
    <details data-testid="red-flag-region" className="rounded-panel border border-line bg-surface">
      <summary className="cursor-pointer p-4 font-semibold text-ink pointer-coarse:py-5">
        {knowledgeRegions[region].label}{' '}
        <span className="font-normal text-ink-muted">({presentations.length})</span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-line p-4">
        <ul className="flex flex-col gap-4">
          {presentations.map((row) => (
            <li key={row.id} className="flex flex-col gap-1">
              <span className="font-semibold text-ink">{row.presentation}</span>
              <span className="text-sm text-ink-secondary">{row.features}</span>
              <span className="text-sm text-ink">
                <span className="font-medium">Action: </span>
                {row.action}
              </span>
              {row.why ? <span className="text-sm text-ink-muted">{row.why}</span> : null}
            </li>
          ))}
        </ul>
        {notes.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold text-ink">Screening notes</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-secondary">
              {notes.map((row) => (
                <li key={row.id}>{row.presentation}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

// Red flags (SET-10): the rules the health form submit runs over a patient's screening answers,
// and each workbook's red flag presentations for clinicians. From the latest knowledge base
// version, read only (knowledge_base.view); rules change only as a new version (SET-06).
export default async function RedFlagsPage() {
  const staff = await requirePermission('knowledge_base.view');
  const thresholds: ScreeningThresholds = {
    'screening.weight_loss_kg': await getSetting('screening.weight_loss_kg'),
    'screening.weight_loss_months': await getSetting('screening.weight_loss_months'),
    'screening.morning_stiffness_minutes': await getSetting('screening.morning_stiffness_minutes'),
  };
  const data = await asStaff(staff, async (tx) => {
    const version = await latestKnowledgeVersion(tx);
    if (!version) return null;
    return {
      version,
      rules: await redFlagRules(tx, version.id),
      presentations: await redFlagPresentations(tx, version.id),
    };
  });

  const groups = data
    ? [
        { label: 'Everywhere', rules: data.rules.filter((r) => r.regions.length === 0) },
        ...screeningRegions.map((region) => ({
          label: screeningRegionLabels[region],
          // A rule for several regions is listed under its first.
          rules: data.rules.filter((r) => r.regions[0] === region),
        })),
      ]
        .filter((group) => group.rules.length > 0)
        .map((group) => ({
          ...group,
          rules: group.rules.toSorted(
            (a, b) =>
              redFlagTriages.indexOf(a.triage) - redFlagTriages.indexOf(b.triage) ||
              a.name.localeCompare(b.name),
          ),
        }))
    : [];
  const regions = data
    ? (Object.keys(knowledgeRegions) as KnowledgeRegion[]).filter((region) =>
        data.presentations.some((row) => row.region === region),
      )
    : [];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Red flags</h1>
        <p className="text-ink-secondary">
          The rules the health form runs when a patient submits it, and each region’s red flag
          presentations from the workbooks.
        </p>
      </div>
      {data ? (
        <>
          <p className="text-sm text-ink-muted" data-testid="red-flag-version">
            Knowledge base version {data.version.number} (
            {data.version.status === 'approved' ? 'approved' : 'draft, awaiting approval'}). Rules
            change only as a new version.
          </p>
          <section className="flex flex-col gap-4" aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="text-lg font-semibold">
              Rules
            </h2>
            {groups.map((group) => (
              <div key={group.label} className="flex flex-col gap-3">
                <h3 className="font-semibold text-ink-secondary">{group.label}</h3>
                <ul className="flex flex-col gap-3">
                  {group.rules.map((rule) => (
                    <RuleCard key={rule.id} rule={rule} thresholds={thresholds} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="presentations-heading">
            <h2 id="presentations-heading" className="text-lg font-semibold">
              Presentations by region
            </h2>
            <p className="text-sm text-ink-secondary">
              Reference for screening and for choosing a tier in consultation. These are not run
              automatically.
            </p>
            {regions.map((region) => (
              <RegionPresentations
                key={region}
                region={region}
                rows={data.presentations.filter((row) => row.region === region)}
              />
            ))}
          </section>
        </>
      ) : (
        <p className="text-ink-secondary">No knowledge base version has been imported yet.</p>
      )}
    </main>
  );
}
