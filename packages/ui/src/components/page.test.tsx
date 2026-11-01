import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contextLine, Page, PageHeader, pageWidthClass } from './page';

describe('Page', () => {
  it('is a <main> with the page padding and the content width by default', () => {
    const html = renderToStaticMarkup(<Page>Body</Page>);
    expect(html).toMatch(/^<main class="w-full px-4 py-6 lg:px-6 xl:p-8">/);
    expect(html).toContain('max-w-[65rem]');
    expect(html).toContain('mx-auto flex w-full flex-col gap-6');
    expect(html).not.toContain('id=');
  });

  it('has the form, content and full widths and never the sign in width', () => {
    expect(pageWidthClass).toEqual({ form: 'max-w-[40rem]', content: 'max-w-[65rem]', full: '' });
    expect(renderToStaticMarkup(<Page width="form">x</Page>)).toContain('max-w-[40rem]');
    const full = renderToStaticMarkup(<Page width="full">x</Page>);
    expect(full).not.toMatch(/max-w-/);
  });

  it('passes attributes to the <main> and classes to the column', () => {
    const html = renderToStaticMarkup(
      <Page data-voice="patient" className="gap-8">
        x
      </Page>,
    );
    expect(html).toContain('<main class="w-full px-4 py-6 lg:px-6 xl:p-8" data-voice="patient">');
    expect(html).toContain('gap-8');
    expect(html).not.toContain('gap-6');
  });
});

describe('PageHeader', () => {
  it('shows the title as the h1 with its context line', () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Calendar" context={['HSR Layout', 'Live, updated 2 s ago']} />,
    );
    expect(html).toContain('<h1 class="min-w-0 text-title font-semibold text-ink">Calendar</h1>');
    expect(html).toContain(
      '<p class="text-sm text-ink-muted">HSR Layout · Live, updated 2 s ago</p>',
    );
  });

  it('joins context parts with a middle dot, skipping empty ones', () => {
    expect(contextLine(['A', '', 'B'])).toBe('A · B');
    expect(contextLine('Just one')).toBe('Just one');
  });

  it('puts a back link above the title, tags beside it and actions on the right', () => {
    const html = renderToStaticMarkup(
      <PageHeader
        title="Asha Rao"
        back={{ href: '/app/patients', label: 'Patients' }}
        tags={<span>Active</span>}
        actions={<button type="button">New booking</button>}
      />,
    );
    expect(html).toContain('href="/app/patients"');
    expect(html.indexOf('Patients</a>')).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain('<span>Active</span>');
    expect(html).toContain('md:flex-row');
    expect(html.indexOf('New booking')).toBeGreaterThan(html.indexOf('</h1>'));
  });

  it('renders the back link with the given link component', () => {
    function FakeLink({ href, children }: { href: string; children?: ReactNode }) {
      return (
        <a data-next="yes" href={href}>
          {children}
        </a>
      );
    }
    const html = renderToStaticMarkup(
      <PageHeader title="Bill" back={{ href: '/app/finance', label: 'Bills' }} link={FakeLink} />,
    );
    expect(html).toContain('data-next="yes"');
  });

  it('leaves out the parts it was not given', () => {
    const html = renderToStaticMarkup(<PageHeader title="Tasks" />);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<p');
  });
});
