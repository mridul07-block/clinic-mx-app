import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorSummary, Field } from './field';
import { Input } from './input';

describe('Field', () => {
  it('puts the label above the control and ties them together', () => {
    const html = renderToStaticMarkup(
      <Field label="Email" id="email">
        {(control) => <Input {...control} name="email" />}
      </Field>,
    );
    expect(html).toContain(
      '<label for="email" class="text-base font-medium text-ink">Email</label>',
    );
    expect(html).toContain('id="email"');
    expect(html.indexOf('<label')).toBeLessThan(html.indexOf('<input'));
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('aria-invalid');
  });

  it('describes the control by its helper and error, and marks it invalid', () => {
    const html = renderToStaticMarkup(
      <Field
        label="Mobile"
        id="mobile"
        helper="We send the reminder here"
        error="Enter a mobile number"
      >
        {(control) => <Input {...control} name="mobile" />}
      </Field>,
    );
    expect(html).toContain('aria-describedby="mobile-helper mobile-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="mobile-helper" class="text-sm text-ink-muted"');
    expect(html).toContain('id="mobile-error"');
    expect(html).toContain('text-danger');
    expect(html).toContain('<span class="sr-only">Error: </span>Enter a mobile number');
    expect(html.indexOf('id="mobile-helper"')).toBeLessThan(html.indexOf('id="mobile-error"'));
  });

  it('says "(optional)" and never stars a required field', () => {
    const html = renderToStaticMarkup(
      <Field label="Note" optional>
        {(control) => <Input {...control} name="note" />}
      </Field>,
    );
    expect(html).toContain(' (optional)');
    expect(html).not.toContain('*');
  });

  it('makes its own id when none is given', () => {
    const html = renderToStaticMarkup(
      <Field label="Name" helper="As on the ID">
        {(control) => <Input {...control} name="name" />}
      </Field>,
    );
    const id = /<input[^>]* id="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(id).not.toBe('');
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-helper"`);
  });
});

describe('ErrorSummary', () => {
  it('links each error to its field under "There is a problem"', () => {
    const html = renderToStaticMarkup(
      <ErrorSummary
        errors={[
          { fieldId: 'email', message: 'Enter an email address' },
          { fieldId: 'mobile', message: 'Enter a mobile number' },
        ]}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('There is a problem');
    expect(html).toContain('href="#email"');
    expect(html).toContain('>Enter a mobile number</a>');
    expect(html).toContain('border-danger-line');
  });

  it('renders nothing without errors', () => {
    expect(renderToStaticMarkup(<ErrorSummary errors={[]} />)).toBe('');
  });
});
