import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, sheetBackdropClass, sheetPopupClass } from './sheet';

vi.mock('@base-ui/react/dialog', async () => ({
  Dialog: (await import('./overlay-test-double')).dialogDouble(),
}));

const noop = () => undefined;

describe('Sheet', () => {
  it('is open exactly when the caller says (the address drives it)', () => {
    expect(
      renderToStaticMarkup(
        <Sheet open={false} onOpenChange={noop} title="Appointment">
          Body
        </Sheet>,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <Sheet open onOpenChange={noop} title="Appointment">
          Body
        </Sheet>,
      ),
    ).toContain('Body');
  });

  it('has a header with the title, subtitle and a close button named Close', () => {
    const html = renderToStaticMarkup(
      <Sheet open onOpenChange={noop} title="Appointment" subtitle="Today, 10:30 to 11:15">
        Details
      </Sheet>,
    );
    expect(html).toContain('>Appointment</h2>');
    expect(html).toContain('>Today, 10:30 to 11:15</p>');
    expect(html).toMatch(/data-part="close"[^>]*aria-label="Close"/);
    expect(html).toContain('overflow-y-auto');
  });

  it('pins a footer with the safe area under it, and leaves the body to pad itself without one', () => {
    const withFooter = renderToStaticMarkup(
      <Sheet
        open
        onOpenChange={noop}
        title="Free slot"
        footer={<button type="button">Book</button>}
      >
        Body
      </Sheet>,
    );
    expect(withFooter).toMatch(
      /bg-surface-subtle[^"]*pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]"><button type="button">Book/,
    );
    const without = renderToStaticMarkup(
      <Sheet open onOpenChange={noop} title="Free slot">
        Body
      </Sheet>,
    );
    expect(without).toContain('pb-[max(1rem,env(safe-area-inset-bottom))]');
  });

  it('is modal by default and can sit beside a list the person keeps using', () => {
    const modal = renderToStaticMarkup(
      <Sheet open onOpenChange={noop} title="A">
        Body
      </Sheet>,
    );
    expect(modal).toContain('data-modal="true"');
    const beside = renderToStaticMarkup(
      <Sheet open onOpenChange={noop} title="A" modal={false}>
        Body
      </Sheet>,
    );
    expect(beside).toContain('data-modal="false"');
  });

  it('is a bottom sheet on a phone and a floating 480 px right drawer from 768 px', () => {
    // Phone: full width from the bottom, 16 px top corners, 90% high at most, over the scrim.
    expect(sheetPopupClass).toContain('inset-x-0 bottom-0 max-h-[90dvh] rounded-t-sheet');
    expect(sheetBackdropClass).toContain('bg-scrim');
    expect(sheetBackdropClass).toContain('md:hidden');
    // Desktop: 8 px from the top, right and bottom, 480 px, drawer corners and shadow, no scrim.
    expect(sheetPopupClass).toContain('md:inset-y-2 md:right-2');
    expect(sheetPopupClass).toContain('md:max-w-drawer');
    expect(sheetPopupClass).toContain('md:rounded-drawer md:shadow-drawer');
    // Stacks at 30, under confirm dialogs (40) and menus (50).
    expect(sheetPopupClass).toContain('z-30');
  });
});
