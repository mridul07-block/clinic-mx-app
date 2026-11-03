# Navigation on phones

UI-01: "Phone bottom tab bar per role". Sources:
- Frontend Specification section 4, "Bottom tabs by role (phones)".
- Design system v2: a 3 px gold bar marks the current section; lucide icons at 1.75 stroke.

The user's review of 3 November 2026 replaced the specification's first tabs: each role sees its daily screens, in the same words on a phone and a computer.

## The tabs

`phoneTabsFor(staff)` in `packages/schemas/src/phone-tabs.ts` gives each role its tabs, then **More**.

| Role | Tabs |
| --- | --- |
| Front Desk | Today, Calendar, Patients, To do, More |
| Physiotherapist | My day, Calendar, Patients, To do, More |
| Centre Manager | Home (the dashboard's Alerts), Calendar, Patients, To do, More |
| Finance | Money (Collections; all of `/app/finance` counts), Patients, Prices, To do, More |
| Super Admin | Home (Overview), Calendar, Patients, To do, Setup |

- **Who sees a tab:** a tab shows only when the person may open its screen, the same check the page makes (`accessScope`, own records included).
- **More:** `/app` lists everything else under headings, as **Setup** for the Super Admin; on a phone, first any main links with no tab (`mainLinksWithoutTab`). Nothing is reachable only from the bar.
- **To do:** the `/app/tasks` inbox, with its open count as a badge. Open red flag alerts are named at its top, and **Alerts** stays on More.
- **The current tab:** the longest matching path wins (`currentPhoneTab`), so `/app/patients/<id>` is Patients; More is current on `/app` only.

## Where the bar shows

- **Phones only:** below 768 px (`md:hidden`). From 768 px the rail or sidebar takes over.
- **Not on screens with their own bottom actions:** a consultation (`/app/consultations/<id>`, Back and Next) and a session (`/app/sessions/<id>`, Close session). Pages under them, such as Explain to patient, show the bar (`screensWithoutTabs`).
- **Never covers content:** the bar keeps clear of the phone's home indicator (`safe-area-inset-bottom`), and a spacer of the bar's full height, inset included, ends every page under it.
- **Patients:** the patient pages (`/p/...`) and the kiosk have no bar.

## The bar

`apps/web/components/phone-tab-bar.tsx`, rendered by the signed-in staff layout.
- `nav` "Main", each tab a link at least 56 px tall, an 18 px icon over its word.
- Icons in ink-muted; the current tab: ink and semibold, `aria-current="page"`, the 3 px gold bar on top.

## Tests

- `packages/schemas/src/phone-tabs.test.ts`: each role's tabs and words, tabs a person may not open, the current tab, the screens without the bar.
- `apps/web/e2e/navigation.spec.ts`: at 360 px each role sees its tabs and the current one marked, More goes Home, the bar stands aside in a consultation; on desktop there is no bar.

# Tablets and desktops

UI-02: "Tablet and desktop navigation". Sources:
- Frontend Specification section 4, Breakpoints and Page frame.
- Design system v2 section 7 (Layout): the canvas and inset sheet, the sidebar, Search or jump to, the command palette.

## One list of screens

`navigationFor(staff)` in `packages/schemas/src/navigation.ts` lists every screen a person may open, each shown only when the page's own check would let them in. Search (`Ctrl K`) finds all of them.

- **`mainNavigationFor(staff)`:** the rail's and sidebar's links, from `mainLinksByRole`: the tabs above, plus Today and Reports for the Centre Manager, Reports for the Super Admin, and My day for anyone with the Treats patients tick. A link can rename a screen (Home) and count other paths as its own (`also`).
- **`moreNavigationFor(staff)`:** the rest, which `/app` lists by section: **Day to day**, **Reports**, **Clinic**, **People**, **Clinical content**, **Rules**, **Records and access**.
- **Nothing is taken away:** permissions are unchanged, and a test checks every screen is a main link or on More.

## The frame

`apps/web/components/nav-shell.tsx` and `side-nav.tsx`, rendered by the signed-in staff layout.

- **Below 768 px:** no rail; the bottom tabs (above).
- **768 to 1279 px:** a 64 px rail of 18 px icons. With a mouse, names show as tooltips; on touch, small words under the icons. Every target, Search included, at least 44 px. The centre switcher is the centre's code (HSR) in a 44 px button, opening the centres beside it, the one on screen marked current; after a choice, focus returns to the button (UI-03).
- **From 1280 px:** the 240 px sidebar on the canvas: the logo, the centre switcher, **Search** (`Ctrl K`), the main links, the person at the foot.
- **The page:** from 768 px it sits on a white sheet (1 px line, 14 px corners, `shadow-xs`) 8 px from the window's edges; on phones it fills the screen as before.
- **Skip to page:** the first link on every page, shown when focused, jumps past the rail or sidebar.
- **The current screen:** a white pill with a 3 px gold bar on its left edge, `aria-current="page"`; the longest matching path wins (`currentNavItem`), so a screen that is not a main link counts as More or Setup.
- **Counts:** open tasks beside **To do** (a badge on the rail and the phone tab).

## Search or jump to

`Ctrl K`, `Cmd K` or `/` (when not typing, from 768 px, and not over another dialog), or the button. It lists the screens whose words contain every word typed; for those who may find patients, **Find patients: …** opens Patients with that search. Arrow keys move (the highlighted result kept in view), Enter opens, Escape closes; a status line says when nothing matches.

## The centre switcher

For people who open Today or the Calendar and work at more than one centre (the Super Admin: all): a choice in the sidebar from 1280 px, and on the rail from 768 px the centre's code, opening the centres (UI-03). The chosen centre is the one Today and the Calendar open on when their address names none. On either screen the switcher shows the centre on screen, and choosing one opens it there at once, keeping the date and the rest of the address. It is kept in a cookie on the device (`cmx_centre`, a year), honoured only for a centre the person works at, and deleted when they sign out, so the next person on a shared device starts afresh.

## The person's menu

Their initials (and from 1280 px their name and role) at the foot. It opens beside the sidebar: **Account** and **Sign out**, which saves drafts first, as on More. It closes on Escape, a click elsewhere, or moving to another screen.

## Not built

- Three panel layouts and the 480 px right drawer for every list: screens keep their own layouts.
- Counts beyond open tasks; the count refreshes when a page is loaded, not while moving between screens.

## Tests

- `packages/schemas/src/navigation.test.ts`: each role's screens, what is left out, sections, the current screen, matching typed words.
- `apps/web/e2e/navigation.spec.ts`: the sidebar at 1440 px per role, the current screen, Search or jump to, the centre switcher on Today, the menu closing and signing out forgetting the centre, a centre left by someone else never opening; the rail at 1024 px; no rail on phones.
- Specs that click a link by a name the sidebar also uses look inside `main`.
