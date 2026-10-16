# WFM Capacity Planner (demo)

Multi-vendor contact centre capacity planning. Takes a weekly demand forecast
and produces required headcount per site, the gap against supply after
attrition and ramp, and the recruitment instruction: how many to hire, where,
starting which week.

Statixx Solutions. All data in this repository is invented.

## Build status

| Phase | Scope | Status |
|---|---|---|
| 1 | Calculation engine and seeded dataset | Done |
| 2 | Plan grid | Done |
| 3 | Calculation inspector | Done |
| 4 | Scenario comparison | Not started |
| 5 | Hiring plan view | Not started |
| 6 | Excel export | Not started |
| 7 | Deploy | Not started |

## Commands

Node 22.18 or later.

```bash
npm install
npm run dev        # local app
npm run build      # typecheck and static build to dist/
npm test           # engine reference cases, dataset and grid checks
npm run typecheck
npm run totals     # prints dataset totals and the week 12 snapshot
```

## Layout

```
src/engine/   calculation engine; the UI imports src/engine/index.ts only
  requirement.ts  period requirement, channel handling
  erlang.ts       interval staffing, Erlang C with occupancy ceiling
  supply.ts       attrition, roll-forward and hiring primitives
  siteweek.ts     site-week roll-forward with the recommended class fed back
  plan.ts         unit → site → week plan computation
  slice.ts        filtered slice of a site-week, supply allocated by share
  trace.ts        calculation trace with Excel equivalents
  calendar.ts     ISO week arithmetic
src/app/      application shell, plan grid, row model and calculation inspector
src/testing/  test helpers, never imported by the app
src/data/     seeded demo dataset, 8 sites, 4 vendors, 68 planning units, 52 weeks of 2027
scripts/      totals.ts
```

## Engine

A textbook capacity model behind the `CapacityEngine` interface in
`src/engine/index.ts`. A replacement engine implements the same interface.

- Requirement: workload = volume × AHT ÷ 3600; required = workload ÷ (work week × occupancy); rostered = required ÷ (1 − shrinkage)
- Chat: effective AHT = AHT ÷ (concurrency × efficiency). Deferred work applies no occupancy ceiling
- Interval: Erlang C, always floored at ceil(traffic ÷ occupancy ceiling)
- Supply: weekly attrition = 1 − (1 − monthly)^(1 ÷ 4.33); a contracted cap limits productive hires and surfaces demand above it as a cap shortfall
- Hiring: starters = ceil(deficit ÷ (1 − training attrition)), starting training + nesting weeks before the need. The recommended class lands in supply, so a persisting deficit is hired for once
- Committed pipeline: classes already in training at plan start land in weeks 1 to 6; inside that lead time no new class can land, and any deficit remains as a lead-time shortfall
- Filters: demand sums over the matching planning units; site supply is allocated to the slice by its share of rostered FTE

Every result carries an ordered trace: label, value, unit, formula, the
assumption record code of each input, and an Excel formula that reproduces the
value from literal inputs. Each computed step lists the steps it was computed
from, and roll-ups carry their sub-chains: a site's demand carries each
planning unit's trace, a week's opening headcount carries the prior week's.

## Plan grid

Opens on the locked FY27 production plan at week 2027-W12. Rows are a vendor
header, its sites and a subtotal, then a grand total; grouping switches to
country or none. The toolbar filters by week, line of business, language and
channel. Under a filter, demand covers only the matching planning units and
site supply is split by share of rostered FTE; the supply band says so.

Subtotals add the site values as displayed, so every summed column reconciles
digit for digit on screen. Input cells carry a left marker; computed cells do
not.

## Calculation inspector

Selecting any cell shows how it was calculated, in the panel on the right:
every intermediate value with its formula, and the assumption record code of
each input. The default view is the chain behind the selected number; "Full
row" shows the whole site-week. Site roll-ups expand into their planning units,
opening headcount into the prior week, subtotals into their sites, and filtered
slices into the site they were split from.

"Copy as Excel formula" puts a self-contained formula on the clipboard that
reproduces the selected value from literal inputs. A site above its contracted
cap, a deficit inside the training lead time, and a filtered split are called
out above the chain. The panel collapses to a narrow strip and remembers its
state; selecting a cell opens it, Escape clears the selection.

