import Link from 'next/link';

export interface RecordTab {
  key: string;
  label: string;
  href: string;
  /** A count beside the label, such as open alerts; nothing when zero or absent. */
  count?: number;
}

/**
 * Tabs that are links (design system v2 "Tabs"; CLN-12): each tab has its own address, so it can
 * be shared and survives a reload; the current one is marked for assistive technology. On a phone
 * the row scrolls sideways if it ever outgrows the screen.
 */
export function RecordTabs({
  label,
  tabs,
  current,
}: {
  label: string;
  tabs: RecordTab[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((tab) => {
          const selected = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={selected ? 'page' : undefined}
                data-testid={['tab', tab.key].join('-')}
                className={[
                  '-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-2 text-sm md:px-3 md:text-md',
                  selected
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-ink-secondary hover:text-ink',
                ].join(' ')}
              >
                {tab.label}
                {tab.count ? (
                  <span className="rounded-tag border border-waiting-line bg-waiting-soft px-1.5 text-sm font-medium text-waiting-strong tabular-nums">
                    {tab.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
