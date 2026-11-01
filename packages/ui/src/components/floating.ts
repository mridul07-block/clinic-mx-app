/**
 * Class recipes the overlays share (design system v3 section 8, "Floating list", IconButton).
 * Not a component: menu, popover, combobox, sheet, dialog and toast import these so a floating
 * panel looks the same wherever it opens.
 */

/**
 * A floating panel (menus, popovers, combobox lists): 12 px radius, `line` border, white, 4 px
 * padding, `shadow-float`. It fades in and out in 120 ms with Base UI's starting and ending
 * attributes; nothing slides (section 5: only drawers and toasts travel). Stacks at 50 with
 * menus, lists and tooltips (section 4.5); the z-index sits on the positioner.
 */
export const floatingPanelClass = [
  'rounded-panel border border-line bg-surface p-1 text-base text-ink shadow-float outline-none',
  'origin-(--transform-origin) transition-opacity duration-[var(--duration-quick)] ease-standard',
  'data-starting-style:opacity-0 data-ending-style:opacity-0',
].join(' ');

/** The positioner that carries a floating panel: z-index 50 (section 4.5). */
export const floatingPositionerClass = 'z-50 outline-none';

/**
 * An option or menu item: at least 32 px (44 on touch), 8 px radius, 10 px left padding, 8 px
 * gap, highlighted on `surface-hover`; disabled items go faint. Icons are 16 px in `ink-muted`.
 */
export const floatingItemClass = [
  'flex min-h-8 w-full cursor-default items-center gap-2 rounded-control py-1.5 pr-2.5 pl-2.5 text-left text-base text-ink outline-none select-none pointer-coarse:min-h-11',
  'data-highlighted:bg-surface-hover data-disabled:cursor-not-allowed data-disabled:text-ink-faint',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-muted',
].join(' ');

/** A thin rule between groups of items. */
export const floatingSeparatorClass = '-mx-1 my-1 h-px bg-line';

/** A small muted heading over a group of items. */
export const floatingGroupLabelClass = 'px-2.5 pt-2 pb-1 text-sm font-medium text-ink-muted';

/**
 * The close icon button of drawers, dialogs and toasts (section 8, IconButton): 36 px square
 * (44 on touch), `ink-muted`, hover `surface-hover` and `ink`. Give it `aria-label="Close"`.
 */
export const closeButtonClass = [
  'inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-muted pointer-coarse:size-11',
  'transition-colors duration-[var(--duration-quick)] hover:bg-surface-hover hover:text-ink',
  '[&_svg]:size-4',
].join(' ');
