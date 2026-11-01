import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn, type DataTableProps } from './data-table';

type Bill = { id: string; patient: string; number: string; amount: string; centre: string };

const rows: Bill[] = [
  { id: 'b1', patient: 'Asha Rao', number: 'BL-0042', amount: '₹1,500', centre: 'HSR Layout' },
  { id: 'b2', patient: 'Ravi Kumar', number: 'BL-0043', amount: '₹900', centre: 'Whitefield' },
];

const columns: DataTableColumn<Bill>[] = [
  { key: 'number', header: 'Bill', cell: (row) => row.number },
  { key: 'patient', header: 'Patient', cell: (row) => row.patient, primary: true },
  { key: 'centre', header: 'Centre', cell: (row) => row.centre, hideOnPhone: true },
  { key: 'amount', header: 'Amount', cell: (row) => row.amount, align: 'right' },
];

const render = (extra: Partial<DataTableProps<Bill>> = {}) =>
  renderToStaticMarkup(
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption="Bills" {...extra} />,
  );

describe('DataTable', () => {
  it('is a real table from 768 px with a sticky header band and a hidden caption', () => {
    const html = render();
    expect(html).toContain('<div class="hidden overflow-x-auto md:block"><table');
    expect(html).toContain('border-separate border-spacing-0 text-base tabular-nums');
    expect(html).toContain('<caption class="sr-only">Bills</caption>');
    expect(html).toContain('sticky top-0 h-row border-b border-line bg-surface-subtle');
    expect(html).toContain('scope="col"');
  });

  it('aligns money right and gives rows 36 px, 44 px on touch, with a hover surface', () => {
    const html = render();
    expect(html).toMatch(/<th scope="col" class="[^"]*text-right">Amount<\/th>/);
    expect(html).toContain('pointer-coarse:h-row-touch');
    expect(html).toContain('hover:bg-surface-hover');
    expect(html).toContain('group-last:border-b-0');
    expect(html).toContain('first:pl-5 last:pr-5');
  });

  it('becomes stacked cards below 768 px, titled by the primary column', () => {
    const html = render();
    const cards = html.slice(html.indexOf('<ul'), html.indexOf('</ul>'));
    expect(cards).toContain('aria-label="Bills"');
    expect(cards).toContain('md:hidden');
    expect(cards).toContain('<div class="font-medium text-ink">Asha Rao</div>');
    expect(cards).toContain('<dt class="text-ink-muted">Bill</dt>');
    expect(cards).toContain('<dd class="text-ink tabular-nums">₹1,500</dd>');
    expect(cards).not.toContain('Centre');
    expect(cards).not.toContain('>Patient<');
  });

  it('puts the row action in the last cell and at the foot of each card', () => {
    const html = render({ rowAction: (row) => <a href={`/bills/${row.id}`}>Open</a> });
    expect(html.match(/>Open<\/a>/g)).toHaveLength(4);
    expect(html).toContain('<span class="sr-only">Actions</span>');
  });

  it('shows the empty state instead when there are no rows', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        caption="Bills"
        empty={<p>No bills yet.</p>}
      />,
    );
    expect(html).toBe('<p>No bills yet.</p>');
  });

  it('shows the caption when asked', () => {
    expect(render({ showCaption: true })).toContain(
      'px-5 pb-2 text-left text-sm font-medium text-ink-muted',
    );
  });
});
