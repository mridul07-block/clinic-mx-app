import { formatIstDate, istDate, type LsiBullet, type PainPoint } from '@clinic-mx/schemas';
import { BulletGraph } from '../../../../../../components/charts/bullet-graph';
import { ChartTable } from '../../../../../../components/charts/chart-table';
import { LineChart } from '../../../../../../components/charts/line-chart';
import { Tag } from '../../../../../../components/tag';
import type { ProgressView } from '../../../../../../modules/progress/progress';
import { EpisodeHeading } from './clinical-record';
import { PhaseStepper } from './phase-stepper';

const panelClass = 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-4';
const percent = (fraction: number) => `${String(Math.round(fraction * 100))}%`;
const pain = (value: number | null) => (value === null ? 'Not recorded' : String(value));

function PainPanel({ points, sentence }: { points: PainPoint[]; sentence: string | null }) {
  const recorded = points.some((point) => point.activity !== null);
  return (
    <section aria-labelledby="progress-pain" className={panelClass} data-testid="progress-pain">
      <h2 id="progress-pain" className="font-semibold text-ink">
        Pain during activity
      </h2>
      {!recorded ? (
        <p className="text-ink-muted">No pain recorded yet.</p>
      ) : (
        <>
          {sentence ? (
            <p className="text-ink-secondary" data-testid="progress-pain-sentence">
              {sentence}
            </p>
          ) : null}
          <LineChart
            label={`Pain during activity, 0 to 10. ${sentence ?? ''}`}
            points={points.map((point) => ({ label: point.label, value: point.activity }))}
            min={0}
            max={10}
          />
          <ChartTable
            caption="Pain at each visit, 0 to 10"
            columns={['Visit', 'During activity', 'At rest (now)', 'After treatment']}
            rows={points.map((point) => [
              `${point.label}, ${formatIstDate(istDate(point.at))}`,
              pain(point.activity),
              pain(point.rest),
              pain(point.after),
            ])}
          />
        </>
      )}
    </section>
  );
}

function LsiPanel({ bullets }: { bullets: LsiBullet[] }) {
  return (
    <section aria-labelledby="progress-lsi" className={panelClass} data-testid="progress-lsi">
      <h2 id="progress-lsi" className="font-semibold text-ink">
        Limb symmetry (LSI)
      </h2>
      {bullets.length === 0 ? (
        <p className="text-ink-muted">No strength or hop tests in this episode yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {bullets.map((bullet) => {
              const max = Math.max(1.2, bullet.latest, bullet.baseline ?? 0);
              const status = bullet.passes ? 'Pass' : 'Not yet';
              return (
                <li
                  key={bullet.key}
                  className="flex flex-col gap-1"
                  data-testid="progress-bullet"
                  data-measure={bullet.key}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-medium text-ink">{bullet.name}</span>
                    <Tag tone={bullet.passes ? 'done' : 'waiting'}>{status}</Tag>
                  </span>
                  <BulletGraph
                    label={`${bullet.name}: LSI ${percent(bullet.latest)}, ${status.toLowerCase()}, target ${percent(bullet.passAt)}`}
                    value={bullet.latest}
                    target={bullet.passAt}
                    earlier={bullet.baseline}
                    max={max}
                    targetLabel={`Target ${percent(bullet.passAt)}`}
                  />
                  <span className="text-sm text-ink-secondary" data-testid="progress-bullet-text">
                    LSI {percent(bullet.latest)}
                    {bullet.baseline === null
                      ? ''
                      : `, from ${percent(bullet.baseline)} at baseline`}
                    {` (${bullet.from})`}
                  </span>
                </li>
              );
            })}
          </ul>
          <ChartTable
            caption="Limb symmetry by measure"
            columns={['Measure', 'Baseline', 'Latest', 'Target', 'Result']}
            rows={bullets.map((bullet) => [
              bullet.name,
              bullet.baseline === null ? 'Only one test' : percent(bullet.baseline),
              `${percent(bullet.latest)} (${bullet.from})`,
              percent(bullet.passAt),
              bullet.passes ? 'Pass' : 'Not yet, below target',
            ])}
          />
        </>
      )}
    </section>
  );
}

/**
 * The Progress tab (OUT-03, Frontend Specification "Progress tab"): the phase stepper (OUT-04),
 * then the current episode's pain during activity as a line and each strength or hop LSI as a
 * bullet graph, each with its table. Questionnaire lines and the week strip join with OUT-02 and
 * PAT-01.
 */
export function ProgressTab({ view, patientId }: { view: ProgressView; patientId: string }) {
  if (!view.episode) {
    return <p className="text-ink-muted">No episodes yet. Booking a consultation opens one.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className={panelClass}>
        <EpisodeHeading episode={view.episode} />
      </div>
      {view.phases ? (
        <PhaseStepper view={view.phases} ids={{ episodeId: view.episode.id, patientId }} />
      ) : null}
      <PainPanel points={view.pain} sentence={view.painSentence} />
      <LsiPanel bullets={view.bullets} />
    </div>
  );
}
