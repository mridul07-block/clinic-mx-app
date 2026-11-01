import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { tabClass } from './link-tabs';
import { Tab, Tabs, TabsList, TabsPanel } from './tabs';

function render(value?: string) {
  return renderToStaticMarkup(
    <Tabs defaultValue="notes" value={value}>
      <TabsList label="Episode">
        <Tab value="notes">Notes</Tab>
        <Tab value="alerts" count={2} attention>
          Alerts
        </Tab>
        <Tab value="empty" count={0}>
          Files
        </Tab>
      </TabsList>
      <TabsPanel value="notes">Notes panel</TabsPanel>
      <TabsPanel value="alerts">Alerts panel</TabsPanel>
    </Tabs>,
  );
}

describe('Tabs', () => {
  it('is a named tab list with the current tab selected and only its panel shown', () => {
    const html = render();
    expect(html).toContain('role="tablist" aria-label="Episode"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Notes</);
    expect(html).toContain('Notes panel');
    expect(html).not.toContain('Alerts panel');
  });

  it('follows a controlled value', () => {
    const html = render('alerts');
    expect(html).toMatch(/aria-selected="true"[^>]*>Alerts/);
    expect(html).toContain('Alerts panel');
  });

  it('shows a count beside a label, on the waiting tint when it needs action, and none at zero', () => {
    const html = render();
    expect(html).toContain('text-waiting tabular-nums">2</span>');
    expect(html).not.toContain('>0</span>');
  });

  it('is 40 px (44 on touch), muted, with a 2 px accent underline when current', () => {
    expect(tabClass).toContain('h-10');
    expect(tabClass).toContain('pointer-coarse:h-11');
    expect(tabClass).toContain('border-b-2 border-transparent');
    expect(tabClass).toContain('text-ink-muted');
    expect(tabClass).toContain('data-active:border-accent data-active:text-ink');
  });
});
