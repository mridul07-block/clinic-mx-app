import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from './popover';

describe('Popover', () => {
  it('renders its trigger, marked as opening a dialog, until opened', () => {
    const html = renderToStaticMarkup(
      <Popover>
        <PopoverTrigger aria-label="About this figure">i</PopoverTrigger>
        <PopoverContent title="Conversion">
          <PopoverDescription>Booked a package after the first visit.</PopoverDescription>
        </PopoverContent>
      </Popover>,
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="About this figure"');
    expect(html).not.toContain('Booked a package');
  });

  it('can take a Button as its trigger', () => {
    const html = renderToStaticMarkup(
      <Popover>
        <PopoverTrigger render={<button type="button" className="ml-2" />}>Details</PopoverTrigger>
        <PopoverContent>Text</PopoverContent>
      </Popover>,
    );
    expect(html).toMatch(/<button type="button" class="ml-2"[^>]*>Details<\/button>/);
  });
});
