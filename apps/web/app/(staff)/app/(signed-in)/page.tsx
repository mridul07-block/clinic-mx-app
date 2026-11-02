import {
  mainLinksWithoutTab,
  moreLabel,
  moreNavigationFor,
  navigationBySection,
  staffRoleLabels,
} from '@clinic-mx/schemas';
import { Page, PageHeader } from '@clinic-mx/ui/components/page';
import Link from 'next/link';
import { navIconComponents } from '../../../../components/nav-icons';
import { requireStaff } from '../../../../modules/auth/session';
import { SignOutButton } from './sign-out-button';

const rowClass = 'flex min-h-row-touch items-center gap-3 px-4 text-ink hover:bg-surface-hover';

// /app: More, Setup for the Super Admin. Everything the person may open beyond their main links
// (`moreNavigationFor`), under plain headings, then Account and signing out. Everyone lands on
// their role's own screen, so this page is only ever asked for (the user's review, 3 November 2026).
export default async function MorePage() {
  const staff = await requireStaff();
  const groups = navigationBySection(moreNavigationFor(staff));
  const noTab = mainLinksWithoutTab(staff);
  return (
    <Page width="form">
      <PageHeader
        title={moreLabel(staff.role)}
        context={`Signed in as ${staff.name}, ${staffRoleLabels[staff.role]}`}
      />
      <nav aria-label="Screens" className="flex flex-col gap-6">
        {/* On a phone only: the sidebar holds these from 768 px. */}
        {noTab.length > 0 ? (
          <section className="flex flex-col gap-2 md:hidden">
            <h2 className="font-semibold text-ink">Main</h2>
            <ul className="divide-y divide-line overflow-clip rounded-panel border border-line bg-surface">
              {noTab.map((item) => {
                const Icon = navIconComponents[item.icon];
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={rowClass}>
                      <Icon aria-hidden size={18} strokeWidth={1.75} className="text-ink-muted" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {groups.map((group) => (
          <section key={group.section} className="flex flex-col gap-2">
            <h2 className="font-semibold text-ink">{group.label}</h2>
            <ul className="divide-y divide-line overflow-clip rounded-panel border border-line bg-surface">
              {group.items.map((item) => {
                const Icon = navIconComponents[item.icon];
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={rowClass}>
                      <Icon aria-hidden size={18} strokeWidth={1.75} className="text-ink-muted" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-ink">Your account</h2>
          <ul className="overflow-clip rounded-panel border border-line bg-surface">
            <li>
              <Link href="/app/account" className={rowClass}>
                Account
              </Link>
            </li>
          </ul>
        </section>
      </nav>
      <SignOutButton />
    </Page>
  );
}
