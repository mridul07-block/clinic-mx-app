import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  it('is a native checkbox with the switch role and a visible label', () => {
    const html = renderToStaticMarkup(<Switch name="reminders" label="Send reminders" />);
    expect(html).toMatch(/^<label for="[^"]+"/);
    expect(html).toContain('type="checkbox" role="switch"');
    expect(html).toContain('name="reminders"');
    expect(html).toContain('>Send reminders</span>');
  });

  it('is a 32 by 18 px track, line-control off and teal on, with a 14 px knob', () => {
    const html = renderToStaticMarkup(<Switch label="On" defaultChecked />);
    expect(html).toContain('h-[18px] w-8');
    expect(html).toContain('rounded-full bg-line-control');
    expect(html).toContain('checked:bg-accent');
    expect(html).toContain('size-3.5');
    expect(html).toContain('peer-checked:translate-x-3.5');
    expect(html).toContain('checked=""');
  });

  it('is 44 px on touch screens', () => {
    expect(renderToStaticMarkup(<Switch label="On" />)).toContain('pointer-coarse:min-h-row-touch');
  });
});
