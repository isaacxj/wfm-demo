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
| 2 | Plan grid | Not started |
| 3 | Calculation inspector | Not started |
| 4 | Scenario comparison | Not started |
| 5 | Hiring plan view | Not started |
| 6 | Excel export | Not started |
| 7 | Deploy | Not started |

## Commands

Node 22.18 or later.

```bash
npm install
npm test           # engine reference cases and dataset checks
npm run typecheck
npm run totals     # prints dataset totals and the week 12 snapshot
```

## Layout

```
src/engine/   calculation engine; the UI imports src/engine/index.ts only
  requirement.ts  period requirement, channel handling
  erlang.ts       interval staffing, Erlang C with occupancy ceiling
  supply.ts       attrition, roll-forward, cap, hiring need
  plan.ts         unit → site → week plan computation
  trace.ts        calculation trace with Excel equivalents
  calendar.ts     ISO week arithmetic
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
- Hiring: starters = ceil(gap ÷ (1 − training attrition)), starting training + nesting weeks before the need

Every result carries an ordered trace: label, value, unit, formula, the
assumption record code of each input, and an Excel formula that reproduces the
value from literal inputs.
