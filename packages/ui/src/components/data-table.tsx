import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Numbers and money align right (and read tabular). */
  align?: 'left' | 'right';
  /** The card title on phones; the first column when none is marked. */
  primary?: boolean;
  /** Left out of the phone cards (still in the table from 768 px). */
  hideOnPhone?: boolean;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The row's action: the last cell of the table, the foot of a phone card. */
  rowAction?: (row: T) => ReactNode;
  /** The header of the action column, for screen readers. */
  rowActionHeader?: string;
  /** Shown instead of the table when there are no rows (an EmptyState). */
  empty?: ReactNode;
  /** Names the table; read by screen readers only unless showCaption. */
  caption: string;
  showCaption?: boolean;
  className?: string;
}

const edgeCell = 'px-3 first:pl-5 last:pr-5';

/**
 * A table (design system v3 section 8), rendered on the server in both forms: stacked cards
 * below 768 px (the primary column as the card title, the rest as label and value pairs, the row
 * action at the foot) and a real table from 768 px, switched by CSS alone. Cells render twice, so
 * a cell must not hold an element id.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowAction,
  rowActionHeader = 'Actions',
  empty,
  caption,
  showCaption = false,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;
  const primary = columns.find((column) => column.primary) ?? columns[0];
  const details = columns.filter((column) => column !== primary && !column.hideOnPhone);
  return (
    <div className={className}>
      {showCaption ? (
        <p aria-hidden className="px-5 pb-2 text-sm font-medium text-ink-muted md:hidden">
          {caption}
        </p>
      ) : null}
      <ul aria-label={caption} className="flex flex-col md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="flex flex-col gap-2 border-b border-line px-5 py-3 last:border-b-0"
          >
            {primary ? <div className="font-medium text-ink">{primary.cell(row)}</div> : null}
            {details.length ? (
              <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 text-sm">
                {details.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-ink-muted">{column.header}</dt>
                    <dd className={cn('text-ink', column.align === 'right' && 'tabular-nums')}>
                      {column.cell(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {rowAction ? <div className="flex flex-wrap gap-2 pt-1">{rowAction(row)}</div> : null}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-separate border-spacing-0 text-base tabular-nums">
          <caption
            className={cn(
              showCaption ? 'px-5 pb-2 text-left text-sm font-medium text-ink-muted' : 'sr-only',
            )}
          >
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'sticky top-0 h-row border-b border-line bg-surface-subtle text-sm font-medium whitespace-nowrap text-ink-muted',
                    edgeCell,
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.header}
                </th>
              ))}
              {rowAction ? (
                <th
                  scope="col"
                  className={cn(
                    'sticky top-0 h-row border-b border-line bg-surface-subtle',
                    edgeCell,
                  )}
                >
                  <span className="sr-only">{rowActionHeader}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="group hover:bg-surface-hover">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'h-row border-b border-line text-ink group-last:border-b-0 pointer-coarse:h-row-touch',
                      edgeCell,
                      column.align === 'right' && 'text-right',
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                {rowAction ? (
                  <td
                    className={cn(
                      'h-row border-b border-line text-right whitespace-nowrap group-last:border-b-0 pointer-coarse:h-row-touch',
                      edgeCell,
                    )}
                  >
                    {rowAction(row)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
