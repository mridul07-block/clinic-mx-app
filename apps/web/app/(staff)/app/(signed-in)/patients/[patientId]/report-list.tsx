import type { PatientReportEntry } from '@clinic-mx/db';
import {
  formatIstDateTime,
  reportAddedBy,
  reportKindLabels,
  reportSizeText,
} from '@clinic-mx/schemas';

/**
 * A patient's report photos and scans for clinicians (ALT-08): photos as thumbnails, PDFs by name
 * and size; each opens full size in a new tab, from our own domain (`/app/reports/<id>`).
 */
export function ReportList({ reports }: { reports: PatientReportEntry[] }) {
  if (reports.length === 0) return <p className="text-ink-muted">None added yet.</p>;
  return (
    <ul data-testid="patient-reports" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {reports.map((report) => {
        const href = `/app/reports/${report.id}`;
        const photo = report.contentType !== 'application/pdf';
        return (
          <li
            key={report.id}
            data-testid="patient-report"
            className="flex flex-col gap-1.5 rounded-panel border border-line bg-surface p-2"
          >
            <a
              href={href}
              target="_blank"
              rel="noopener"
              className="flex aspect-square items-center justify-center overflow-hidden rounded-control bg-surface-sunken text-sm font-medium text-accent underline underline-offset-2"
            >
              {photo ? (
                // A private file behind our permission check: never through the image optimiser.
                // eslint-disable-next-line @next/next/no-img-element -- a private file behind our check
                <img
                  src={href}
                  alt={`Report photo added ${formatIstDateTime(report.createdAt)}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                `Open PDF, ${reportSizeText(report.sizeBytes)}`
              )}
            </a>
            <span className="text-xs text-ink-secondary">
              {reportKindLabels[report.contentType]} · {reportAddedBy(report)} ·{' '}
              {formatIstDateTime(report.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
