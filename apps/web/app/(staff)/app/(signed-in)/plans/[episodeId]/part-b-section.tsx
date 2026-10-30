import { Tag } from '../../../../../../components/tag';
import type { PartBView } from '../../../../../../modules/consent/part-b';
import { PartBConsentQr } from './patient-qrs';
import { PartBTabletForm } from './part-b-tablet-form';

// Part B consent on the plan and payment sheet (BIL-03; PRD J4.4 and J4.5): where it stands (the
// gate's words, each planned treatment agreed, declined or not asked yet), then the QR for the
// patient's phone, or the kiosk tablet as backup, while something is left to ask.

export function PartBSection({
  episodeId,
  view,
  origin,
  tablets,
}: {
  episodeId: string;
  view: PartBView;
  origin: string;
  tablets: { id: string; name: string }[];
}) {
  const { status, gate } = view;
  const toAsk =
    status.missing.length > 0 ||
    status.generalDeclined ||
    status.packageDeclined ||
    status.modalitiesDeclined.length > 0;
  return (
    <section aria-labelledby="part-b" className="flex flex-col gap-3" data-testid="part-b">
      <h2 id="part-b" className="font-semibold text-ink">
        Part B consent
      </h2>
      <p className="flex flex-wrap items-center gap-2">
        <Tag
          tone={
            gate.met
              ? 'done'
              : status.generalDeclined || status.packageDeclined
                ? 'danger'
                : 'waiting'
          }
        >
          {gate.met
            ? 'Complete'
            : status.generalDeclined || status.packageDeclined
              ? 'Declined'
              : 'Needed'}
        </Tag>
        <span className="text-sm text-ink-secondary" data-testid="part-b-gate">
          {gate.message}
        </span>
      </p>
      {view.modalities.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="part-b-modalities">
          {view.modalities.map((modality) => (
            <li key={modality.key} className="flex flex-wrap items-center gap-2">
              <span className="text-ink">{modality.name}</span>
              <span className="text-ink-muted">
                {modality.accepted === null
                  ? 'not asked yet'
                  : modality.accepted
                    ? 'agreed'
                    : 'declined: leave it out'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.planned && toAsk ? (
        <div className="flex flex-col gap-3">
          <PartBConsentQr episodeId={episodeId} origin={origin} />
          {tablets.length ? <PartBTabletForm episodeId={episodeId} tablets={tablets} /> : null}
        </div>
      ) : null}
    </section>
  );
}
