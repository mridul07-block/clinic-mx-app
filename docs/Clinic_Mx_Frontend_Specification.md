# Clinic Mx: Frontend Specification

20 October 2026 · Velyx Labs · design system v3 (teal and gold, Inter, Base UI) adopted 1 November 2026 (UIX-01)

## 1. Design direction

Clinic Mx is a calm clinical instrument in deep teal and Movementology gold: phone first, English only, with a warm brand forward voice for patients and a quiet, status first voice for staff.

### Principles

1. **Phone first for every role.** Every workflow works fully from 360 px; larger screens add room, never features.
2. **The most important thing first.** Red flags and precautions before history; who is waiting before menus.
3. **Colour means something, or nothing.** Neutrals carry the screen; colour only for status and data, always with a word.
4. **One primary action per screen**, placed within thumb reach on phones.
5. **Clarity over decoration.** No gradients, no shadows on resting surfaces, no motion for its own sake.
6. **AI is named in words.** No sparkle, wand or robot icons; suggestions are labelled "Assistant suggestion".
7. **Alerts in tiers.** Only a clinical emergency interrupts; everything else is a tag or a count.
8. **Never lose work.** Autosave everywhere; drafts survive a lost connection.

### Two voices, one system

| | Patient voice | Staff voice |
| --- | --- | --- |
| Where | Health form, consent, "My plan", questionnaires, feedback | Every staff screen |
| Brand | Logo at top; gold primary buttons with ink text | Small logo; gold only as the location marker; teal for actions |
| Primary button | Gold #FCB714, ink text | Teal #0E6B6B, white text |
| Base text | 16 px | 16 px, secondary text 14 px, nothing smaller except chart axes (decision, 3 November 2026) |
| Touch targets | 56 px; 64 px for Yes and No answers | 40 px with a mouse, 44 px on touch |
| Tone | Warm, encouraging, plain words | Short, factual, status first |

Design system v3 (`docs/design/README.md`, code in `packages/ui`) carries the full recipes; where it and this spec differ, this spec wins. v3 replaced v2 "ink and gold" on 1 November 2026 after the user reviewed staging: a deep teal action colour, cool slate neutrals and Inter, so the next step is easy to spot and more fits on a phone.

## 2. Brand and colour tokens

The brand gold is #FCB714, taken from the official Movementology logo file; it is a fill and a mark, never text (1.7:1 on white).

### Brand

| Token | Value | Use |
| --- | --- | --- |
| `--brand` | #FCB714 | Patient primary buttons, logo mark, location bar, patient progress bars |
| `--brand-deep` | #BB8503 | Gold icons that must reach 3:1 |
| `--on-brand` | #0F1A24 | Text on gold (about 10:1) |
| Logo black | #030404 | Inside the logo file only |

The logo, mark and favicon come from the client's SVG files. The favicon gets a light rounded backing so it stays visible on dark browser tabs.

### Surfaces, lines and ink

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | #F5F7F9 | App frame, sidebar |
| `--surface` | #FFFFFF | Sheets, panels, drawers |
| `--surface-subtle` | #F8FAFB | Table header band, panel footers |
| `--surface-hover` | #EEF2F5 | Row hover |
| `--surface-sunken` | #E9EEF2 | Wells, tracks, skeletons |
| `--line` | #E2E8EE | Hairlines, grid lines |
| `--line-strong` | #CBD5DF | Dividers |
| `--line-control` | #7B8A9C | Input borders (3.5:1) |
| `--ink` | #0F1A24 | Text |
| `--ink-secondary` | #334252 | Secondary text |
| `--ink-muted` | #4A5868 | Labels, axes |
| `--ink-faint` | #66737F | Placeholders and disabled only |
| `--focus` | #2563EB | Focus ring, 2 px, 2 px offset |

### Action colour

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | #0E6B6B | Staff primary buttons, links, checked controls, the current page's label (white on it 6.3:1) |
| `--accent-hover` | #0A5656 | Primary button hover |
| `--accent-soft` | #E5F2F1 | Selected row, quiet button hover |
| `--on-accent` | #FFFFFF | Text on teal |

Teal only ever means "you can act here" or "you are here"; it is never a status.

### Status (text, tint, line)

| Status | Text | Tint | Meaning in Clinic Mx |
| --- | --- | --- | --- |
| Info | #2460A8 | #EBF6FF | Checked in, here now, information |
| Waiting / warning | #8A5100 | #FFF3D3 | Running late, review needed, below target, form open |
| Active / success | #1D7339 | #EBF9ED | Met, done, confirmed improvement |
| Done | #4A5868 | #EEF2F5 | Completed, cancelled, closed |
| Danger | #AC2724 (strong #B7191C) | #FFEFED | Clinical emergency, no show |

Change from the demo: **"Checked in" moves from amber to blue**, so amber only ever means "needs attention". Solid red is reserved for the clinical emergency banner.

### Data colours

Main series #1B6AB6; comparison #C5CED8; target lines #4A5868 dashed; centres HSR Layout #2F74BB, Koramangala #7F5BB6, Whitefield #1C8580 (charts only); promoter #2F74BB, passive #C8D1DA, detractor #D8662A; a 7 step blue ramp for heatmaps.

Light theme only. Every colour pair is contrast checked automatically in CI.

## 3. Typography

Inter is the only text family; IDs use Inter with tabular figures and its `ss02` set (slashed zero, distinct l and I) through the `font-mono` utility; tabular figures are on wherever numbers are compared.

| Token | Size / line height | Use |
| --- | --- | --- |
| `text-xs` | 12 / 16 | Captions, chart labels |
| `text-sm` | 13 / 18 | Meta lines, tags, table cells on dense screens |
| `text-base` | 14 / 20 | Staff body text |
| `text-md` | 16 / 24 | Patient body text; every staff input, select and textarea on touch screens (prevents iOS zoom) |
| `text-lg` | 18 / 26 | Patient section titles |
| `text-xl` | 22 / 30 | Patient page titles |
| `text-title` | 24 / 32, semibold, -0.015em | Staff page titles |
| `text-display` | 32 / 40, semibold, -0.02em | The one headline number on a KPI card |

- **Weights:** 400 text, 500 labels and buttons, 600 titles and headline numbers. No bold (700).
- **Numbers:** `font-variant-numeric: tabular-nums` in tables, KPI cards, prices, times, chart axes; proportional figures in prose.
- **Mono:** `font-mono` (Inter, `tnum` and `ss02`) only for patient IDs, appointment IDs and bill numbers (HSR-00137 style codes).
- **Case:** sentence case everywhere; no all caps except tiny overlines.
- **Money and numbers:** Indian grouping (₹18,40,000) or lakh shorthand on dashboards (₹18.4 L).
- **Loading:** self hosted variable font files (Latin and Latin Extended for ₹), `font-display: swap`, preloaded on first paint.

## 4. Layout, navigation and breakpoints

Screens are designed at 360 px first and widen into rails and drawers; staff screens are fully usable on phones (this replaces the demo's read only rule below 768 px).

### Breakpoints

| Width | Layout | Navigation | Details open as |
| --- | --- | --- | --- |
| 360 to 767 px (phone) | One column | Bottom tab bar, 4 or 5 items per role | Full screen sheet sliding up; primary action pinned at the bottom |
| 768 to 1279 px (tablet) | Two panels (list and detail) | 64 px icon rail | Right panel |
| 1280 px and up (desktop) | Up to three panels | 240 px sidebar with centre switcher at the top | 480 px right drawer, calendar stays visible |

Touch size follows the pointer, not the width: 40 px rows with a mouse, 44 px on touch screens at any width.

### Bottom tabs by role (phones)

| Role | Tabs |
| --- | --- |
| Front Desk | Today, Calendar, Patients, To do, More |
| Physiotherapist | My day, Calendar, Patients, To do, More |
| Centre Manager | Home, Calendar, Patients, To do, More |
| Finance | Money, Patients, Prices, To do, More |
| Super Admin | Home, Calendar, Patients, To do, Setup |

The rail and sidebar show the same links, plus Today and Reports for the Centre Manager and Reports for the Super Admin. More or Setup lists everything else under headings (the user's review, 3 November 2026).

### Page frame

- Top bar: centre switcher (only for users with more than one centre), search, notifications, profile.
- A 3 px gold bar marks the current section in the sidebar, rail or bottom tabs; its label and icon are teal.
- Content sits on a white sheet over the cool canvas; panels have a hairline border, not a shadow. On phones the sheet runs edge to edge.
- Spacing on a 4 px scale (4, 8, 12, 16, 20, 24, 32, 40, 48, 64); sections 24 to 32 px apart.
- Radii: controls 8 px, tags 6 px, panels 12 px, sheets and drawers 16 px.
- Page widths: form 640 px, content 1040 px, or full width (Today, calendar, dashboards); never a phone-width column on a desktop.
- On phones the top bar is a sticky 56 px bar: page title, search, notifications, profile (with the centre switch).
- Safe area insets respected on phones with notches and gesture bars.

## 5. Component library

All components live in `packages/ui`, built on Base UI primitives (following shadcn/ui's Base UI recipes, code owned here) with Clinic Mx tokens; dates and times use React Aria Components. The clinic specific ones below must exist before screens are built.

### Base components

Button (primary teal, primary gold for patients, secondary, quiet, danger), Input, Textarea, Select, Combobox (search), Checkbox, Radio group, Switch, Date picker, Time slot grid, Tag (status with word), Count chip (also a filter), Tabs, Stepper (with locked steps and a reason), Drawer and bottom sheet, Dialog (confirm only for irreversible actions), Toast, Tooltip (tap on touch), Skeleton, Empty state, Avatar, Table (sticky header, tabular numbers, stacked cards on phones), Pagination, Search bar, Banner.

### Clinic specific components

| Component | What it does | Used in |
| --- | --- | --- |
| Calendar block | Appointment with time, patient, physio, type, status strip; hatched when cancelled or rescheduled; ₹ when money owed; "VIP" tag; pulses three times when the WhatsApp assistant just booked it | Calendar |
| Today board row | Time, patient, physio, status tag, waiting time, one tap action | Front desk Today |
| Check in drawer | Identity check, QR for the health form, "Open on tablet", add report photos | Front desk |
| Body chart | Front and back outline; tap regions to mark pain; regions map to knowledge base subregions | Health form, consultation |
| Yes / No answer | 64 px paired buttons for warning sign questions | Health form |
| Consent card | One statement per card with tick, version label and expand for full text; signature pad at the end | Consent pages |
| Signature pad | Finger or stylus signature with clear and redo; stored as an image with timestamp | Consent pages |
| Side by side measure | Involved and uninvolved inputs, unit and position, live deficit or LSI with status word | Consultation, sessions, review |
| Special test row | Test name, Positive / Negative / Not tested, one line interpretation | Consultation |
| Quality rating | 0 to 3 segmented control with the definition of each grade | Consultation, sessions |
| Pain slider | 0 to 10 with large thumb and number readout | Health form, sessions |
| AI suggestion card | Rank, condition, one line reason, discriminating question, tests, source link to the knowledge base row, Keep and Dismiss; labelled "Assistant suggestion" | Preparation sheet |
| Source label | Patient reported, Clinician confirmed, Assistant suggestion, Confirmed diagnosis | Consultation |
| Alert card | Tier, rule, time raised, actions (I'm reviewing, Refer, Close with decision); lifecycle shown | Physio and manager screens |
| Emergency banner | Full width solid red, one action, stays until acknowledged by a clinician | All clinical and front desk screens |
| Readiness panel | Each criterion with Met, Not met or Not assessed; clearance disabled while anything is Not assessed; override with reason | Review and discharge |
| Phase stepper | Programme phases; locked phases show the unmet criteria in words | Progress tab |
| Package meter | Sessions used of total, expiry date, reschedules left | Front desk, physio (no prices), patient |
| Exercise row | Name, dose, video, done tick | "My plan", home programme editor |
| Week strip | Seven squares filled for days exercises were done | Progress, "My plan" |
| KPI card | Label, headline number, change vs last period, small trend line, target status word | Dashboards |
| Bullet graph | Bar to actual, tick at target, status word | Dashboards, LSI |

## 6. Staff screens by role

Each role lands on one screen that answers "what needs me now"; every other screen is at most two taps away.

### Front Desk

| Screen | Contents | Primary action |
| --- | --- | --- |
| Today (home) | Count chips that filter: To arrive, Here now, With physio, Done; rows by time with status tags and waiting time; emergency banner when raised; "Not confirmed" filter each morning | Check in |
| Calendar | Desktop: day view, a column per physio, free slots clickable, fee in the column header; phone: agenda per physio | New booking |
| New booking sheet | Search by mobile or name; new patient needs name and mobile only; slot picker; channel recorded automatically | Book |
| Check in drawer | Identity, form status, Show QR, Open on tablet, Add reports | Check in |
| Plan and payment sheet | Recommended plan (read only), payment options, patient choice, consent QR, bill, payment method, book plan sessions | Record payment |
| Patients | Search; patient card with episodes, upcoming appointments, package meter, counters | Open |

### Physiotherapist

| Screen | Contents | Primary action |
| --- | --- | --- |
| My patients today (home) | Patients in time order with status, form status, alerts, "Preparation sheet ready" (Consultant tick) | Start consultation / Start session |
| Preparation sheet (Consultant tick) | Cards: what the patient told us, safety, likely diagnoses (top 3 plus 2 under "Also consider"), must rule out, suggested examination, load and biomechanics | Keep / Dismiss |
| Consultation | Vertical stepper: Subjective, Screening, Objective, Assessment, Plan, Sign; one section at a time on phones with Next pinned; Recheck with findings; Explain to patient | Sign and finish |
| Session note | Since last visit, new symptoms check, pain sliders, treatment prefilled from last time, modality parameters, response, home programme, next session; "Same as last time" | Close session |
| Patient record | Summary card, episodes, signed notes, progress tab, documents, alerts | Add addendum |
| Progress tab | Pain line, questionnaire lines with meaningful change band, LSI bullet graphs, week strip, phase stepper | Record reassessment |
| Review and discharge (Consultant tick) | Baseline vs final table, readiness panel, three statuses, override, discharge reason | Sign clearance / Discharge |
| Tasks | Alerts and tasks assigned to me, sorted by urgency | Close with decision |

### Centre Manager

| Screen | Contents |
| --- | --- |
| Alerts (home) | Open red flag alerts, overdue reassessments, stalled progress, unsigned notes, service recovery tasks |
| Centres | Today's utilisation, no shows, waiting times, payment pending flags per centre |
| Outcomes | Meaningful change, completion, reinjury, conversion funnel, outcomes by diagnosis |
| Team | Rosters and leave, documentation on time, workload by physio |
| Feedback | Recommendation score, themes, open complaints |

### Finance

| Screen | Contents |
| --- | --- |
| Bills (home) | Today's collections by method and centre; bill list with status |
| Unpaid | YTP balances sorted by amount; over 3 unpaid sessions flagged |
| Packages | Active, expiring in 14 days, expired with sessions left |
| Revenue | By month vs last year, by centre, by service; exports |
| Refunds and credits | Requests, approvals, history |
| Price master | Prices, package types, preset discounts |

### Super Admin

Overview across all centres; staff (role, ticks, centres, end dates, deactivate); settings; knowledge base versions with the monthly improvement report and approve; WhatsApp templates; support access grants; audit log; data requests.

## 7. Patient pages and WhatsApp Flows

Patient pages open from a QR or a WhatsApp link with no login, show one topic per screen in 16 px text, and use gold for the single primary action.

### Patient page rules

- Logo at the top; a short horizontal stepper on multi step forms.
- One topic per screen; the primary action pinned at the bottom (56 px, gold).
- Yes / No answers as 64 px paired buttons.
- Progress saved after every screen; leaving and returning resumes in place.
- Nothing alarming is ever shown to patients: no red flag language, no AI wording.
- Kiosk mode on the clinic tablet: locked to the patient page, resets to the welcome screen after submit or 2 minutes idle.

### Pages

| Page | Screens | Notes |
| --- | --- | --- |
| Health form | Welcome and Part A consent; About you; Your problem (body chart, pain sliders); Warning signs (conditional back and neck questions); Health check ("None of these" option; pregnancy only for female); Activity and goal; History (report photo); Check and submit | About 5 minutes; mandatory screens marked; under 18 opens the guardian section |
| Part B consent | General terms; package terms only with a package; one card per planned modality; signature | Diagnosis and plan filled in from the signed record |
| My plan | Greeting and week of plan; next session with Reschedule and Map; today's exercises with videos and ticks; package meter in gold; simple pain line with a sentence ("You started at 6, now 2"); maintenance mode after discharge | The patient's single place to look |
| Questionnaires | One question per screen; progress shown; auto score | Baseline, reassessment, discharge |
| Clearance acknowledgement | Plan, warning signs to stop, residual risk; tick and sign | Return to training or sport |
| Feedback | Four questions and a 0 to 10 score; optional comment | Post consultation and discharge |
| Thank you | Clear confirmation and what happens next | After every submit |

### WhatsApp Flows

WhatsApp draws Flows in its own native style; we control screens, fields, wording and live data.

| Flow | Screens |
| --- | --- |
| Booking | 1. Clinic and date (only dates with free slots); 2. Time (live, taken times disabled) and physio with fee; 3. Name of the person coming and a summary; confirm |
| Reschedule | Opens from the reminder's Reschedule button; clinic and physio prefilled; date and time only; shows reschedules left; blocked for Zero Gravity Treadmill sessions |

Wording in Flows and messages is plain, calm English with no emoji, matching the brand. Every message carries one clear action.

## 8. Charts and data display

Each number gets the chart that answers its question: bars to compare, lines for change over time, bullet graphs against targets, donuts only for one whole in 2 to 4 parts.

| Number | Chart | Screen |
| --- | --- | --- |
| Consultations, plan acceptance, no shows, active patients, revenue | KPI card: headline number, change, small trend line, target word | Manager, Super Admin, Finance |
| Booking channel (WhatsApp, phone, walk in) | Donut, 3 parts, total in the centre | Manager, Super Admin |
| Payment method (UPI, card, cash) | Donut, 3 parts | Finance |
| Recommendation score (promoter, passive, detractor) | Donut with the score in the centre | Manager |
| Completion, meaningful change by 6 weeks, reinjury, conversion | Bullet graph against the SOP target | Manager, Super Admin |
| Consultation to completion drop off | Funnel | Manager, Super Admin |
| Appointments or revenue per centre | Grouped bars in centre colours | Manager, Finance |
| Revenue by month vs last year | Bars with last year in grey | Finance, Super Admin |
| Daily collections | Columns with a dashed target | Finance |
| Busy hours (day × hour) | Heatmap on the blue ramp | Manager |
| Physio workload, notes on time | Sorted horizontal bars | Manager |
| Top diagnoses | Horizontal bars, top 10 | Manager, Super Admin |
| Outcomes by diagnosis (baseline vs discharge) | Dumbbell chart | Manager, Super Admin |
| Feedback themes | Horizontal bars | Manager |
| AI right diagnosis in top 3 | Line by month with a target line | Super Admin |
| Pain per visit | Line, 0 to 10 | Physio, patient |
| Questionnaire scores | Line with a shaded meaningful change band | Physio |
| Strength and hop LSI | Bullet graph at 90% | Physio, review |
| Range of movement, injured vs healthy | Paired bars | Physio |
| Exercise adherence | 7 day week strip | Physio, patient |
| Package sessions used | Progress bar (gold on patient pages, neutral for staff) | Patient, front desk |
| Today's counts (front desk) | Count chips, no chart | Front desk |

### Chart rules

- One data colour (blue); grey for comparison; centre colours only when comparing centres; brand gold only on patient progress bars.
- Label lines and bars directly; avoid legends where possible.
- Every chart has a table view for exact numbers and screen readers.
- Tap shows a value on touch screens; hover on desktop.
- Never: 3D, gauges, rainbow palettes, two different scales on one chart, pies over 4 parts, pies for change over time.
- Motion: bars rise and lines draw once (under half a second); values glide on update; off under reduced motion.
- Library: Recharts for line, bar and donut; custom SVG components for bullet graph, dumbbell, heatmap and week strip.

## 9. States, alerts, motion and microcopy

Every status is a word on a tinted tag, every alert sits in one of three tiers, and every message tells the user what happened and what to do next.

### Appointment statuses

| Status | Tag | Calendar block |
| --- | --- | --- |
| Booked | Outline | Plain |
| Confirmed | Neutral | Plain with a check |
| Checked in | Blue, "Here n min" | Blue strip |
| Running late | Amber | Amber strip |
| In progress | Green | Green strip |
| Completed | Grey | Muted |
| Cancelled, rescheduled | Grey | Hatched, struck through |
| No show | Red text tag | Red strip |

### Alert tiers

| Tier | When | Display |
| --- | --- | --- |
| Emergency | Possible cauda equina, infected joint, DVT and similar | Full width solid red banner; stays until a clinician acknowledges it; front desk sees "Clinician review needed before patient leaves" |
| Review | Night pain, missing safety answers, overdue reassessment, still sore after 24 hours | Amber tag beside the patient and a task |
| Information | Package expiring, feedback received | Quiet line or dashboard count |

Acknowledgements are logged so alerts dismissed too often can be tuned.

### Screen states

- **Loading:** skeletons shaped like the content, never spinners on full screens.
- **Empty:** one sentence and one action ("No one has arrived yet").
- **Offline:** a slim bar "Offline, changes will sync"; drafts saved locally.
- **Live:** "Updated 3 s ago" on live boards; new rows fade from a soft highlight.
- **Errors:** inline beside the field, written as what happened plus what to do.

### Motion

Quick 120 ms for hover and press; 240 ms for drawers, sheets, toasts and chart changes; standard easing; a newly booked WhatsApp appointment pulses its outline three times. Nothing moves under reduced motion.

### Microcopy

| Situation | Copy |
| --- | --- |
| Slot taken | "This slot was just booked. Pick another time." |
| Gate blocked | "Consent and payment are needed before the first session." |
| Clearance blocked | "2 tests not assessed. Record them or add an override reason." |
| AI unavailable | "Suggestions unavailable right now. Continue the consultation as usual." |
| Autosave | "Saved" (quiet, beside the section title) |
| Patient submit | "Thank you, Mridul. Please take a seat. Dr. Sneha will call you in shortly." |

Words: sentence case, verbs on buttons ("Check in", "Sign and finish"), no jargon on patient pages, no exclamation marks in staff screens.

## 10. Accessibility, performance and quality checks

WCAG 2.2 AA is the floor, mid range Android phones on 4G are the test device, and real Movementology staff test the screens before they are built.

### Accessibility

- Every text and background pair meets AA contrast; controls meet 3:1; checked automatically in CI.
- Status is never shown by colour alone; every tag has a word.
- Visible blue focus ring on every control; full keyboard use on desktop.
- Screen reader labels on icons, charts (with table views) and the body chart regions.
- Touch targets: 44 px staff touch, 56 px patient, 64 px kiosk answers.
- Respects reduced motion and text zoom to 200% without loss of content.

### Performance budgets

| Measure | Budget |
| --- | --- |
| Largest contentful paint, 4G mid range Android | Under 2.5 s |
| Interaction to next paint | Under 200 ms |
| JavaScript per route (compressed) | Under 200 KB |
| Patient health form first screen | Under 1.5 s |
| Images | Resized on upload; modern formats; lazy loaded |

Techniques: server rendering for first load, route level code splitting, PWA caching of the app shell, prefetch of the next likely screen, optimistic updates with rollback.

### Quality checks

- Design token check: no raw colours, no gold text, no Tailwind default palette, no dynamic class names, no shadcn token names, no `-strong` status tone as text.
- axe on every screen (nothing serious or critical) and screenshots compared at 360 px and 1440 px.
- Playwright tests on 360 px and desktop viewports for every critical flow.
- Visual review on a real Android phone and an iPhone before each release.
- Before build: clickable prototypes tested with a receptionist, a consultant and a treating physio (about 10 minutes each).
- After launch: monthly review of drop off in the booking Flow and health form.

## 11. Print and PDF styles

All patient documents are A4, on Movementology letterhead, and fully readable when printed in black and white.

| Element | Spec |
| --- | --- |
| Page | A4, 18 mm margins; page numbers "Page n of N" in the footer |
| Letterhead | Logo top left; clinic name, centre address and phone top right; a thin gold rule under the header (decorative only, nothing depends on it) |
| Type | Inter 10.5 pt body, 14 pt titles (static Regular, Medium and SemiBold files embedded); OP number and bill number in Inter with tabular figures and `ss02`, or IBM Plex Mono if the PDF renderer cannot apply the feature |
| Tables | Hairline borders, tabular numbers, rupee amounts right aligned |
| Status | Written words (Met, Not met), never colour only |
| Charts | Only on the discharge report: baseline vs final as a simple paired bar or table; greyscale safe |
| Sign off | Clinician name, credentials, digital signature image, date and time |
| Footer | Document version, generated date, "Movementology Clinics" |

| Document | Sections |
| --- | --- |
| Consultation summary | Patient details; clinical notes (complaint, examination, investigations); diagnosis; physiotherapy diagnosis (if the client chooses to print it); plan of treatment; investigations plan; referral plan; review plan; sign off |
| Invoice and receipt | Bill number, date, centre, patient, line items, discounts, total, payment method and reference, package details and expiry |
| Referral letter | Patient details, date of consultation, working diagnosis and reasoning, relevant findings and imaging, treatment so far, the specific question for the specialist, referring physio contact |
| Discharge report | Episode summary; attendance; baseline vs final symptoms and measures; questionnaire scores; goals; criteria status with any override and its reason; ongoing needs; recommendations; sign off |

Screen print styles (for a printed Today list or patient summary) hide navigation and use the same type and black and white rules.
