import type { DocumentEntry } from '@clinic-mx/db';
import { documentKindLabels, documentSeries, formatIstDateTime } from '@clinic-mx/schemas';

/**
 * A patient's generated documents (ALT-05): each once, its newest version to open and the earlier
 * versions under it, never overwritten (TAD section 9). Each opens in a new tab from our own
 * domain (`/app/documents/<id>`).
 */
export function DocumentList({ documents }: { documents: DocumentEntry[] }) {
  if (documents.length === 0) {
    return (
      <p className="text-ink-muted">
        Consultation summaries and letters appear here once they are generated.
      </p>
    );
  }
  return (
    <ul data-testid="patient-documents" className="flex flex-col gap-3">
      {documentSeries(documents).map(({ latest, earlier }) => (
        <li
          key={latest.id}
          data-testid="patient-document"
          className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-3"
        >
          <span className="font-medium text-ink">{documentKindLabels[latest.kind]}</span>
          <span className="text-sm text-ink-secondary">
            Version {latest.version} · {formatIstDateTime(latest.createdAt)}
          </span>
          <a
            href={`/app/documents/${latest.id}`}
            target="_blank"
            rel="noopener"
            className="min-h-11 self-start py-2.5 text-sm font-medium text-accent underline underline-offset-2"
          >
            Open PDF
          </a>
          {earlier.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-line pt-2">
              <span className="text-xs font-medium text-ink-secondary">Earlier versions</span>
              <ul className="flex flex-wrap gap-x-4">
                {earlier.map((version) => (
                  <li key={version.id}>
                    <a
                      href={`/app/documents/${version.id}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-2"
                    >
                      Version {version.version}, {formatIstDateTime(version.createdAt)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
