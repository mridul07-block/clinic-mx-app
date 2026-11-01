import { Kbd } from '@clinic-mx/ui/components/kbd';
import { LinkTabs } from '@clinic-mx/ui/components/link-tabs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';
import { OverlayDemos, type ShownOpen } from './overlay-demos';

// Overlay kit test harness (UIX-09; end to end tests only, 404 unless CLINIC_MX_TEST_HARNESS=1):
// every overlay of design system v3 section 8 with made up labels and no patients, at 360 px first
// and on desktop. `?open=sheet` (drawer, dialog, search, confirm, menu, popover, toast) opens one on load
// so screenshots catch it; only one at a time, since an open modal hides the rest of the page.
export const dynamic = 'force-dynamic';

const openable: readonly ShownOpen[] = [
  'sheet',
  'drawer',
  'dialog',
  'search',
  'confirm',
  'menu',
  'popover',
  'toast',
];

function isShownOpen(value: string | undefined): value is ShownOpen {
  return openable.some((each) => each === value);
}

type Props = { searchParams: Promise<{ open?: string; tab?: string }> };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-4 shadow-xs sm:p-5">
      <h2 className="text-md font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const linkTabs = [
  { key: 'overview', label: 'Overview', href: '/app/test-harness/overlays' },
  { key: 'notes', label: 'Notes', href: '/app/test-harness/overlays?tab=notes', count: 4 },
  {
    key: 'alerts',
    label: 'Alerts',
    href: '/app/test-harness/overlays?tab=alerts',
    count: 2,
    attention: true,
  },
  { key: 'bills', label: 'Bills', href: '/app/test-harness/overlays?tab=bills' },
];

export default async function OverlaysHarnessPage({ searchParams }: Props) {
  if (!testHarnessEnabled()) notFound();
  const params = await searchParams;
  const open: ShownOpen | null = isShownOpen(params.open) ? params.open : null;
  const tab = linkTabs.some((each) => each.key === params.tab) ? params.tab : 'overview';
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <h1 className="text-title font-semibold">Component kit: overlays</h1>

      <OverlayDemos open={open} />

      <Section title="Link tabs">
        <LinkTabs label="Sample record" tabs={linkTabs} current={tab ?? 'overview'} linkAs={Link} />
      </Section>

      <Section title="Key hints">
        <p className="flex items-center gap-2 text-ink-secondary">
          Search with <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> or <Kbd>/</Kbd>
        </p>
      </Section>
    </main>
  );
}
