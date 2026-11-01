import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('is a plain button, primary teal, by default', () => {
    const html = renderToStaticMarkup(<Button>Check in</Button>);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('bg-accent');
    expect(html).toContain('text-on-accent');
    expect(html).toContain('>Check in</button>');
  });

  it('submits a form only when asked', () => {
    expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it('is gold with ink text on patient pages', () => {
    const html = renderToStaticMarkup(<Button variant="patient">Next</Button>);
    expect(html).toContain('bg-brand');
    expect(html).toContain('text-on-brand');
    expect(html).not.toContain('bg-accent');
  });

  it('shows fixed text and cannot be pressed while its action runs', () => {
    const html = renderToStaticMarkup(
      <Button pending pendingText="Saving">
        Save
      </Button>,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('>Saving</button>');
  });

  it('lets layout classes override its own', () => {
    expect(buttonVariants({ width: 'full' })).toContain('w-full');
    const html = renderToStaticMarkup(<Button className="w-auto">Go</Button>);
    expect(html).toContain('w-auto');
  });

  it.each([
    ['secondary', 'bg-surface'],
    ['quiet', 'text-accent'],
    ['danger', 'text-danger'],
    ['danger-fill', 'bg-danger-strong'],
  ] as const)('has the %s look', (variant, expected) => {
    expect(buttonVariants({ variant })).toContain(expected);
  });

  it('is 44 px on touch screens at the default size and 56 px on patient pages', () => {
    expect(buttonVariants()).toContain('pointer-coarse:h-row-touch');
    expect(buttonVariants({ size: 'lg' })).toContain('h-target-patient');
  });
});
