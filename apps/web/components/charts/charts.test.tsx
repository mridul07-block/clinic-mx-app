import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BulletGraph } from './bullet-graph';
import { ChartTable } from './chart-table';
import { LineChart } from './line-chart';

// OUT-03: the hand-built charts of design system v2 section 9.
describe('the charts', () => {
  it('draw a line with a gap where a value is missing, each point labelled', () => {
    const html = renderToStaticMarkup(
      <LineChart
        label="Pain during activity"
        min={0}
        max={10}
        points={[
          { label: 'Consultation', value: 6 },
          { label: 'Session 1', value: 4 },
          { label: 'Session 2', value: null },
          { label: 'Session 3', value: 2 },
        ]}
      />,
    );
    expect(html).toContain('aria-label="Pain during activity"');
    expect(html.match(/data-testid="line-point"/g)).toHaveLength(3);
    // One path for the first two points; the lone third point after the gap has none.
    expect(html.match(/<path /g)).toHaveLength(1);
    expect(html).toContain('>Consultation<');
    expect(html).toContain('>Session 3<');
  });

  it('draw a bullet to the value, a tick at the target and the earlier value as a mark', () => {
    const html = renderToStaticMarkup(
      <BulletGraph
        label="Quadriceps"
        value={0.6}
        target={0.9}
        earlier={0.3}
        max={1.2}
        targetLabel="Target 90%"
      />,
    );
    expect(html).toContain('data-testid="bullet-bar"');
    expect(html).toContain('width="160"');
    expect(html).toContain('data-testid="bullet-earlier"');
    expect(html).toContain('>Target 90%<');
    expect(
      renderToStaticMarkup(
        <BulletGraph
          label="x"
          value={0.95}
          target={0.9}
          earlier={null}
          max={1.2}
          targetLabel="Target 90%"
        />,
      ),
    ).not.toContain('bullet-earlier');
  });

  it('give every chart a table twin in words', () => {
    const html = renderToStaticMarkup(
      <ChartTable
        caption="Pain"
        columns={['Visit', 'During activity']}
        rows={[['Session 1', '4']]}
      />,
    );
    expect(html).toContain('Show as table');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('>Session 1<');
  });
});
