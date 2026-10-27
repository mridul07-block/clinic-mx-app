# Charts (DSH-02)

The charts that the dashboards, the progress tab and the patient pages are built from. Sources:

- design system v2, section 9 (`docs/design/README.md`);
- Frontend Specification, section 8 ("each number gets the chart that answers its question").

Ticket DSH-02 asks for line, bar and donut charts, plus a custom bullet graph, dumbbell, heatmap and
week strip, each with a table view.

## Decisions (28 October 2026)

These are recommended defaults, chosen under the user's standing approval of 28 October 2026. The
DECISION register records them under "DSH-02".

- **Hand-built SVG, no Recharts.** Design system v2 section 9 says "Hand-built SVG (no chart library
  needed)", and OUT-03 built the progress tab's line and bullet charts that way. The TAD's
  "Recharts plus small custom SVG components" is superseded. The reasons:
  - there is no new dependency;
  - the charts render on the server;
  - the charts are exact to the design.
- **A readout instead of a floating tooltip.** Every mark carries its value in words
  (`data-words`). Hovering, tapping or using the arrow keys (Home and End too) shows those words on
  the line above the chart (`ChartReadout`, the one client component). The focused mark gets an ink
  outline. This works the same at 360 px and on desktop, and meets the design system's
  "arrow-key access to its values".
- **The harness.** The charts are checked on a test harness, `/app/test-harness/charts`, which
  shows made-up figures and no patients. It returns 404 unless `CLINIC_MX_TEST_HARNESS=1`, so
  staging and production never show it. The dashboards themselves come with DSH-03 to DSH-05.

## The charts (`apps/web/components/charts/`)

Each chart is drawn inside `ChartFrame`, which holds the title, the readout and the "Show as table"
twin. The table's cells are words ("64, below target"). The rules for every chart:

- colours come only from tokens;
- axis labels are 11 px `ink-muted` and never rotated;
- bars rise and lines draw once, and nothing moves under reduced motion.

| Component | Draws | Used for (Frontend Specification section 8) |
| --- | --- | --- |
| `BarChart` | Columns from zero. A period still filling up is hatched and labelled "so far". An optional dashed target is labelled at its end. A comparison series is grey; centres are in their colours, with a key. | Daily collections, revenue against last year, appointments per centre |
| `HorizontalBars` | Sorted bars, the biggest first, top 10 by default (the table says how many are left out). The name is on the left and the value at the end. | Physio workload, notes on time, top diagnoses, feedback themes |
| `DonutChart` | One whole in 2 to 4 parts only (anything else throws). The total or a score is in the middle; each part is named with its count and share. | Booking channel, payment method, recommendation score |
| `LineChart` | One series with gaps for missing values and points labelled directly. It now has an optional dashed target line and a shaded band (meaningful change). | Pain per visit, questionnaire scores, AI top 3 by month |
| `BulletGraph` | The measure as a bar against a target tick. `lowerIsBetter` reverses it, so the bar grows from the right. | Completion, conversion, reinjury, LSI |
| `DumbbellChart` | Per row, a grey dot at the start and a blue dot at the end, on one scale. | Outcomes by diagnosis, baseline against discharge |
| `Heatmap` | Day by hour cells on the 7-step blue ramp, with a key. An hour with no value stays grey. | Busy hours |
| `WeekStrip` | Seven days: filled when done, an outline when missed, faint for a day still to come. Each day is named in words, with a count of the days done. | Exercise adherence |

The shared arithmetic and colour classes are in `chart-scale.ts`:

- `niceMax` rounds the end of an axis;
- `targetWords` words a value against its target;
- `rampStep` picks the heatmap's ramp step;
- the colour maps are whole class names, never built at run time.

The active-mark outline is in `packages/ui/src/styles/charts.css`.

## Tests

| Test | Covers |
| --- | --- |
| `apps/web/components/charts/dashboard-charts.test.tsx` | Axis ends and target words, ramp steps. The bar chart's marks, the hatched "so far" period, the target and the table in words. Centre colours and the key. Donut shares, and the refusal of 1 part or 5. Sorted top 10 bars. Dumbbell rows. Heatmap cells and the key. Week strip words. The line chart's target and band. The reversed bullet. |
| `apps/web/components/charts/charts.test.tsx` | The OUT-03 line chart, bullet graph and table twin, unchanged |
| `apps/web/e2e/charts.spec.ts` | At 360 px and desktop: every chart on the harness fits the screen. A tap on the "so far" bar says its value against the target. The arrow keys walk the heatmap. Every table twin opens in words. |

**Negative checks:** the unit tests fail in each of these cases:

- the "so far" hatch is removed;
- the donut's part limit is removed.
