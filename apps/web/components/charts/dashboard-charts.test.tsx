import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarChart } from './bar-chart';
import { BulletGraph } from './bullet-graph';
import { niceMax, rampStep, targetWords } from './chart-scale';
import { DonutChart } from './donut-chart';
import { DumbbellChart } from './dumbbell-chart';
import { Heatmap } from './heatmap';
import { HorizontalBars } from './horizontal-bars';
import { LineChart } from './line-chart';
import { WeekStrip } from './week-strip';

// DSH-02: the dashboard charts of design system v2 section 9, each with its value readout and its
// "Show as table" twin in words.
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe('the chart arithmetic', () => {
  it('ends an axis on a round number and words a target', () => {
    expect([0, 7, 10, 11, 23, 118, 1_840_000].map(niceMax)).toEqual([
      1, 10, 10, 20, 25, 200, 2_000_000,
    ]);
    expect(targetWords(80, 75)).toBe('meets target');
    expect(targetWords(70, 75)).toBe('below target');
    expect(targetWords(18, 15, 'lower')).toBe('above target');
    expect(targetWords(11, 15, 'lower')).toBe('meets target');
  });

  it('puts a value on the 7 step ramp, the fewest lightest', () => {
    expect([0, 1, 5, 9, 10].map((value) => rampStep(value, 10))).toEqual([0, 0, 3, 6, 6]);
    expect(rampStep(4, 0)).toBe(0);
  });
});

describe('the bar chart', () => {
  it('draws a column per value, the period still filling hatched and labelled so far', () => {
    const html = renderToStaticMarkup(
      <BarChart
        label="Consultations a week"
        categories={['W41', 'W42', 'W43']}
        series={[{ name: 'Consultations', tone: 'viz-1', values: [110, null, 64] }]}
        soFar={2}
        target={{ value: 105, label: 'Target 105' }}
      />,
    );
    expect(count(html, /data-testid="bar"/g)).toBe(1);
    expect(count(html, /data-testid="bar-so-far"/g)).toBe(1);
    expect(html).toContain('fill="url(#hatch');
    expect(html).toContain('>W43</text><text');
    expect(html).toContain('>so far</text>');
    expect(html).toContain('data-words="W43: 64, so far, below target"');
    expect(html).toContain('data-words="W41: 110, meets target"');
    expect(html).toContain('data-testid="bar-target"');
    expect(html).toContain('>Target 105<');
    // The table says it in words, the empty week included.
    expect(html).toContain('>W43 (so far)<');
    expect(html).toContain('>64, below target<');
    expect(html).toContain('>No data<');
  });

  it('hatches only the series still filling, never last year', () => {
    const html = renderToStaticMarkup(
      <BarChart
        label="Revenue"
        categories={['Sep', 'Oct']}
        series={[
          { name: 'Last year', tone: 'compare', values: [10, 12] },
          { name: 'HSR Layout', tone: 'centre-1', values: [11, 6] },
        ]}
        soFar={1}
      />,
    );
    expect(count(html, /data-testid="bar-so-far"/g)).toBe(1);
    expect(html).toContain('data-words="Oct, Last year: 12"');
    expect(html).toContain('data-words="Oct, HSR Layout: 6, so far"');
    expect(html).toMatch(/fill="url\(#hatch2[^"]*\)"[^>]*class="cmx-bar stroke-viz-centre-1"/);
  });

  it('writes values on the bars only when they fit, and none for a negative value', () => {
    const months = [
      'Nov',
      'Dec',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
    ];
    const crowded = renderToStaticMarkup(
      <BarChart
        label="Revenue"
        categories={months}
        series={[{ name: 'Revenue', tone: 'viz-1', values: months.map(() => 1_650_000) }]}
        format={(value) => `₹${(value / 100_000).toFixed(1)} L`}
      />,
    );
    expect(crowded).not.toContain('data-testid="bar-value"');
    const roomy = renderToStaticMarkup(
      <BarChart
        label="Count"
        categories={['Mon', 'Mon', 'Tue']}
        series={[{ name: 'Visits', tone: 'viz-1', values: [3, -2, 0.01] }]}
      />,
    );
    expect(count(roomy, /data-testid="bar-value"/g)).toBe(2);
    // The smallest bar stands on the baseline, not below it.
    expect(roomy).toMatch(/y="147" width="[^"]+" height="1"/);
  });

  it('names each series of a comparison and colours centres', () => {
    const html = renderToStaticMarkup(
      <BarChart
        label="Appointments per centre"
        categories={['Mon']}
        series={[
          { name: 'HSR Layout', tone: 'centre-1', values: [42] },
          { name: 'Koramangala', tone: 'centre-2', values: [35] },
        ]}
      />,
    );
    expect(html).toContain('fill-viz-centre-1');
    expect(html).toContain('fill-viz-centre-2');
    expect(html).toContain('data-words="Mon, Koramangala: 35"');
    expect(html).toContain('>Koramangala</li>');
  });
});

describe('the donut', () => {
  const part = (label: string, value: number) => ({ label, value, tone: 'viz-1' as const });

  it('shows one whole in parts, each named with its share, the total in the middle', () => {
    const html = renderToStaticMarkup(
      <DonutChart
        label="Booking channel"
        parts={[part('WhatsApp', 3), part('Phone', 1)]}
        centre="4"
        centreCaption="bookings"
      />,
    );
    expect(count(html, /data-testid="donut-part"/g)).toBe(2);
    // One stop per part: the key line points at its arc.
    expect(count(html, /data-words=/g)).toBe(2);
    expect(html).toContain('data-for="1"');
    expect(html).toContain('data-words="WhatsApp: 3 (75%)"');
    expect(html).toContain('>bookings<');
  });

  it('refuses one part, or more than four', () => {
    const draw = (parts: ReturnType<typeof part>[]) => () =>
      renderToStaticMarkup(<DonutChart label="x" parts={parts} centre="0" centreCaption="x" />);
    expect(draw([part('a', 1)])).toThrow(/2 to 4 parts/);
    expect(draw(['a', 'b', 'c', 'd', 'e'].map((label) => part(label, 1)))).toThrow(/2 to 4 parts/);
  });
});

describe('the other charts', () => {
  it('sorts horizontal bars biggest first and keeps the top 10', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      label: `Diagnosis ${String(index + 1)}`,
      value: index + 1,
    }));
    const html = renderToStaticMarkup(<HorizontalBars label="Top diagnoses" rows={rows} />);
    expect(count(html, /data-testid="hbar"/g)).toBe(10);
    expect(html.indexOf('Diagnosis 12:')).toBeLessThan(html.indexOf('Diagnosis 11:'));
    expect(html).not.toContain('data-words="Diagnosis 1: 1"');
    expect(html).toContain('>2 more not shown<');
  });

  it('draws a dumbbell per row from the baseline to the discharge', () => {
    const html = renderToStaticMarkup(
      <DumbbellChart
        label="Pain"
        rows={[{ label: 'Ankle sprain', from: 6, to: 2 }]}
        min={0}
        max={10}
        fromLabel="Baseline"
        toLabel="Discharge"
      />,
    );
    expect(count(html, /data-testid="dumbbell-row"/g)).toBe(1);
    expect(html).toContain('data-words="Ankle sprain: Baseline 6, Discharge 2"');
    const long = renderToStaticMarkup(
      <DumbbellChart
        label="Pain"
        rows={[
          { label: 'Rotator cuff related shoulder pain after a fall at work', from: 6, to: 2 },
        ]}
        min={0}
        max={10}
        fromLabel="Baseline"
        toLabel="Discharge"
      />,
    );
    expect(long).toContain('…</text>');
    expect(long).toContain('data-words="Rotator cuff related shoulder pain after a fall at work:');
    expect(count(html, /<circle /g)).toBeGreaterThanOrEqual(2);
  });

  it('shades busy hours on the ramp, an empty hour grey', () => {
    const html = renderToStaticMarkup(
      <Heatmap
        label="Busy hours"
        columns={['09', '10']}
        rows={[{ label: 'Mon', values: [10, null] }]}
        unit="visits"
      />,
    );
    expect(html).toContain('data-words="Mon 09: 10 visits"');
    expect(html).toContain('data-step="6"');
    expect(html).toContain('data-words="Mon 10: no data"');
    // An hour with no value is a dashed outline, in the key too: never mistaken for the fewest.
    expect(html).toContain('fill-surface stroke-line-control');
    expect(html).toContain('>No data</text>');
    expect(html).toContain('More (up to 10 visits)');
  });

  it('marks each day of the week strip in words', () => {
    const html = renderToStaticMarkup(
      <WeekStrip
        label="Home exercises"
        days={[
          { day: 'Mon', date: '20 Oct', state: 'done' },
          { day: 'Tue', date: '21 Oct', state: 'missed' },
          { day: 'Wed', date: '22 Oct', state: 'to_come' },
        ]}
      />,
    );
    expect(html).toContain('data-words="Tue 21 Oct: Missed"');
    expect(html).toContain('>1 of 2 days done so far<');
    // A visible key names the three marks.
    expect(html).toContain('>Done</li>');
    expect(html).toContain('>Missed</li>');
    expect(html).toContain('>To come<');
  });

  it('adds a target line and a meaningful change band to the line chart', () => {
    const html = renderToStaticMarkup(
      <LineChart
        label="Score"
        min={0}
        max={80}
        points={[
          { label: 'Baseline', value: 38 },
          { label: 'Week 6', value: 58 },
        ]}
        target={{ value: 50, label: 'Target 50' }}
        band={{ from: 38, to: 47, label: 'Meaningful change' }}
      />,
    );
    expect(html).toContain('data-testid="line-target"');
    expect(html).toContain('>Meaningful change<');
    expect(html).toContain('data-words="Week 6: 58"');
  });

  it('reverses the bullet graph where lower is better', () => {
    const html = renderToStaticMarkup(
      <BulletGraph
        label="Reinjury"
        value={10}
        target={15}
        earlier={null}
        max={40}
        targetLabel="Target under 15%"
        lowerIsBetter
      />,
    );
    // 10 of 40 is a quarter of 320, drawn from the right: x 240, width 80.
    expect(html).toMatch(/x="240"[^>]*width="80"[^>]*data-testid="bullet-bar"/);
  });
});
