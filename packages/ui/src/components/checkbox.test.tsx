import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('is a native checkbox inside its label, so the whole row is the target', () => {
    const html = renderToStaticMarkup(<Checkbox name="consent" value="yes" label="I agree" />);
    expect(html).toMatch(/^<label for="[^"]+"/);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="consent"');
    expect(html).toContain('value="yes"');
    expect(html).toContain('>I agree</span>');
    expect(html).toContain('pointer-coarse:min-h-row-touch');
  });

  it('is a 16 px box with a 4 px radius, teal with a white tick when checked', () => {
    const html = renderToStaticMarkup(<Checkbox label="Done" defaultChecked />);
    expect(html).toContain('size-4');
    expect(html).toContain('rounded-[4px]');
    expect(html).toContain('border-line-control');
    expect(html).toContain('checked:bg-accent');
    expect(html).toContain('checked:border-accent');
    expect(html).toContain('text-on-accent');
    expect(html).toContain('checked=""');
  });

  it('describes the box by its second line', () => {
    const html = renderToStaticMarkup(
      <Checkbox id="sms" label="Text reminders" description="One a day before" />,
    );
    expect(html).toContain('aria-describedby="sms-description"');
    expect(html).toContain('id="sms-description" class="text-sm text-ink-muted"');
  });
});
