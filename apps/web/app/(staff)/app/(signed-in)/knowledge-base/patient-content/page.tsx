import { patientContentStateLabels, type PatientContentState } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { loadPatientContentList } from '../../../../../../modules/knowledge-base/patient-content';

export const metadata: Metadata = { title: 'Patient content · Knowledge base · Clinic Mx' };
export const dynamic = 'force-dynamic';

const shows = ['all', 'none', 'draft', 'approved'] as const;
type Show = (typeof shows)[number];
const showLabels: Record<Show, string> = {
  all: 'All',
  none: 'No content',
  draft: 'Drafts',
  approved: 'Approved',
};
const matches: Record<Show, (state: PatientContentState) => boolean> = {
  all: () => true,
  none: (state) => state === 'none',
  draft: (state) => state === 'draft' || state === 'approved_with_draft',
  approved: (state) => state === 'approved' || state === 'approved_with_draft',
};
const tone = (state: PatientContentState) =>
  state === 'approved' ? 'done' : state === 'none' ? 'neutral' : 'waiting';

// Patient content (AI-07): each condition of the live knowledge base version and where its patient
// content stands; a search by name or condition ID and a filter. Everyone who reads the knowledge
// base sees it; a consultant who treats patients writes and approves.
export default async function PatientContentListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const staff = await requirePermission('knowledge_base.view');
  const { q = '', show: rawShow } = await searchParams;
  const show: Show = shows.find((each) => each === rawShow) ?? 'all';
  const all = await loadPatientContentList(staff);
  const query = q.trim().toLowerCase();
  const shown = all.filter(
    (row) =>
      matches[show](row.state) &&
      (!query ||
        row.name.toLowerCase().includes(query) ||
        row.conditionId.toLowerCase().includes(query)),
  );
  const approved = all.filter((row) => matches.approved(row.state)).length;
  const href = (next: Show) =>
    `/app/knowledge-base/patient-content?${new URLSearchParams({ ...(q ? { q } : {}), show: next }).toString()}`;
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/knowledge-base"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Knowledge base
        </Link>
        <h1 className="text-title font-semibold">Patient content</h1>
        <p className="text-ink-secondary" data-testid="patient-content-summary">
          {approved} of {all.length} conditions have approved patient content. Patients see a
          condition&rsquo;s content only once a consultant who treats patients approves it.
        </p>
      </div>
      <form className="flex flex-col gap-2" role="search">
        <label htmlFor="patient-content-q" className="font-medium text-ink">
          Find a condition
        </label>
        <input type="hidden" name="show" value={show} />
        <input
          id="patient-content-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Name or ID, for example ANK-001"
          className="min-h-11 rounded-control border border-line-control bg-surface px-3 text-ink"
        />
      </form>
      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {shows.map((each) => (
          <Link
            key={each}
            href={href(each)}
            aria-current={each === show ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-control border px-3 text-sm ${
              each === show
                ? 'border-ink bg-surface font-medium text-ink'
                : 'border-line-control text-ink-secondary'
            }`}
          >
            {showLabels[each]}
          </Link>
        ))}
      </nav>
      {shown.length === 0 ? (
        <p className="text-ink-muted" data-testid="patient-content-empty">
          No condition matches.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-surface">
          {shown.map((row) => (
            <li key={row.conditionId} data-testid="patient-content-row">
              <Link
                href={`/app/knowledge-base/patient-content/${row.conditionId}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 hover:bg-surface-hover"
              >
                <span className="flex flex-col">
                  <span className="text-ink">{row.name}</span>
                  <span className="font-mono text-sm text-ink-muted">{row.conditionId}</span>
                </span>
                <Tag tone={tone(row.state)}>{patientContentStateLabels[row.state]}</Tag>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
