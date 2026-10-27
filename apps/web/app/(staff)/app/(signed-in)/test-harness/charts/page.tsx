import { kpiText } from '@clinic-mx/schemas';
import { notFound } from 'next/navigation';
import { BarChart } from '../../../../../../components/charts/bar-chart';
import { BulletGraph } from '../../../../../../components/charts/bullet-graph';
import { DonutChart } from '../../../../../../components/charts/donut-chart';
import { DumbbellChart } from '../../../../../../components/charts/dumbbell-chart';
import { Heatmap } from '../../../../../../components/charts/heatmap';
import { HorizontalBars } from '../../../../../../components/charts/horizontal-bars';
import { LineChart } from '../../../../../../components/charts/line-chart';
import { WeekStrip } from '../../../../../../components/charts/week-strip';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';

// Chart test harness (DSH-02; end to end tests only, 404 unless CLINIC_MX_TEST_HARNESS=1): every
// chart of design system v2 section 9 with made up figures, no patients, at 360 px and desktop.
export const dynamic = 'force-dynamic';

const lakhs = (paise: number) => kpiText(paise, 'paise');
const hours = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'];
const busy = [
  [2, 5, 7, 6, 4, 2, 3, 5, 8, 9, 7, 3],
  [1, 4, 6, 7, 5, 3, 2, 4, 7, 8, 6, 2],
  [3, 6, 8, 8, 4, 2, 3, 6, 9, 10, 8, 4],
  [2, 5, 6, 5, 3, 1, 2, 4, 6, 8, 7, 3],
  [3, 7, 9, 8, 5, 3, 4, 6, 8, 9, 6, 2],
  [6, 9, 10, 9, 7, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null, null, null, null, null],
];

export default function ChartsHarnessPage() {
  if (!testHarnessEnabled()) notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6">
      <h1 className="text-title font-semibold">Charts</h1>
      <BarChart
        label="Consultations a week"
        categories={['W38', 'W39', 'W40', 'W41', 'W42', 'W43', 'W44']}
        series={[
          { name: 'Consultations', tone: 'viz-1', values: [92, 101, 97, 110, 104, 118, 64] },
        ]}
        soFar={6}
        target={{ value: 105, label: 'Target 105' }}
      />
      <BarChart
        label="Revenue by month against last year"
        categories={['Jul', 'Aug', 'Sep', 'Oct']}
        series={[
          {
            name: 'Last year',
            tone: 'compare',
            values: [1_420_000_00, 1_510_000_00, 1_480_000_00, 1_600_000_00],
          },
          {
            name: 'This year',
            tone: 'viz-1',
            values: [1_650_000_00, 1_720_000_00, 1_840_000_00, 1_210_000_00],
          },
        ]}
        soFar={3}
        format={lakhs}
      />
      <BarChart
        label="Appointments per centre"
        categories={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
        series={[
          { name: 'HSR Layout', tone: 'centre-1', values: [42, 45, 40, 47, 44, 38] },
          { name: 'Koramangala', tone: 'centre-2', values: [35, 33, 37, 36, 34, 30] },
          { name: 'Whitefield', tone: 'centre-3', values: [28, 31, 27, 30, 29, 25] },
        ]}
      />
      <LineChart
        label="Conversion by month"
        min={0}
        max={100}
        points={[
          { label: 'Jun', value: 70 },
          { label: 'Jul', value: 74 },
          { label: 'Aug', value: 78 },
          { label: 'Sep', value: null },
          { label: 'Oct', value: 81 },
        ]}
        target={{ value: 75, label: 'Target 75%' }}
      />
      <LineChart
        label="Questionnaire score"
        min={0}
        max={80}
        points={[
          { label: 'Baseline', value: 38 },
          { label: 'Session 4', value: 47 },
          { label: 'Week 6', value: 58 },
        ]}
        band={{ from: 38, to: 47, label: 'Meaningful change' }}
      />
      <DonutChart
        label="Booking channel"
        parts={[
          { label: 'WhatsApp', value: 58, tone: 'viz-1' },
          { label: 'Phone', value: 31, tone: 'centre-2' },
          { label: 'Walk in', value: 11, tone: 'compare' },
        ]}
        centre="100"
        centreCaption="bookings"
      />
      <DonutChart
        label="Recommendation score"
        parts={[
          { label: 'Promoters', value: 64, tone: 'promoter' },
          { label: 'Passives', value: 24, tone: 'passive' },
          { label: 'Detractors', value: 12, tone: 'detractor' },
        ]}
        centre="52"
        centreCaption="NPS"
      />
      <HorizontalBars
        label="Top diagnoses"
        rows={[
          { label: 'Patellofemoral pain', value: 41 },
          { label: 'Lateral ankle sprain', value: 33 },
          { label: 'Non-specific low back pain', value: 52 },
          { label: 'Rotator cuff related shoulder pain', value: 27 },
          { label: 'ACL reconstruction', value: 18 },
          { label: 'Plantar heel pain', value: 15 },
          { label: 'Neck pain', value: 22 },
          { label: 'Tennis elbow', value: 12 },
          { label: 'Hip OA', value: 9 },
          { label: 'Achilles tendinopathy', value: 14 },
          { label: 'Meniscal tear', value: 8 },
        ]}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink">Bullet graphs</h2>
        <BulletGraph
          label="Completion 84% against a target of over 80%"
          value={84}
          target={80}
          earlier={77}
          max={100}
          targetLabel="Target 80%"
        />
        <BulletGraph
          label="Reinjury 11% against a target of under 15%"
          value={11}
          target={15}
          earlier={null}
          max={30}
          targetLabel="Target under 15%"
          lowerIsBetter
        />
      </section>
      <DumbbellChart
        label="Pain during activity, baseline against discharge"
        rows={[
          { label: 'Patellofemoral pain', from: 6.5, to: 2.1 },
          { label: 'Lateral ankle sprain', from: 5.8, to: 1.2 },
          { label: 'Non-specific low back pain', from: 7.1, to: 3.4 },
        ]}
        min={0}
        max={10}
        fromLabel="Baseline"
        toLabel="Discharge"
      />
      <Heatmap
        label="Busy hours"
        columns={hours}
        rows={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => ({
          label: day,
          values: busy[index] ?? [],
        }))}
        unit="visits"
      />
      <WeekStrip
        label="Home exercises this week"
        days={[
          { day: 'Mon', date: '20 Oct', state: 'done' },
          { day: 'Tue', date: '21 Oct', state: 'done' },
          { day: 'Wed', date: '22 Oct', state: 'missed' },
          { day: 'Thu', date: '23 Oct', state: 'done' },
          { day: 'Fri', date: '24 Oct', state: 'done' },
          { day: 'Sat', date: '25 Oct', state: 'to_come' },
          { day: 'Sun', date: '26 Oct', state: 'to_come' },
        ]}
      />
    </main>
  );
}
