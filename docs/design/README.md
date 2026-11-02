# Design system v3: teal and gold

The complete visual language of Clinic Mx, written so it can be rebuilt in any codebase, any framework, or Figma. v3 (1 November 2026, UIX-01) replaces v2 "ink and gold": the user chose a deep teal for actions, cool slate neutrals and Inter after a review of the staging app and research into clinic software (Jane, Cliniko) and healthcare design systems (NHS, CMS, VA, USWDS). Everything else in v2 (principles, status pattern, charts, rules) carries over.

**In one line:** a clinical instrument, calm and exact. Slate ink on cool white, one deep teal for actions, a gold mark for identity, and colour only for status and data.

## What is in this folder, and where the code is

| File | What it is | Use it when |
|---|---|---|
| `README.md` | This guide: principles, colour, type, layout, every component's recipe, rules | Always; hand it to a designer or another AI as the brief |
| `tokens.json` | Every token in W3C design token format | Importing into Figma (Tokens Studio), Style Dictionary, or a non-CSS stack |
| `brand/movementology-logo.svg` | Full Movementology logo | Sidebar, sign in, receipts |
| `brand/movementology-mark.svg` | The gold M mark | Kiosk welcome, survey pages, rail |
| `brand/favicon.svg` | Browser tab icon | `<link rel="icon">` |

The CSS lives in the app, not here, so there is one copy: `packages/ui/src/styles/` holds `tokens.css` (the only file with colour values), `theme.css` (the Tailwind v4 theme, with Tailwind's default palette removed), `base.css` (body text, focus ring, reduced motion), `motion.css`, `hatch.css` and `charts.css`. `packages/ui/src/token-values.ts` mirrors the few values the manifest, icons and PDFs need. `pnpm check:design` keeps all of them honest. The React components are in `packages/ui` too, built on Base UI (section 8).

**About the brand:** the gold `#FCB714` and the logo belong to Movementology (from the official logo file). If the software you are building is for someone else, change only the `--brand`, `--brand-deep` and the SVGs. Everything else is neutral and carries over unchanged; the system was built so the brand is a mark, not the whole palette.

### Quick start (Tailwind v4)

`apps/web/app/globals.css` imports the styles from `@clinic-mx/ui/styles/*`. Then only token utilities exist: `bg-canvas`, `text-ink-muted`, `border-line-control`, `text-title`, `rounded-panel`, `shadow-float`, `h-row`, `w-drawer`. `bg-red-500` or `font-bold` generate nothing, on purpose. Write class names out in full (never `bg-${tone}`), or Tailwind cannot see them.

---

## 1. Principles

1. **Calm by default, loud only when it matters.** Red is for emergencies, no shows and missing money. An overdue task or a long wait is amber, not red.
2. **Every number has context:** a target, the previous period or a trend. A bare number is never shown.
3. **Each visual channel means one thing.** On a calendar block the left strip is the status, the fill is live or ended, icons are money and VIP, and a warning is named in words.
4. **One accent for action, gold for identity, colour for status and data.**
5. **Density with air.** Dense rows (36 px with a mouse, 44 px on touch) inside generous sections (24 to 32 px apart).
6. **Motion explains change and never decorates.** Values glide when they change; nothing enters on load except a chart's first draw.
7. **Live figures say how fresh they are** ("Live, updated 3 s ago").
8. **Text carries meaning too.** Every status has a word, every chart has a table, every colour has a label.
9. **One primary action per panel.** Every screen has one obvious next step.
10. **Plain words.** Sentence case, verbs on buttons, no jargon.

---

## 2. Colour

The palette is written as hex so every browser and contrast checker sees the same colour. The neutrals are one cool slate family (never mixed with warm greys); the status colours keep their v2 hues. Every text pair reaches 4.5:1 and every mark or control border 3:1 (WCAG 2.2 AA); the ratios below were measured for v3 and `pnpm check:design` re-checks them on every run.

### 2.1 Neutrals (most of the screen)

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F5F7F9` | The app frame and sidebar, behind the sheet. Cool off white |
| `surface` | `#FFFFFF` | The sheet, panels, drawers, inputs |
| `surface-subtle` | `#F8FAFB` | Table header band, panel and drawer footers |
| `surface-hover` | `#EEF2F5` | Row and item hover |
| `surface-sunken` | `#E9EEF2` | Wells, tracks, skeletons, avatars, secondary slots |
| `line` | `#E2E8EE` | Hairlines, panel borders, grid lines |
| `line-strong` | `#CBD5DF` | Dividers, secondary button borders |
| `line-control` | `#7B8A9C` | Where a control is: inputs, selects, checkboxes, outline tags. 3.5:1 on white, 3.3:1 on canvas |
| `ink` | `#0F1A24` | Text. A slate near black, never pure `#000` |
| `ink-secondary` | `#334252` | Secondary text, sidebar links |
| `ink-muted` | `#4A5868` | Labels, meta, axis labels, chart cells (7:1 on white) |
| `ink-faint` | `#66737F` | Placeholders and disabled text only. Never carries meaning (4.9:1 on white) |

### 2.2 Accent, brand, focus

| Token | Hex | Use |
|---|---|---|
| `accent` | `#0E6B6B` | **Deep teal.** Primary buttons, checked boxes, switches, active tab underline, links, the current page's label. White on it 6.3:1; as text 6.3:1 on white, 5.9:1 on canvas |
| `accent-hover` | `#0A5656` | Primary button hover (white on it 8.5:1) |
| `accent-soft` | `#E5F2F1` | Selected row, quiet button hover, a new row's highlight (teal text on it 5.5:1) |
| `on-accent` | `#FFFFFF` | Text on the accent |
| `brand` | `#FCB714` | **Movementology gold.** The logo, the 3 px current-page marker in the sidebar and the phone tab bar, the kiosk welcome mark, the receipt, and the primary button on patient pages. **A mark and a fill only, never text** (1.7:1 on white) |
| `brand-deep` | `#BB8503` | A gold icon that must reach 3:1 |
| `on-brand` | `#0F1A24` | Text on a gold fill (10:1) |
| `focus` | `#2563EB` | The focus ring. Blue so it never looks like a selection or the teal accent (5.2:1 on white, 4.5:1 on `accent-soft`); drawn 2 px outside the control, so it sits on the surface, not on the teal |

Why teal for actions: the review of the staging app (1 November 2026) found the monochrome v2 screens looked unfinished and the next step hard to spot. One calm colour that means "you can act here" fixes that without competing with status: teal sits between the info blue and the active green but is darker than both, it is never used for a status, and charts use blue (`viz-1`), so a teal thing is always a button, a link or where you are. Gold marks identity and position; teal says what you can do; status colours say what state things are in.

### 2.3 Status (always a tint, strong text, a same-hue border, and a word)

This is the NHS tag pattern. Colour is never the only signal.

| Tone | Text | Tint (`-soft`) | Border (`-line`) | Strong | Used for |
|---|---|---|---|---|---|
| info | `#2460A8` | `#EBF6FF` | `#B7D4F9` | | Confirmed, informational |
| waiting | `#8A5100` | `#FFF3D3` | `#F0CB8D` | `#BB7400` (dots, marks; **never text**: 3.4:1 on its tint) | Needs attention: not marked, overdue, long wait, below target, warnings |
| active | `#1D7339` | `#EBF9ED` | `#B6DDBD` | | In progress, on target, clear |
| done | `#4A5868` | `#EEF2F5` | `#CBD5DF` | | Completed, closed |
| danger | `#AC2724` | `#FFEFED` | `#F6C3BC` | `#B7191C` with white text (6.6:1) | No show, urgent, money missing. The solid strong red only for a real emergency: its banner, badge and row |

`warning` is an alias of `waiting`. Red stays scarce: people ignore alerts that are everywhere. Status text always uses the plain tone (`text-waiting`, `text-danger`); the `-strong` tones are for dots, marks and the emergency fill only.

**Status to tone mapping (appointments, Frontend Specification section 9):** Booked = outline in `line-control` · Confirmed = info · Checked in = info · In progress = active · Completed = done · Cancelled / Rescheduled = neutral, hatched, time struck through · No show = danger. Amber only ever means "needs attention".

### 2.4 Data colours (charts only)

| Token | Hex | Use |
|---|---|---|
| `viz-1` | `#1B6AB6` | The main series. Blue, not the teal accent, so a chart never reads as a button |
| `viz-compare` | `#C5CED8` | Previous period, "not converted", other series behind the one in focus |
| `viz-target` | `#4A5868` | Target lines: 1 px dashed, labelled at their end |
| `viz-centre-1/2/3` | `#2F74BB` `#7F5BB6` `#1C8580` | The three centres (blue, violet, teal). Reserved: they mean those centres everywhere and nothing else uses them. Unchanged from v2 because each centre row stores its colour |
| `viz-promoter / passive / detractor` | `#2F74BB` `#C8D1DA` `#D8662A` | NPS parts. Blue and orange stay apart for colour blind readers |
| `viz-ramp-1` to `7` | `#EAF5FF` `#C7E1FF` `#9FC8F7` `#73ACEB` `#4C8FD8` `#2773C0` `#0E599D` | Heatmaps: one hue, lightness falling in even steps |

Stacked parts are separated by a 2 px white gap. Series hues sit away from status hues.

### 2.5 Scrim

`rgb(15 26 36 / 40%)` dims the page behind a confirm dialog and behind a bottom sheet on phones. Desktop drawers have no scrim.

---

## 3. Typography

### 3.1 Fonts

| Role | Font | Why |
|---|---|---|
| All UI | **Inter** (variable) | Drawn for dense screens: tall x-height, clear at 14 to 16 px, narrower than IBM Plex so more fits at 360 px. Tabular figures, the ₹ glyph, open licence (OFL) |
| IDs, invoice numbers, keyboard hints | **Inter with `tnum` and `ss02`** (the `font-mono` utility) | Tabular figures line IDs up; `ss02` is Inter's set for characters that must not be confused (slashed zero, `l` with a tail, `I` with serifs). One font file instead of two |

Load Inter with `next/font/google` (self hosted on our domain, rule 9). Keep the Latin Extended subset: the ₹ sign lives there. Many popular fonts (Onest, Instrument Sans, Hanken Grotesk) have no ₹; check the font file before swapping. English only (rule 8), so no other scripts.

```css
--font-sans: var(--font-inter), 'Inter', system-ui, sans-serif;
--font-mono: var(--font-inter), 'Inter', ui-monospace, monospace;
--font-mono--font-feature-settings: 'tnum', 'ss02';
```

PDFs (react-pdf) embed Inter's static Regular, Medium and SemiBold files; OP and bill numbers there keep IBM Plex Mono if react-pdf cannot apply Inter's `ss02` (Frontend Specification section 11).

### 3.2 Scale (base 16 px for staff and patients, nothing under 14 px)

| Token | Size / line height | Tracking | Weight | Use |
|---|---|---|---|---|
| `axis` | 12 / 16 | | 400 or 500 | Chart axes and the 24 px avatar's initials only |
| `sm` | 14 / 20 | | 400 | Secondary lines, tags, meta, table headers, grid times; the smallest text anywhere else |
| `base` | 16 / 24 | | 400, 500 for emphasis | Body, table rows, inputs, buttons |
| `md` | 16 / 24 | -0.01em on titles | 600 | Panel and drawer titles |
| `lg` | 18 / 26 | | 600 | Error panel titles, kiosk answers |
| `xl` | 22 / 30 | -0.01em | 600 | A measure against its target; large input |
| `title` | 24 / 32 | -0.015em | 600 | Page title, the page's only h1 |
| `display` | 32 / 40 | -0.02em | 600 | The one number that matters in a panel; kiosk questions |
| `2xl` | 28 / 36 | | 600 | Patient page headings only |

Only three weights exist: 400, 500, 600. **No bold (700).**

**Form controls on touch screens are 16 px.** On `(pointer: coarse)` every input, select and textarea uses 16 / 24 whatever the screen, because iOS Safari zooms the page into any field under 16 px. Staff body text stays 14 px; with a mouse controls stay 14 px. Never block zoom with `maximum-scale`.

### 3.3 Type rules

* Sentence case everywhere, including buttons and headings. **No all caps labels or eyebrows.**
* Body uses proportional figures; tables, times, axes and money columns use `font-variant-numeric: tabular-nums`. A large standalone figure stays proportional.
* Italics only for patient quotes.
* `text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased;`

### 3.4 Formats

* Money: `₹12,500`, grouped the Indian way (`₹1,20,000`). In charts and headlines above a lakh: `₹1.2L`, `₹3.4Cr`; below a lakh the full number.
* Dates `28 Sep 2026` (write your own month names: some `Intl` builds give "Sept"). Times `4:05 PM`. Phones `+91 98450 12345`.

---

## 4. Space, shape, elevation

### 4.1 Spacing

4 px steps: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64**.

* Page padding: 32 px from 1280 px wide, 24 px from 1024 px, 16 px below.
* Panel padding 20 px; panels 24 px apart.
* Sections 24 to 32 px apart; rows inside them dense.

### 4.2 Radius

| Token | Value | On |
|---|---|---|
| `control` | 8 px | Buttons, inputs, selects, list options |
| `tag` | 6 px | Tags and badges |
| checkbox | 4 px | Checkboxes and key hints |
| `panel` | 12 px | Panels, floating lists, sign in panel |
| `sheet` | 16 px | The page sheet, bottom sheets on phones |
| `drawer` | 16 px | Drawers |
| full | | Avatars, dots, switches |

Table cells and calendar grids are square.

### 4.3 Elevation

| Token | Value | On |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgb(15 26 36 / 6%)` | Panels, the sheet, buttons, inputs: a hairline only |
| `shadow-float` | `0 12px 32px -8px rgb(15 26 36 / 18%), 0 2px 6px rgb(15 26 36 / 6%)` | Menus, popovers, select lists, toasts |
| `shadow-drawer` | `-24px 0 48px -16px rgb(15 26 36 / 18%), -1px 0 0 rgb(15 26 36 / 4%)` | Right drawers |

Panels are defined by a **1 px `line` border plus `shadow-xs`**. Only things that float cast a real shadow, tinted with the slate ink, never pure black. No glass, blur or gradients.

### 4.4 Heights and touch

| Size | Value | Where |
|---|---|---|
| `row` | 36 px | Controls and table rows with a mouse |
| `row-touch` | 44 px | The same on touch screens |
| small button | 28 px | Toolbars and dense rows |
| `target-patient` | 56 px | Kiosk and patient pages |
| answer | 64 px | Kiosk Yes / No |

The switch follows the **pointer, not the width**: `@media (pointer: coarse)` gives 44 px, a mouse keeps 40 px at any screen size.

### 4.5 Layout sizes and stacking

Sidebar 240 px · rail 64 px · drawer 480 px · sign in panel 400 px · document width 880 px.
z-index: drawer 30, confirm dialog 40, menus / lists / tooltips 50, toasts 60, lock screen 70.

---

## 5. Motion

| Token | Value | For |
|---|---|---|
| `duration-quick` | 120 ms | Hover, press, colour changes |
| `duration-motion` | 240 ms | Drawers, toasts, chart changes |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Everything entering; `ease-in` for leaving |

* Drawers slide in from the right (travelling their width plus 16 px); toasts slide in from the left and fade out.
* When live data changes, bars and points glide to their new place, and a figure glides to its new value from what is on screen.
* A chart draws once when it first appears: bars rise and lines draw in 240 ms, bars staggered 12 ms apart.
* A new row in a live list starts on `accent-soft` and fades to plain over 1.6 s.
* A freshly created item can pulse an accent outline three times (1.2 s each) so people spot it.
* **Nothing else moves on load:** no count ups, no pulsing dots, no hover animation on every element. Under `prefers-reduced-motion: reduce` nothing moves at all.

---

## 6. Iconography and imagery

* **lucide** icons, outline style, one stroke width (1.75) everywhere. 16 px in controls, 18 px in navigation, 14 px in small buttons, 20 px in empty states. Every navigation item and every status tag has its icon; elsewhere icons are used where they help scanning, not as decoration. An icon-only button always has a name (tooltip and `aria-label`).
* No emoji in the staff interface. **No sparkle, magic wand or robot icons for AI**: an assistant is named in words.
* No illustrations, blobs or background patterns. Empty states use a lucide icon in a 40 px sunken circle.
* People are shown as initials on a sunken circle (Avatar), not photos.

---

## 7. Layout

Desktop:

```
+------------------+------------------------------------------------------+
| [M] Movementology| [HSR Layout v]   [Search or jump to  Ctrl K] [bell 3](AR)|  <- top bar
|                  |------------------------------------------------------|
| Today          ▌ |  Calendar                         [New booking]      |
| Calendar         |  HSR Layout · Live, updated 2 s ago   < Today >      |
| Patients         |------------------------------------------------------|
| Tasks          5 |                                                      |
| Reports          |                page content (white sheet)            |
|                  |                                                      |
| (AR) Asha Rao  v |                                                      |
+------------------+------------------------------------------------------+
```

Phone (360 px):

```
+----------------------------------+
| Today         [Q] [bell 3] (AR) |  <- sticky top bar: title, search, bell, person menu
|----------------------------------|
| page content, one column         |
|                                  |
|                                  |
| [        Check in (primary)     ]|  <- the screen's one sticky primary action
|----------------------------------|
| ▔▔▔▔                             |  <- 3 px gold bar on the current tab
| Today  Calendar  Patients  More  |  <- bottom tabs by role (3 + More)
+----------------------------------+
```

* **Canvas and inset sheet.** The window background is `canvas`. The sidebar sits directly on it, with no border. The page is a white **sheet**: 1 px `line` border, 16 px corners, `shadow-xs`, 8 px from the window edges. The window scrolls, not the sheet. On phones the sheet runs edge to edge with no border or corners.
* **Top bar** (Frontend Specification section 4), on every signed in screen: the centre switcher (when the person works at more than one centre), "Search or jump to" with a `Ctrl K` hint, notifications with a count, and the person menu (account, centre, sign out). On phones it is a sticky 56 px bar with the page title, a search icon (opening search full screen), the bell and the person menu, inside `safe-area-inset-top`.
* **Sidebar** (240 px from 1280 px wide, a 64 px icon rail from 768 px):
  * Top: the logo (20 px high).
  * Navigation links in groups (Day to day, Clinical, Figures, Setup): 32 px rows, `ink-secondary` text, 18 px icons in `ink-muted`; hover `surface-hover`. **The current page sits on a white pill (`surface`, `line` border, `shadow-xs`) with `accent` text and icon and a 3 px gold bar on its left edge.** Counts of things needing action sit at the right in `xs ink-muted` (on the rail, a small `accent` badge with white text).
  * Foot: the person's initials, name and role, opening a menu upward.
* **Bottom tabs** (below 768 px): 3 tabs per role plus More, 56 px high plus the safe area, icon over a 12 px label; the current tab has `accent` icon and label and a 3 px gold bar on its top edge. Hidden on the consultation and session note screens, which pin their own actions.
* **Page widths** (the `Page` component): `form` 640 px for single forms, `content` 1040 px for records and lists, `full` for Today, the calendar and dashboards. Never a phone-width column on a desktop.
* **Page header** at the top of every sheet: the title (`title`, 24 px semibold), status tags beside it; one context line under it in `sm ink-muted`, its parts separated by a middle dot (the only place middle dots are allowed); an optional back link above in `sm ink-muted` (never a "Home" link: the navigation does that); actions on the right, at most one primary. On phones the primary action moves to the sticky action area above the tabs.
* **Record header** on a patient, episode, consultation or session: name, OP number (`font-mono`), age and sex; condition and episode stage; next visit, package sessions left and balance due; red flag and consent tags; the one primary action.
* **View, then edit.** Details show as read-only description lists with an Edit button; editing opens a sheet on phones or turns the panel into a form on desktop. Never an always-open form.
* **Command palette** on `Ctrl K` or `/`: patients by name or mobile, screens, and actions ("New booking", "Walk in").
* **Details open in a right drawer** on desktop so the list or calendar stays visible, and in a bottom sheet on phones for short tasks. Long tasks get a full page.
* **Emergency banner**: full width across the top of the sheet, solid `danger-strong`, white text, an icon in a 28 px circle of white at 15%, one action. Stays until acknowledged.

### Responsive

Phone first: every staff screen works fully from 360 px; bigger screens add room, never features.

| Width | Behaviour |
|---|---|
| 1536 px+ | Three-pane screens show their side pane |
| 1472 px sheet+ | Dashboard panels pair side by side (a container query on the sheet) |
| 1280 px+ | Full sidebar |
| 768 to 1279 px | Icon rail (names in tooltips with a mouse, small labels under icons on touch), list and detail side by side |
| Below 768 px | One column, sticky top bar, bottom tabs, sheets with the action pinned; tables become stacked cards |

Use container queries for parts that depend on their own width (a calendar block, a document pane), not the window width. Every page must work at 125% zoom on a 1366 px laptop without sideways scroll; a wide table scrolls inside its panel.

---

## 8. Components (exact recipes)

The components live in `packages/ui` and are exported from `@clinic-mx/ui/components/*`. They are built on **Base UI** (unstyled, accessible primitives) following shadcn/ui's Base UI recipes, with the code copied in and owned here, never generated by `shadcn init` (it writes `oklch()` colours and shadcn's token names). Dates and times use **React Aria Components** (DateField, DatePicker, TimeField, in Asia/Kolkata). When porting a shadcn recipe, rewrite its classes to ours: `bg-primary` → `bg-accent`, `text-primary-foreground` → `text-on-accent`, `bg-background` → `bg-surface`, `text-foreground` → `text-ink`, `bg-muted` → `bg-surface-sunken`, `text-muted-foreground` → `text-ink-muted`, shadcn's hover `bg-accent` → `bg-surface-hover`, `border-input` → `border-line-control`, `rounded-md` → `rounded-control`, `h-9` → `h-row` (touch `h-row-touch`), `text-sm` → `text-base`; drop `ring-ring` (the global focus ring does it) and every `dark:`. `pnpm check:design` rejects shadcn's names so a pasted snippet fails loudly instead of rendering unstyled.

`className` passed to a component is for layout only (margin, width, grid position); variants are typed maps inside the component (`class-variance-authority`), merged with a `cn()` that knows our token names.

### Button

Base: inline flex, centred, 8 px gap, 8 px radius, 1 px border, weight 500, text centred (a long label wraps rather than pushing past a 360 px screen; buttons in a row share it), colour transition 120 ms, pressed `scale(0.98)` (none under reduced motion). Defaults to `type="button"`.

| Look | Rest | Hover | Disabled |
|---|---|---|---|
| **Primary** (staff) | `accent` (teal) fill, white text, transparent border, `shadow-xs` | `accent-hover` | `surface-sunken` fill, `line` border, `ink-faint` text, no shadow |
| **Patient** (patient pages and kiosk) | `brand` (gold) fill, `on-brand` text, 56 px | `brand-deep` border | as primary |
| **Secondary** | `surface` fill, `line-strong` border, `ink` text, `shadow-xs` | border `line-control`, fill `surface-hover` | `surface-subtle`, `line` border, `ink-faint` |
| **Quiet** | transparent, `accent` text | `accent-soft` fill | `ink-faint` |
| **Danger** | `surface` fill, `line-strong` border, `danger` text | border `danger-line`, fill `danger-soft` | as secondary |
| **Danger fill** | `danger-strong`, white text. **Only inside a confirm dialog** | `danger` | as primary |

| Size | Height | Padding x | Text | Icon |
|---|---|---|---|---|
| small | 28 px (44 on touch) | 10 px | 14 px | 14 px |
| default | 40 px (44 on touch) | 14 px | 16 px | 16 px |
| large | 56 px | 24 px | 16 px | 20 px |
| answer | 64 px | 24 px | 18 px | 24 px |

While an action runs the button is disabled with fixed text ("Saving"), **no spinner**. Button labels are verbs that say what happens ("Check in", "Send UPI link"); **no arrows in button text**.

### IconButton
Square, 36 px (44 touch), a lucide icon, required name used for the tooltip and `aria-label`. Close buttons in drawers and toasts: `ink-muted`, hover `surface-hover` and `ink`.

### Inputs (Input, Select trigger, Combobox, TextArea)
Full width, 40 px high (44 touch), 12 px horizontal padding, 8 px radius, **1 px `line-control` border**, `surface` fill, `shadow-xs`, 16 px `ink` text, placeholder `ink-faint`. The right `inputmode` and `autocomplete` on every field (mobile numbers `tel`, amounts `decimal`). Hover: border `ink-muted`. Invalid (`aria-invalid`): border `danger`. Disabled: `line` border, `surface-subtle` fill, `ink-faint`, no shadow. A **large** input (48 px, 22 px semibold tabular) for the one figure that is the point of a screen.

### Field
Label above (16 px, 500), helper text below in `sm ink-muted`, error below the helper in `danger` with an icon. Optional fields say "(optional)"; required ones are not starred. Placeholders are never labels. Errors appear when the form is sent, not while typing; a form with more than one error also shows an error summary at its top linking to each field (NHS pattern). What the person typed is never cleared.

### Floating list (Select, Combobox, Menu)
Panel: 12 px radius, `line` border, `surface`, 4 px padding, `shadow-float`. Options: min 32 px (44 touch), 6 px radius, 10 px left padding, 8 px gap; highlighted on `surface-hover`; a tick on the right for the chosen one.

### Checkbox and Switch
* Checkbox: 16 px square, 4 px radius, `line-control` border, `surface` fill, `shadow-xs`; checked: `accent` fill and border with a white tick. The whole label row is the target.
* Switch: 32 × 18 px track, full radius, `line-control` when off, `accent` when on; a 14 px white knob with `shadow-xs` that moves 14 px.
* ChoiceGroup: one of a few answers as large selectable rows.

### Tag and StatusBadge
Inline flex, 6 px radius, 1 px border, weight 500, no wrap. Default 24 px high, 8 px padding, 14 px text; small 22 px, 6 px padding, 14 px. Optional 6 px round dot before the word.

| Tone | Border | Fill | Text | Dot |
|---|---|---|---|---|
| neutral | `line` | `surface-sunken` | `ink-secondary` | `ink-muted` |
| outline | `line-control` | `surface` | `ink` | ring `ink-muted` |
| info | `info-line` | `info-soft` | `info` | `info` |
| waiting | `waiting-line` | `waiting-soft` | `waiting` | `waiting-strong` |
| active | `active-line` | `active-soft` | `active` | `active` |
| done | `done-line` | `done-soft` | `done` | `done` |
| danger | `danger-line` | `danger-soft` | `danger` | `danger` |
| emergency | `danger-strong` | `danger-strong` | white | white |
| muted | `line` | `surface` | `ink-muted` | ring `ink-faint` |

StatusBadge is a Tag with a dot and a required word. Tags use adjectives ("Overdue", "Below target"), never colour alone.

### Panel (the unit of every page)
`surface`, 1 px `line` border, 12 px radius, `shadow-xs`. Heading row: min 56 px, 20 px horizontal and 12 px vertical padding; title 16 px semibold, -0.01em; the window it measures beside it in `sm ink-muted` ("Last 3 months"); controls pushed right. Body padding 20 px (tables run edge to edge). Optional footer: top `line` border, 20 × 12 px padding, `sm ink-muted`.
**Panels differ in size and content. They never form a grid of identical tiles.**

### Metric (KPI cell)
Several metrics sit in **one panel split into cells by hairlines**, never as floating tiles. Each cell: label (`sm` 500 `ink-muted`), the figure (`display` 32 px or `xl` 22 px, semibold), the change in words ("8% on last week") with a small trend icon in `ink-secondary`, an optional tag ("Below target"), and a small chart under it: a pace line or a bullet graph against the target.

### Table
Below 768 px a table becomes a list of stacked cards (the first column as the card title, the rest as label and value pairs, the row action at the card's foot). From 768 px: full width, `border-spacing: 0`, 14 px, tabular numbers. Header: sticky, 36 px, `surface-subtle` band, bottom `line` border, 13 px 500 `ink-muted`, no wrap. Rows: 36 px (44 touch), bottom `line` border (none on the last row inside a panel), hover `surface-hover`, selected `accent-soft`. First cell 20 px left padding, last 20 px right, others 12 px. Numbers right aligned. **No zebra stripes.** Sortable headers carry `aria-sort`. A danger row (`danger-soft`) only for an emergency. Inline data bars (`viz-1`) against the column's highest.

### DescriptionList
Label and value pairs with a fixed label width (labels `ink-muted`), so every drawer's lists line up.

### Drawer
Right side, **floating 8 px from the top, right and bottom edges**, 480 px wide, 16 px radius, 1 px `line` border, `surface`, `shadow-drawer`, **no scrim**. Focus moves into it and returns to what opened it; `Esc` closes it. Below 768 px the same content is a **bottom sheet**: full width, 16 px top corners, a grab handle, over the scrim, at most 90% of the screen high, footer action pinned, closed by the Back gesture. Sheets are never stacked; a long task gets a full page instead. Header: bottom `line` border, 12 px vertical, 20 px left padding; optional 32 px avatar; title 16 px semibold; subtitle `sm ink-muted`; close icon button. Body: scrolls, 20 × 16 px padding. Footer: sticky, top `line` border, `surface-subtle`, 20 × 12 px, buttons with 8 px gap. Slides in 240 ms.

### ConfirmDialog
Only for confirmations and destructive actions, over the scrim. Focus starts on "Go back"; the confirm button is a verb, uses the danger fill when destructive, and shows pending.

### Tabs
Underline tabs: 40 px high (44 touch), weight 500, `ink-muted`, 2 px transparent bottom border. Hover `ink`. Active: `accent` 2 px underline, `ink` text.
Segmented control: a sunken track; the chosen segment is a white pill with a `line` border and `shadow-xs`.
Count row as tabs: a row of counts (To arrive 12, Here now 4) that are also the tabs.

### Toast
Bottom left (16 px from the edges), 360 px wide (on phones full width above the bottom tabs), `surface`, `line` border, `shadow-float`, a lucide icon (success in `active`, error on `danger-soft` with `danger-line` border). Auto-hides after 4 s, pauses while pointed at or focused, swipe left to dismiss. Repeats the verb ("Checked in"). Undo where possible.

### Avatar
Initials on a sunken circle: `surface-sunken`, 1 px `line` border, semibold `ink-secondary`. Sizes 24 px (10 px text), 32 px (12 px), 48 px (16 px).

### Kbd
20 px high, min 20 px wide, 4 px radius, `line` border, `surface`, `font-mono` 12 px `ink-muted`. For hints like `Ctrl K`.

### ProgressBar and DataBar
Thin bars (6 px) on a `surface-sunken` track, full radius; fill `ink`, `viz-1`, `active` or `waiting-strong` depending on meaning.

### Stepper
Only for real sequences. Numbered circles (28 px, 13 px semibold tabular): upcoming has a 1 px `line-control` border, `surface` fill, `ink-secondary` number; current has a 2 px `accent` border and its row sits on `accent-soft` with a semibold label; done is a solid `accent` circle with a white tick; locked is `surface-sunken` with a `line` border and a lock icon, plus a line under the list saying why. Rows hover on `surface-hover`. Connectors in `line-strong`. Vertical for long processes, horizontal for short ones.

### FeedItem and LiveStamp
Feed item: a 64 px time column (`sm ink-muted` tabular), the words, a tag. LiveStamp: a small `active` dot plus "Live, updated 3 s ago" in `sm ink-muted`; "Stale" after two missed refreshes. The dot does not pulse.

### EmptyState
An optional lucide icon (20 px) in a 40 px `surface-sunken` circle, `ink-muted`; one sentence (max ~384 px wide, `ink-muted`) saying what goes here; one action when there is something to do.

### Skeleton
Placeholders the size of what loads, in the page's own layout, on `surface-sunken`. **Static: no pulse or shimmer.** No spinners over whole pages. Screen readers hear "Loading".

### Error and not found
One narrow panel with an icon in a quiet well: a failure on the danger tint, a missing page in grey. Says what happened and what to do, never the raw error or "Something went wrong". A reference code in mono. One primary button ("Load again").

### Sign in and lock screens
One 400 px panel centred on `canvas`: `surface`, `line` border, 12 px radius, `shadow-xs`, the logo at the top, one primary button, no illustrations. The lock layer is an opaque `surface` covering everything (no blur).

### Calendar block (signature component)
Each visual channel means one thing:
* A **3 px strip on the left** is the status colour.
* The **fill stays white**, except live states (checked in, in progress) on their tint and ends (completed, no show) on theirs.
* Top line: the visit kind, or the warning in words. `₹` at the right when money is owed; "VIP" as a small tag. The start time joins the top line only when the column is wide (container query).
* Patient name, then the status in words.
* Cancelled / rescheduled: kept in place, **hatched** (135° 1 px `line` stripes every 7 px on white, see `css/hatch.css`), time struck through.
* Secondary resource slots are on `surface-sunken`, joined to their main block by a thin connector line.
* Grid: solid lines on the hour, dotted on the half hour, a "now" line with its time; hovering a free slot shows "+ 10:30".

---

## 9. Charts

Hand-built SVG (no chart library needed). Rules that apply to all:

* Columns start from zero; horizontal gridlines only, in `line`; axis labels 12 px `ink-muted`, **never rotated**.
* The main series in `viz-1` blue; comparison in `viz-compare` grey; targets as 1 px dashed `viz-target` lines labelled at their end ("Target 75%").
* A period still filling up (this week) is **hatched and labelled "so far"**.
* Label lines directly instead of a legend where possible.
* Every chart has an `aria-label`, a "Show as table" twin whose cells are words ("68%, below target"), and arrow-key access to its values where it has a tooltip.

| Chart | Recipe |
|---|---|
| Bar chart | Columns from zero, current period hatched, optional dashed target line |
| Stacked columns | Parts separated by a 2 px white gap, top rounded, a key, a tooltip listing every part and the total |
| Line chart | One series, optional target line, optional shaded band (e.g. "meaningful change"), gaps where there is no data |
| Focus lines | A line per series, one in focus in colour, the rest grey |
| Pace line (sparkline) | 80 × 20 px: this period's running total over the previous period's (dashed) |
| Bullet graph | Stephen Few's spec: the measure as a bar, the target as a tick, grey bands; reversed for lower-is-better |
| Heatmap | Hours × items on the 7 step ramp, with a key and a tooltip per cell |
| Segment bar / share bars | One bar in parts (a day's statuses, NPS parts), or one bar per row with its share |
| Dot plot | A row per person, a dot at the rate on a shared scale, a dashed target line through all rows, the count behind each rate; a miss in amber with "Below target" |
| Animated number | A figure gliding to a new value in 240 ms, from what is on screen |

---

## 10. Voice and writing

* Sentence case for everything.
* Buttons say exactly what happens: "Check in", "Close session", "Send UPI link". The toast repeats the verb: "Checked in".
* Errors say what happened and what to do: "This slot was just booked. Pick another time." Never "Something went wrong".
* A target or a miss is said in words beside its mark: "Target 75%", "Below target".
* Numbers as digits, grouped the Indian way.
* Staff titles ("Dr.") come from the person's profile, never typed into templates.

---

## 11. Accessibility

* WCAG 2.2 AA: 4.5:1 for text, 3:1 for control borders, chart marks and the focus ring.
* One focus ring everywhere: `outline: 2px solid var(--focus); outline-offset: 2px;` on `:focus-visible`.
* Full keyboard use and a "Skip to page" link first on every page (staff, patient pages and kiosk). Shortcuts on Today and the calendar: `Ctrl K` or `/` search, `b` new booking, `t` today, `n` and `p` next and previous day, `Esc` close a drawer. Single-key shortcuts never fire inside a field.
* Touch targets: 44 px on tablets, 56 px on kiosk and patient pages, 64 px for kiosk answers.
* Never colour alone: every status has a word, every series a label, a miss the words "Below target".
* Run axe on every screen: nothing serious or critical.

---

## 12. Things we do not do

Review every screen against this list. These are what make an interface look generated or cheap.

* No gradients (a data ramp is not one), glass, blur or glowing borders.
* No grid of identical rounded cards with soft shadows as a page layout.
* No floating KPI tiles. Key numbers sit in one panel split into cells, each with context.
* No sparkline on a number with no trend worth reading.
* No emoji in the work interface. No sparkle, wand or robot icons for AI.
* No all caps eyebrow labels above headings.
* No middle dots joining metadata, except the page header's one context line.
* No arrows appended to button text.
* No purple or blue "AI" gradients, no cream plus terracotta palette, no dark mode with a neon accent, no second accent colour.
* No warm greys mixed into the slate neutrals.
* No teal for a status. Teal means "you can act here" or "you are here".
* **No gold text.** The gold is a mark.
* No colour for decoration: colour means status or data.
* No illustrations, blobs or background patterns.
* No entrance animations, count ups, pulsing dots, or hover animation on every element.
* No more than one primary button in view per panel.
* No spinners over whole pages; no shimmering skeletons.
* Light theme only (the system was not designed for dark mode).

---

## 13. Automated checks

`pnpm check:design` (`packages/ui/src/design-check/`) enforces these:

1. Every text/background pair at 4.5:1 and every mark pair at 3:1, read from the tokens file.
2. The heatmap ramp falls steadily in lightness.
3. No colour value (hex, `rgb`, `oklch`, `bg-[#…]`) anywhere except the tokens file.
4. No class names built at run time.
5. No gold used as text colour (`text-brand`).
6. Every colour class names a colour that exists in the theme.
7. Every page has its own loading, empty and error state.
8. No shadcn token names (`bg-primary`, `text-foreground`, `border-input` and the rest) and no `dark:`.
9. No `-strong` status tone used as text.
10. No dead radius or shadow utilities (`rounded-md`, `rounded-r`, `shadow-lg`): Tailwind's own are removed, so they render nothing.
11. A ratchet on what the redesign replaces (`legacy.json`: native selects, native date inputs, pages capped at the 400 px sign in width): each count may only fall, and the commit that removes some lowers its number.

The end to end tests add: axe on every screen (nothing serious or critical), screenshots compared at 360 px and 1440 px, inputs at 16 px on touch, and at most 200 KB of JavaScript per route.

Source of truth in this repo: this README, then `packages/ui/src/styles/` and `packages/ui/src/components/`. Where this guide and the Frontend Specification (`docs/Clinic_Mx_Frontend_Specification.md`) differ, the specification wins.
