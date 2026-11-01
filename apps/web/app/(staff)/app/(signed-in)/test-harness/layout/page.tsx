import { Avatar } from '@clinic-mx/ui/components/avatar';
import { Button, buttonVariants } from '@clinic-mx/ui/components/button';
import { DataTable, type DataTableColumn } from '@clinic-mx/ui/components/data-table';
import { DescriptionList } from '@clinic-mx/ui/components/description-list';
import { EmptyState } from '@clinic-mx/ui/components/empty-state';
import { ErrorState } from '@clinic-mx/ui/components/error-state';
import { Page, PageHeader } from '@clinic-mx/ui/components/page';
import { Panel } from '@clinic-mx/ui/components/panel';
import { RecordHeader } from '@clinic-mx/ui/components/record-header';
import { LoadingRegion, Skeleton, SkeletonText } from '@clinic-mx/ui/components/skeleton';
import { StickyActions } from '@clinic-mx/ui/components/sticky-actions';
import { Tag } from '@clinic-mx/ui/components/tag';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';

// Layout and states test harness (UIX-11; end to end tests only, 404 unless
// CLINIC_MX_TEST_HARNESS=1): the page, page header, record header, panels, description list,
// table and phone cards, empty, error and not found states, skeletons, avatars and the sticky
// action area of design system v3 sections 7 and 8, with made up values and no patients, at
// 360 px first and on desktop.
export const dynamic = 'force-dynamic';

type Bill = { id: string; number: string; person: string; centre: string; amount: string };

const bills: Bill[] = [
  { id: 'b1', number: 'BL-0042', person: 'Asha Rao', centre: 'HSR Layout', amount: '₹1,500' },
  { id: 'b2', number: 'BL-0043', person: 'Ravi Kumar', centre: 'Koramangala', amount: '₹900' },
  { id: 'b3', number: 'BL-0044', person: 'Meera Iyer', centre: 'Whitefield', amount: '₹12,400' },
];

const columns: DataTableColumn<Bill>[] = [
  {
    key: 'number',
    header: 'Bill',
    cell: (bill) => <span className="font-mono">{bill.number}</span>,
  },
  { key: 'person', header: 'Patient', cell: (bill) => bill.person, primary: true },
  { key: 'centre', header: 'Centre', cell: (bill) => bill.centre, hideOnPhone: true },
  { key: 'amount', header: 'Amount', cell: (bill) => bill.amount, align: 'right' },
];

export default function LayoutHarnessPage() {
  if (!testHarnessEnabled()) notFound();
  return (
    <Page width="content">
      <PageHeader
        title="Layout"
        context={['Test harness', 'Made up values']}
        back={{ href: '/app', label: 'All screens' }}
        link={Link}
        tags={<Tag tone="info">Preview</Tag>}
        actions={<Button variant="secondary">Export</Button>}
      />

      <Panel title="Record header">
        <RecordHeader
          name="Asha Rao"
          opNumber="HSR-00137"
          facts={['34 years', 'Female', 'Knee, treatment']}
          status={
            <Tag tone="active" dot>
              Active
            </Tag>
          }
          flags={
            <>
              <Tag tone="danger">Red flag</Tag>
              <Tag tone="done">Consent signed</Tag>
            </>
          }
          meta={[
            { label: 'Next visit', value: 'Tue 4 Nov, 10:30' },
            { label: 'Sessions left', value: '6 of 10' },
            { label: 'Balance due', value: '₹1,500' },
          ]}
          action={<Button>Start session</Button>}
        />
      </Panel>

      <Panel
        title="Details"
        window="Last updated today"
        actions={
          <Button variant="secondary" size="sm">
            Edit
          </Button>
        }
        footer="Shown read only; Edit opens the form."
      >
        <DescriptionList
          items={[
            { label: 'Mobile', value: '98450 00000' },
            { label: 'Centre', value: 'HSR Layout' },
            { label: 'Physiotherapist', value: 'Sneha Menon' },
            {
              label: 'Team',
              value: (
                <span className="inline-flex items-center gap-2">
                  <Avatar name="Sneha Menon" size={24} />
                  Sneha Menon
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <Panel title="Bills" window="This week" flush>
        <DataTable
          caption="Bills this week"
          columns={columns}
          rows={bills}
          rowKey={(bill) => bill.id}
          rowAction={(bill) => (
            <Link
              href={`/app/test-harness/layout?bill=${bill.id}`}
              className={buttonVariants({ variant: 'quiet', size: 'sm' })}
            >
              Open
            </Link>
          )}
        />
      </Panel>

      <Panel title="Unpaid bills" flush>
        <DataTable
          caption="Unpaid bills"
          columns={columns}
          rows={[]}
          rowKey={(bill) => bill.id}
          empty={
            <EmptyState icon={Inbox} action={<Button variant="secondary">New bill</Button>}>
              No bills are waiting for payment.
            </EmptyState>
          }
        />
      </Panel>

      <Panel title="Loading">
        <LoadingRegion className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <SkeletonText lines={3} />
        </LoadingRegion>
      </Panel>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <ErrorState
          kind="error"
          headingLevel={2}
          title="This page did not open"
          reference="4021387765"
          action={<Button>Load again</Button>}
        >
          Load it again. If it still does not open, tell the clinic manager and give them the
          reference below.
        </ErrorState>
        <ErrorState
          kind="not-found"
          headingLevel={2}
          title="We can't find that page"
          action={
            <Link href="/app" className={buttonVariants({ variant: 'primary' })}>
              See all screens
            </Link>
          }
        >
          The address may be wrong, or the page has moved or been removed.
        </ErrorState>
      </div>

      <Panel title="People">
        <div className="flex items-center gap-3">
          <Avatar name="Asha Rao" size={24} />
          <Avatar name="Ravi Kumar" size={32} />
          <Avatar name="Meera Iyer" size={48} decorative={false} />
        </div>
      </Panel>

      <StickyActions>
        <Button>Save changes</Button>
        <Button variant="secondary">Cancel</Button>
      </StickyActions>
    </Page>
  );
}
