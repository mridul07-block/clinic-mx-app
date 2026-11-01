import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  floatingItemClass,
  floatingPanelClass,
  floatingPositionerClass,
  closeButtonClass,
} from './floating';
import { Menu, MenuContent, MenuItem, MenuLinkItem, MenuTrigger } from './menu';

describe('Menu', () => {
  it('renders its trigger as a menu button until opened', () => {
    const html = renderToStaticMarkup(
      <Menu>
        <MenuTrigger aria-label="Row actions">More</MenuTrigger>
        <MenuContent>
          <MenuItem>Reschedule</MenuItem>
          <MenuLinkItem href="/app/settings">Settings</MenuLinkItem>
        </MenuContent>
      </Menu>,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Row actions"');
    expect(html).toContain('>More</button>');
    expect(html).not.toContain('Reschedule');
  });

  it('can take another element as its trigger', () => {
    const html = renderToStaticMarkup(
      <Menu>
        <MenuTrigger render={<button type="button" className="w-full" />}>Options</MenuTrigger>
        <MenuContent>
          <MenuItem>One</MenuItem>
        </MenuContent>
      </Menu>,
    );
    expect(html).toMatch(/<button type="button" class="w-full"[^>]*>Options<\/button>/);
  });
});

describe('the floating list recipe', () => {
  it('is a 12 px panel with a line border, white, 4 px padding and the float shadow', () => {
    expect(floatingPanelClass).toContain('rounded-panel border border-line bg-surface p-1');
    expect(floatingPanelClass).toContain('shadow-float');
    expect(floatingPositionerClass).toContain('z-50');
  });

  it('has items of 32 px (44 on touch) that highlight on surface-hover', () => {
    expect(floatingItemClass).toContain('min-h-8');
    expect(floatingItemClass).toContain('pointer-coarse:min-h-11');
    expect(floatingItemClass).toContain('rounded-control');
    expect(floatingItemClass).toContain('data-highlighted:bg-surface-hover');
  });

  it('closes with a 36 px (44 on touch) muted icon button', () => {
    expect(closeButtonClass).toContain('size-9');
    expect(closeButtonClass).toContain('pointer-coarse:size-11');
    expect(closeButtonClass).toContain('text-ink-muted');
    expect(closeButtonClass).toContain('hover:bg-surface-hover hover:text-ink');
  });
});
