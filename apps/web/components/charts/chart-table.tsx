/**
 * Every chart's "Show as table" twin (design system v2 section 9): the same values as words, in a
 * closed disclosure under the chart.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <details className="flex flex-col gap-2">
      <summary className="cursor-pointer self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3">
        Show as table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-ink-muted">
              {columns.map((column) => (
                <th key={column} scope="col" className="py-1.5 pr-3 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join('|')} className="border-b border-line last:border-0">
                {row.map((cell, index) => (
                  <td key={[String(index), cell].join('-')} className="py-1.5 pr-3 text-ink">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
