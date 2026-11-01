import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  dialogBackdropClass,
  dialogPopupVariants,
} from './dialog';

vi.mock('@base-ui/react/dialog', async () => ({
  Dialog: (await import('./overlay-test-double')).dialogDouble(),
}));

describe('Dialog', () => {
  it('passes its open state to Base UI: nothing of the panel while closed', () => {
    const html = renderToStaticMarkup(
      <Dialog>
        <DialogTrigger>Open details</DialogTrigger>
        <DialogContent title="Details">Body</DialogContent>
      </Dialog>,
    );
    expect(html).not.toContain('Body');
  });

  it('has a header with the title, a description and a close button named Close', () => {
    const html = renderToStaticMarkup(
      <Dialog defaultOpen>
        <DialogContent title="Move the appointment" description="Pick a new time.">
          Body
        </DialogContent>
      </Dialog>,
    );
    expect(html).toContain('>Move the appointment</h2>');
    expect(html).toContain('>Pick a new time.</p>');
    expect(html).toMatch(/data-part="close"[^>]*aria-label="Close"/);
    expect(html).toContain('>Body</div>');
    expect(html).toContain('bg-scrim');
  });

  it('keeps the title for screen readers only when the header is hidden (search)', () => {
    const html = renderToStaticMarkup(
      <Dialog open onOpenChange={() => undefined}>
        <DialogContent title="Search" hideHeader placement="top">
          Results
        </DialogContent>
      </Dialog>,
    );
    expect(html).toContain('class="sr-only">Search</h2>');
    expect(html).not.toContain('aria-label="Close"');
  });

  it('pins a footer under the body', () => {
    const html = renderToStaticMarkup(
      <Dialog defaultOpen>
        <DialogContent title="Note" footer={<button type="button">Save</button>}>
          Body
        </DialogContent>
      </Dialog>,
    );
    expect(html).toMatch(/border-t border-line bg-surface-subtle[^"]*"><button type="button">Save/);
  });

  it('is a centred panel over the scrim at z-index 40, full screen on a phone for search', () => {
    expect(dialogBackdropClass).toContain('z-40');
    const centre = dialogPopupVariants();
    expect(centre).toContain('rounded-panel');
    expect(centre).toContain('shadow-float');
    expect(centre).toContain('-translate-y-1/2');
    const top = dialogPopupVariants({ placement: 'top' });
    expect(top).toContain('inset-0 h-dvh w-full rounded-none');
    expect(top).toContain('md:top-[12vh]');
  });
});
