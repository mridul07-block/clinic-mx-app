# Design system v2: ink and gold

The complete visual language of the Clinic Mx demo (`apps/demo`), written so it can be rebuilt in any codebase, any framework, or Figma. Every value here is the exact value the demo ships.

**In one line:** a clinical instrument, calm and exact. Ink on warm white, one near-black accent for actions, a gold mark for identity, and colour only for status and data.

## What is in this folder

| File | What it is | Use it when |
|---|---|---|
| `README.md` | This guide: principles, colour, type, layout, every component's recipe, rules | Always; hand it to a designer or another AI as the brief |
| `tokens.json` | Every token in W3C design token format | Importing into Figma (Tokens Studio), Style Dictionary, or a non-CSS stack |
| `css/tokens.css` | Every token as a CSS variable on `:root` | Any web stack. The only file with colour values |
| `css/tailwind-theme.css` | Tailwind v4 theme mapping the tokens to utilities, with Tailwind's default palette removed | A Tailwind v4 project |
| `css/base.css` | Body text, the focus ring, reduced motion | Any web stack |
| `css/motion.css` | Keyframes and animation utilities (drawer, toast, chart draw, row highlight) | Any web stack (the `@utility` blocks need Tailwind v4) |
| `css/hatch.css` | The diagonal hatch for cancelled items | Calendars and anything "struck" |
| `brand/movementology-logo.svg` | Full Movementology logo | Sidebar, sign in, receipts |
| `brand/movementology-mark.svg` | The gold M mark | Kiosk welcome, survey pages, rail |
| `brand/favicon.svg` | Browser tab icon | `<link rel="icon">` |

**About the brand:** the gold `#FCB813` and the logo belong to Movementology (taken from their website). If the software you are building is for someone else, change only the `--brand`, `--brand-deep` and the SVGs. Everything else is neutral and carries over unchanged; the system was built so the brand is a mark, not the whole palette.

### Quick start (plain web)

```html
<link rel="stylesheet" href="css/tokens.css">
<link rel="stylesheet" href="css/base.css">
<!-- fonts: npm i @fontsource-variable/ibm-plex-sans @fontsource/ibm-plex-mono -->
```

```js
import '@fontsource-variable/ibm-plex-sans';   // keep all subsets: the ₹ sign is in Latin Extended
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
```

### Quick start (Tailwind v4)

```css
@import 'tailwindcss';
@import './tokens.css';
@import './tailwind-theme.css';
@import './base.css';
@import './motion.css';
```

Then only token utilities exist: `bg-canvas`, `text-ink-muted`, `border-line-control`, `text-title`, `rounded-panel`, `shadow-float`, `h-row`, `w-drawer`. `bg-red-500` or `font-bold` generate nothing, on purpose. Write class names out in full (never `bg-${tone}`), or Tailwind cannot see them.

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

The palette was built in OKLCH (warm neutrals at hue 80, status colours at equal lightness) and written as hex so every browser and contrast checker sees the same colour. Every text pair reaches 4.5:1 and every mark or control border 3:1 (WCAG 2.2 AA).

### 2.1 Neutrals (most of the screen)

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F7F5F3` | The app frame and sidebar, behind the sheet. Warm off white |
| `surface` | `#FFFFFF` | The sheet, panels, drawers, inputs |
| `surface-subtle` | `#FAF9F7` | Table header band, panel and drawer footers |
| `surface-hover` | `#F4F2EF` | Row and item hover |
| `surface-sunken` | `#EFEDEA` | Wells, tracks, skeletons, avatars, secondary slots |
| `line` | `#E6E3DF` | Hairlines, panel borders, grid lines |
| `line-strong` | `#D3D0CC` | Dividers, secondary button borders |
| `line-control` | `#8C8984` | Where a control is: inputs, selects, checkboxes, outline tags. 3:1 on white |
| `ink` | `#1B1915` | Text. A warm near black, never pure `#000` |
| `ink-secondary` | `#45423D` | Secondary text, sidebar links |
| `ink-muted` | `#66635D` | Labels, meta, axis labels, chart cells (6:1) |
| `ink-faint` | `#8F8C86` | Placeholders and disabled text only. Never carries meaning |

### 2.2 Accent, brand, focus

| Token | Hex | Use |
|---|---|---|
| `accent` | `#1B1915` | Primary buttons, checked boxes, switches, active tab underline, links. The same near black as ink |
| `accent-hover` | `#35322E` | Primary button hover |
| `accent-soft` | `#F0EEEB` | Selected row, quiet button hover, a new row's highlight |
| `on-accent` | `#FFFFFF` | Text on the accent |
| `brand` | `#FCB813` | **Movementology gold.** The logo, the 3 px current-page marker in the sidebar, the kiosk welcome mark, the receipt. **A mark and a fill only, never text** (1.7:1 on white) |
| `brand-deep` | `#BB8503` | A gold icon that must reach 3:1 |
| `on-brand` | `#1B1915` | Text on a gold fill (10:1) |
| `focus` | `#2171CC` | The focus ring. Blue so it never looks like a selection (4.9:1) |

Why ink and not a colour for actions: the accent stays out of the way of the status colours and data colours, so colour on the screen always *means* something. Gold marks where you are; ink says what you can do.

### 2.3 Status (always a tint, strong text, a same-hue border, and a word)

This is the NHS tag pattern. Colour is never the only signal.

| Tone | Text | Tint (`-soft`) | Border (`-line`) | Strong | Used for |
|---|---|---|---|---|---|
| info | `#2460A8` | `#EBF6FF` | `#B7D4F9` | | Confirmed, informational |
| waiting | `#8A5100` | `#FFF3D3` | `#F0CB8D` | `#BB7400` (dots, marks) | Checked in, not marked, overdue, long wait, below target, warnings |
| active | `#1D7339` | `#EBF9ED` | `#B6DDBD` | | In progress, on target, clear |
| done | `#5A5853` | `#F1F0ED` | `#D3D0CC` | | Completed, closed |
| danger | `#AC2724` | `#FFEFED` | `#F6C3BC` | `#B7191C` with white text (6.6:1) | No show, urgent, money missing. The solid strong red only for a real emergency: its banner, badge and row |

`warning` is an alias of `waiting`. Red stays scarce: people ignore alerts that are everywhere.

**Status to tone mapping (appointments):** Booked = outline in `line-control` · Confirmed = info · Checked in = waiting · In progress = active · Completed = done · Cancelled / Rescheduled = neutral, hatched, time struck through · No show = danger.

### 2.4 Data colours (charts only)

| Token | Hex | Use |
|---|---|---|
| `viz-1` | `#1B6AB6` | The main series. Blue, not the ink accent, so a chart never reads as a button |
| `viz-compare` | `#CAC7C2` | Previous period, "not converted", other series behind the one in focus |
| `viz-target` | `#66635D` | Target lines: 1 px dashed, labelled at their end |
| `viz-centre-1/2/3` | `#2F74BB` `#7F5BB6` `#1C8580` | Three categories (blue, violet, teal). Reserved: they mean those categories everywhere and nothing else uses them |
| `viz-promoter / passive / detractor` | `#2F74BB` `#CDCAC5` `#D8662A` | NPS parts. Blue and orange stay apart for colour blind readers |
| `viz-ramp-1` to `7` | `#EAF5FF` `#C7E1FF` `#9FC8F7` `#73ACEB` `#4C8FD8` `#2773C0` `#0E599D` | Heatmaps: one hue, lightness falling in even steps |

Stacked parts are separated by a 2 px white gap. Series hues sit away from status hues.

### 2.5 Scrim

`rgb(27 25 21 / 40%)` dims the page **only** behind a confirm dialog. Drawers have no scrim.

---

## 3. Typography

### 3.1 Fonts

| Role | Font | Why |
|---|---|---|
| All UI | **IBM Plex Sans** (variable) | Sturdy and clear at small sizes, tabular figures, has the ₹ glyph, and not the default Inter look |
| IDs, invoice numbers, keyboard hints | **IBM Plex Mono** 400 and 500 | Characters that must not be confused (0/O, 1/l) |
| Hindi | IBM Plex Sans Devanagari | Same family look |
| Kannada, Tamil | Noto Sans Kannada, Noto Sans Tamil | Reliable script support |

Self host the fonts (Fontsource packages). Do not trim the Latin Extended subset: the ₹ sign lives there. Many popular fonts (Onest, Instrument Sans, Hanken Grotesk) have no ₹; check the font file before swapping.

```css
--font-sans: 'IBM Plex Sans Variable', 'IBM Plex Sans', system-ui, sans-serif;
--font-mono: 'IBM Plex Mono', ui-monospace, monospace;
```

### 3.2 Scale (staff base 14 px, patient pages 16 px)

| Token | Size / line height | Tracking | Weight | Use |
|---|---|---|---|---|
| `xs` | 12 / 16 | | 400 or 500 | Axis labels, captions, grid times, small tags |
| `sm` | 13 / 18 | | 400 | Secondary lines, tags, meta, table headers |
| `base` | 14 / 20 | | 400, 500 for emphasis | Body, table rows, inputs, buttons |
| `md` | 16 / 24 | -0.01em on titles | 600 | Panel and drawer titles; patient page body |
| `lg` | 18 / 26 | | 600 | Error panel titles, kiosk answers |
| `xl` | 22 / 30 | -0.01em | 600 | A measure against its target; large input |
| `title` | 24 / 32 | -0.015em | 600 | Page title, the page's only h1 |
| `display` | 32 / 40 | -0.02em | 600 | The one number that matters in a panel; kiosk questions |
| `2xl` | 28 / 36 | | 600 | Patient page headings only |

Only three weights exist: 400, 500, 600. **No bold (700).**

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
| `control` | 6 px | Buttons, inputs, selects, list options |
| `tag` | 6 px | Tags and badges |
| checkbox | 4 px | Checkboxes and key hints |
| `panel` | 12 px | Panels, floating lists, sign in panel |
| `sheet` | 14 px | The page sheet |
| `drawer` | 16 px | Drawers |
| full | | Avatars, dots, switches |

Table cells and calendar grids are square.

### 4.3 Elevation

| Token | Value | On |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgb(27 25 21 / 5%)` | Panels, the sheet, buttons, inputs: a hairline only |
| `shadow-float` | `0 12px 32px -8px rgb(27 25 21 / 18%), 0 2px 6px rgb(27 25 21 / 6%)` | Menus, popovers, select lists, toasts |
| `shadow-drawer` | `-24px 0 48px -16px rgb(27 25 21 / 18%), -1px 0 0 rgb(27 25 21 / 4%)` | Right drawers |

Panels are defined by a **1 px `line` border plus `shadow-xs`**. Only things that float cast a real shadow. No glass, blur or gradients.

### 4.4 Heights and touch

| Size | Value | Where |
|---|---|---|
| `row` | 36 px | Controls and table rows with a mouse |
| `row-touch` | 44 px | The same on touch screens |
| small button | 28 px | Toolbars and dense rows |
| `target-patient` | 56 px | Kiosk and patient pages |
| answer | 64 px | Kiosk Yes / No |

The switch follows the **pointer, not the width**: `@media (pointer: coarse)` gives 44 px, a mouse keeps 36 px at any screen size.

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

* **lucide** icons, outline style. 16 px in controls, 18 px in navigation, 14 px in small buttons, 20 px in empty states. Used sparingly.
* No emoji in the staff interface. **No sparkle, magic wand or robot icons for AI**: an assistant is named in words.
* No illustrations, blobs or background patterns. Empty states use a lucide icon in a 40 px sunken circle.
* People are shown as initials on a sunken circle (Avatar), not photos.

---

## 7. Layout

```
+------------------+------------------------------------------------------+
| [M] Movementology|  Calendar                         [New booking]      |
| [Centre: HSR   v]|  HSR Layout · Live, updated 2 s ago   < Today >      |
| Search  Ctrl K   |------------------------------------------------------|
|                  |                                                      |
| Today            |                page content (white sheet)            |
| Calendar       ▌ |                                                      |
| Patients         |                                                      |
| Inbox          3 |                                                      |
| Tasks          5 |                                                      |
| Reports          |                                                      |
|                  |                                                      |
| (AR) Asha Rao  v |                                                      |
+------------------+------------------------------------------------------+
```

* **Canvas and inset sheet.** The window background is `canvas`. The sidebar sits directly on it, with no border. The page is a white **sheet**: 1 px `line` border, 14 px corners, `shadow-xs`, 8 px from the window edges. The window scrolls, not the sheet.
* **Sidebar** (240 px from 1280 px wide, a 64 px icon rail below):
  * Top: the logo (20 px high), then a workspace switcher (here the centre).
  * "Search or jump to" with a `Ctrl K` key hint.
  * Navigation links: 32 px rows, `ink-secondary` text, 18 px icons in `ink-muted`; hover `surface-hover`. **The current page sits on a white pill (`surface`, `line` border, `shadow-xs`) with a 3 px gold bar on its left edge.** Counts of things needing action sit at the right in `xs ink-muted` (on the rail, a small ink badge with white text).
  * Foot: the person's initials, name and role, opening a menu upward.
* **Page header** at the top of every sheet: the title (`title`, 24 px semibold), status tags beside it; one context line under it in `sm ink-muted`, its parts separated by a middle dot (the only place middle dots are allowed); an optional back link above in `sm ink-muted`; actions on the right, at most one primary.
* **Command palette** on `Ctrl K` or `/`.
* **Details open in a right drawer** so the list or calendar stays visible. Full pages only for big records.
* **Emergency banner**: full width across the top of the sheet, solid `danger-strong`, white text, an icon in a 28 px circle of white at 15%, one action. Stays until acknowledged.

### Responsive

| Width | Behaviour |
|---|---|
| 1536 px+ | Three-pane screens show their side pane |
| 1472 px sheet+ | Dashboard panels pair side by side (a container query on the sheet) |
| 1280 px+ | Full sidebar |
| 768 to 1279 px | Icon rail (names in tooltips with a mouse, small labels under icons on touch), 44 px targets |
| Below 768 px | Read-only staff views; patient pages fully supported from 360 px |

Use container queries for parts that depend on their own width (a calendar block, a document pane), not the window width. Every page must work at 125% zoom on a 1366 px laptop without sideways scroll; a wide table scrolls inside its panel.

---

## 8. Components (exact recipes)

Build on unstyled primitives (Radix) with the tokens. Do not import a pre-styled kit. `className` passed to a component is for layout only (margin, width, grid position); variants are typed maps inside the component.

### Button

Base: inline flex, centred, 8 px gap, 6 px radius, 1 px border, weight 500, no wrap, colour transition 120 ms. Defaults to `type="button"`.

| Look | Rest | Hover | Disabled |
|---|---|---|---|
| **Primary** | `accent` fill, white text, transparent border, `shadow-xs` | `accent-hover` | `surface-sunken` fill, `line` border, `ink-faint` text, no shadow |
| **Secondary** | `surface` fill, `line-strong` border, `ink` text, `shadow-xs` | border `line-control`, fill `surface-hover` | `surface-subtle`, `line` border, `ink-faint` |
| **Quiet** | transparent, `accent` text | `accent-soft` fill | `ink-faint` |
| **Danger** | `surface` fill, `line-strong` border, `danger` text | border `danger-line`, fill `danger-soft` | as secondary |
| **Danger fill** | `danger-strong`, white text. **Only inside a confirm dialog** | `danger` | as primary |

| Size | Height | Padding x | Text | Icon |
|---|---|---|---|---|
| small | 28 px (44 on touch) | 10 px | 13 px | 14 px |
| default | 36 px (44 on touch) | 14 px | 14 px | 16 px |
| large | 56 px | 24 px | 16 px | 20 px |
| answer | 64 px | 24 px | 18 px | 24 px |

While an action runs the button is disabled with fixed text ("Saving"), **no spinner**. Button labels are verbs that say what happens ("Check in", "Send UPI link"); **no arrows in button text**.

### IconButton
Square, 36 px (44 touch), a lucide icon, required name used for the tooltip and `aria-label`. Close buttons in drawers and toasts: `ink-muted`, hover `surface-hover` and `ink`.

### Inputs (Input, Select trigger, Combobox, TextArea)
Full width, 36 px high (44 touch), 12 px horizontal padding, 6 px radius, **1 px `line-control` border**, `surface` fill, `shadow-xs`, 14 px `ink` text, placeholder `ink-faint`. Hover: border `ink-muted`. Invalid (`aria-invalid`): border `danger`. Disabled: `line` border, `surface-subtle` fill, `ink-faint`, no shadow. A **large** input (48 px, 22 px semibold tabular) for the one figure that is the point of a screen.

### Field
Label above (14 px, 500), helper text below in `sm ink-muted`, error below the helper in `danger`. Optional fields say "(optional)"; required ones are not starred.

### Floating list (Select, Combobox, Menu)
Panel: 12 px radius, `line` border, `surface`, 4 px padding, `shadow-float`. Options: min 32 px (44 touch), 6 px radius, 10 px left padding, 8 px gap; highlighted on `surface-hover`; a tick on the right for the chosen one.

### Checkbox and Switch
* Checkbox: 16 px square, 4 px radius, `line-control` border, `surface` fill, `shadow-xs`; checked: `accent` fill and border with a white tick. The whole label row is the target.
* Switch: 32 × 18 px track, full radius, `line-control` when off, `accent` when on; a 14 px white knob with `shadow-xs` that moves 14 px.
* ChoiceGroup: one of a few answers as large selectable rows.

### Tag and StatusBadge
Inline flex, 6 px radius, 1 px border, weight 500, no wrap. Default 24 px high, 8 px padding, 13 px text; small 20 px, 6 px padding, 12 px. Optional 6 px round dot before the word.

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
Full width, `border-spacing: 0`, 14 px, tabular numbers. Header: sticky, 36 px, `surface-subtle` band, bottom `line` border, 13 px 500 `ink-muted`, no wrap. Rows: 36 px (44 touch), bottom `line` border (none on the last row inside a panel), hover `surface-hover`, selected `accent-soft`. First cell 20 px left padding, last 20 px right, others 12 px. Numbers right aligned. **No zebra stripes.** Sortable headers carry `aria-sort`. A danger row (`danger-soft`) only for an emergency. Inline data bars (`viz-1`) against the column's highest.

### DescriptionList
Label and value pairs with a fixed label width (labels `ink-muted`), so every drawer's lists line up.

### Drawer
Right side, **floating 8 px from the top, right and bottom edges**, 480 px wide, 16 px radius, 1 px `line` border, `surface`, `shadow-drawer`, **no scrim**. Header: bottom `line` border, 12 px vertical, 20 px left padding; optional 32 px avatar; title 16 px semibold; subtitle `sm ink-muted`; close icon button. Body: scrolls, 20 × 16 px padding. Footer: sticky, top `line` border, `surface-subtle`, 20 × 12 px, buttons with 8 px gap. Slides in 240 ms.

### ConfirmDialog
Only for confirmations and destructive actions, over the scrim. Focus starts on "Go back"; the confirm button is a verb, uses the danger fill when destructive, and shows pending.

### Tabs
Underline tabs: 40 px high (44 touch), weight 500, `ink-muted`, 2 px transparent bottom border. Hover `ink`. Active: `accent` 2 px underline, `ink` text.
Segmented control: a sunken track; the chosen segment is a white pill with a `line` border and `shadow-xs`.
Count row as tabs: a row of counts (To arrive 12, Here now 4) that are also the tabs.

### Toast
Bottom left (16 px from the edges), 360 px wide, `surface`, `line` border, `shadow-float`, a lucide icon (success in `active`, error on `danger-soft` with `danger-line` border). Auto-hides after 4 s, pauses while pointed at or focused, swipe left to dismiss. Repeats the verb ("Checked in"). Undo where possible.

### Avatar
Initials on a sunken circle: `surface-sunken`, 1 px `line` border, semibold `ink-secondary`. Sizes 24 px (10 px text), 32 px (12 px), 48 px (16 px).

### Kbd
20 px high, min 20 px wide, 4 px radius, `line` border, `surface`, Plex Mono 12 px `ink-muted`. For hints like `Ctrl K`.

### ProgressBar and DataBar
Thin bars (6 px) on a `surface-sunken` track, full radius; fill `ink`, `viz-1`, `active` or `waiting-strong` depending on meaning.

### Stepper
Only for real sequences. Numbered circles (28 px, 13 px semibold tabular): upcoming has a 1 px `line-control` border, `surface` fill, `ink-secondary` number; current has a 2 px `ink` border and its row sits on `accent-soft` with a semibold label; done is a solid `ink` circle with a white tick; locked is `surface-sunken` with a `line` border and a lock icon, plus a line under the list saying why. Rows hover on `surface-hover`. Connectors in `line-strong`. Vertical for long processes, horizontal for short ones.

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
* One focus ring everywhere: `outline: 2px solid #2171CC; outline-offset: 2px;` on `:focus-visible`.
* Full keyboard use and a "Skip to page" link first on every page. Shortcuts: `Ctrl K` or `/` search, `n` new, `t` today, `Esc` close a drawer.
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
* No Inter, no cream plus terracotta palette, no dark mode with a neon accent.
* **No gold text.** The gold is a mark.
* No colour for decoration: colour means status or data.
* No illustrations, blobs or background patterns.
* No entrance animations, count ups, pulsing dots, or hover animation on every element.
* No more than one primary button in view per panel.
* No spinners over whole pages; no shimmering skeletons.
* Light theme only (the system was not designed for dark mode).

---

## 13. Checks worth automating in the new project

The demo enforces these with a script; copy the idea:

1. Every text/background pair at 4.5:1 and every mark pair at 3:1, read from the tokens file.
2. The heatmap ramp falls steadily in lightness.
3. No colour value (hex, `rgb`, `oklch`, `bg-[#…]`) anywhere except the tokens file.
4. No class names built at run time.
5. No gold used as text colour (`text-brand`).
6. Every colour class names a colour that exists in the theme.
7. Every page has its own loading, empty and error state.

Source of truth in this repo: `apps/demo/design/`, `apps/demo/components/ds/`, `apps/demo/components/charts/`, and `docs/04_FRONTEND_SPEC.md` (version 2.0). The live style guide is at `/demo/design` in the running demo (`pnpm demo`, port 3100).
