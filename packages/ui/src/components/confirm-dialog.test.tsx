import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

vi.mock('@base-ui/react/alert-dialog', async () => ({
  AlertDialog: (await import('./overlay-test-double')).dialogDouble(),
}));

const noop = () => undefined;

describe('ConfirmDialog', () => {
  it('asks with a title and description, "Go back" first, then the verb', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="Cancel this appointment?"
        description="The patient gets a WhatsApp message."
        confirmLabel="Cancel appointment"
        onConfirm={noop}
      />,
    );
    expect(html).toContain('>Cancel this appointment?</h2>');
    expect(html).toContain('>The patient gets a WhatsApp message.</p>');
    expect(html.indexOf('>Go back</button>')).toBeGreaterThan(-1);
    expect(html.indexOf('>Go back</button>')).toBeLessThan(html.indexOf('>Cancel appointment<'));
    // Focus starts on Go back (the popup is given a focus target), never on the confirm button.
    expect(html).toMatch(/data-part="popup"[^>]*data-initial-focus=""/);
  });

  it('confirms in teal unless destructive, when it takes the danger fill', () => {
    const plain = renderToStaticMarkup(
      <ConfirmDialog open title="Send the link?" confirmLabel="Send link" onConfirm={noop} />,
    );
    expect(plain).toContain('bg-accent');
    expect(plain).not.toContain('bg-danger-strong');
    const destructive = renderToStaticMarkup(
      <ConfirmDialog
        open
        destructive
        title="Mark no show?"
        confirmLabel="Mark no show"
        onConfirm={noop}
      />,
    );
    expect(destructive).toContain('bg-danger-strong');
  });

  it('shows fixed pending text and disables both buttons while the action runs', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        pending
        pendingLabel="Cancelling"
        title="Cancel this appointment?"
        confirmLabel="Cancel appointment"
        onConfirm={noop}
      />,
    );
    expect(html).toContain('>Cancelling</button>');
    expect(html).not.toContain('>Cancel appointment<');
    expect(html).toMatch(/data-part="close"[^>]*disabled=""[^>]*>Go back/);
    expect(html).toContain('aria-busy="true"');
  });

  it('takes other cancel words and extra content, and renders nothing while closed', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        defaultOpen
        title="Discard the note?"
        confirmLabel="Discard"
        cancelLabel="Keep writing"
        onConfirm={noop}
      >
        <p>Reason field</p>
      </ConfirmDialog>,
    );
    expect(html).toContain('>Keep writing</button>');
    expect(html).toContain('<p>Reason field</p>');
    expect(
      renderToStaticMarkup(<ConfirmDialog title="T" confirmLabel="Go" onConfirm={noop} />),
    ).toBe('');
  });
});
