# Build brief: WFM Capacity Planner demo

Repo: `github.com/isaacxj/wfm-demo`

You are building a working demo of a multi-vendor contact centre capacity
planning tool. The demo exists to create interest with a prospective client who
has not yet signed. It must look and behave like enterprise planning software
built by people who do this work. It must not look like a generated web app.

Read this whole brief before writing code. Where it is prescriptive, follow it
exactly. The visual specification in particular is already decided and is not
open for reinterpretation.

---

## 1. What the product does

Large enterprises outsource contact centre volume to several BPO vendors across
many countries, languages and lines of business. Deciding how many people are
needed, at which vendor, at which site, starting which week, is done today in
hand-built Excel files.

This tool takes a demand forecast and produces:

1. Required headcount per planning unit per period
2. The gap against current headcount after attrition and ramp
3. A recruitment instruction: how many to hire, at which site, starting which week
4. What-if scenarios forked from a locked plan, compared side by side

The product owns long-range capacity planning at weekly or monthly grain over a
three to eighteen month horizon. It does not forecast, schedule, or track
adherence. Demand is an input the customer's own forecasting team produces.

### Why it wins

An expert comparison of six WFM platforms found none fully meets capacity
planning needs. Two gaps matter:

- **Alvaria makes planners export scenarios to Excel to compare them.** Side by
  side comparison inside the product is the demo's payoff moment.
- **Assembled's BPO Planner ingests requirements as a CSV upload.** It never
  computes the requirement. Computing it is the wedge.

---

## 2. Stack, locked

- Vite + React 19 + TypeScript, strict mode
- TanStack Table v8 (`@tanstack/react-table@^8.21`) for the column model and
  header groups. Build the row model by hand; see section 6
- No backend, no database, no auth. The engine runs in the browser
- Static build to `dist/`, deployed to Cloudflare Pages from this private repo
- `vitest` for tests
- No UI component library. No Tailwind. Hand-written CSS with custom properties
- No chart library unless section 7 calls for a chart

Do not add dependencies beyond these without asking.

---

## 3. Calculation engine

Build it to this specification. The reference tests in 3.5 must pass.

The client's own calculation workbook is proprietary and has not been shared.
This engine is a standard textbook implementation that will be swapped out
later. Keep it behind a stable interface so the UI never changes when it is
replaced.

### 3.1 Period requirement, the capacity planning model

```
workload hours = volume × AHT / 3600
required FTE   = workload / (work week hours × occupancy ceiling)
rostered FTE   = required / (1 − shrinkage)
```

`rostered FTE` is the number a planner budgets and hires to.

### 3.2 Channel handling

- **voice**: as above
- **chat**: substitute `effective AHT = AHT / (concurrency × efficiency)`.
  Efficiency defaults: c=2 → 0.85, c=3 → 0.75, c=4 → 0.65. Dividing AHT by
  concurrency alone understates chat staffing by about a third
- **deferred** (email, back office): occupancy ceiling does not apply, use 1.0.
  The work queues for hours

### 3.3 Interval staffing, Erlang C

Needed for the inspector panel and for interval-level work. Erlang B recursion,
then Erlang C, then service level and ASA:

```
B(0,A) = 1
B(n,A) = A·B(n−1,A) / (n + A·B(n−1,A))
C(N,A) = B(N,A) / (1 − (A/N)(1 − B(N,A)))
SL(T)  = 1 − C(N,A) · e^(−(N−A)·T/AHT)
ASA    = C(N,A) · AHT / (N − A)
occ    = A / N
```

**The occupancy ceiling is mandatory.** Always return
`max(Erlang requirement, ceil(traffic / occupancy ceiling))`. Raw Erlang C at
enterprise scale returns staffing at 99.5% occupancy, which is arithmetically
correct and operationally impossible.

### 3.4 Roll-forward and hiring

```
period attrition rate = 1 − (1 − monthly rate)^(1 / periods per month)
attrition             = opening × period rate
closing               = opening − attrition + hires productive + transfers in − transfers out
gap                   = rostered required − closing
hires to start        = ceil(gap / (1 − training attrition))
start period          = needed period − (training weeks + nesting weeks)
```

Periods per month is 4.33 for weeks. Dividing a monthly rate by four is wrong
and compounds across the horizon.

Demo constants: training 4 weeks, nesting 2 weeks, training attrition 15%.

### 3.5 Reference tests, all must pass

| Case | Expected |
|---|---|
| 100 calls / 30 min, AHT 180s, 80% in 20s, no ceiling | 14 agents |
| 8,000 / 30 min, AHT 420s, 80% in 60s, no ceiling | 1,876 agents, occupancy above 99% |
| Same with 85% ceiling | 2,197 agents, occupancy bound true |
| AHT 420 → 441 (+5%), 85% ceiling | +109 agents, +156 after 30% shrinkage |
| Chat AHT 600s, c=3, eff 0.75 | effective AHT 266.7s |
| 232,400 contacts, AHT 418s, 45h week, 85% ceiling, 30.5% shrinkage | workload 26,984.2 hrs, required 705.5, rostered 1,015.1 |
| 20,000 deferred, AHT 300s, 32h | 52.08 FTE |
| 1,000 on-phone, 30% shrinkage | 1,428.6 rostered |
| 5% monthly attrition, weekly | 1.178%, and 5.89 heads lost from a base of 500 |
| Gap 60, 15% training attrition | 71 starters, 6 weeks earlier |

### 3.6 The trace

Every calculation returns an ordered array of steps, each carrying a label, a
value, a unit, optionally the formula used, optionally the assumption record
code that supplied an input, and optionally the Excel equivalent. The inspector
panel in section 7.3 renders this array directly. Do not compute the chain
twice.

---

## 4. Dummy data

Deterministic and seeded. Identical output on every run, so a screenshot taken
today matches the screen next month. Eight sites, four vendors.

| id | Vendor | Site | Country | Work week | Occ | Shrink | Monthly attr | Cap | Opening HC |
|---|---|---|---|---|---|---|---|---|---|
| MNL1 | Teleperformance | Manila-1 | PH | 45.0 | 0.85 | 0.305 | 0.052 | 980 | 944 |
| MNL2 | Teleperformance | Manila-2 | PH | 45.0 | 0.85 | 0.298 | 0.049 | — | 808 |
| CAI | Teleperformance | Cairo | EG | 42.5 | 0.85 | 0.284 | 0.041 | — | 522 |
| KIN | Telus International | Kingston | JM | 40.0 | 0.85 | 0.312 | 0.058 | 520 | 433 |
| CAN | Telus International | Guangzhou | CN | 44.0 | 0.85 | 0.276 | 0.037 | — | 581 |
| SZX | Accenture | Shenzhen | CN | 44.0 | 0.85 | 0.271 | 0.035 | — | 621 |
| MEX | Accenture | Mexico City | MX | 42.0 | 0.85 | 0.319 | 0.061 | — | 579 |
| YYZ | In-house | Toronto | CA | 37.5 | 0.82 | 0.246 | 0.022 | — | 267 |

Dimensions: lines of business Mobile, Internet, Cable. Languages EN, FR, ES, TL.
Channels voice, chat, deferred. Horizon 52 weeks of 2027.

Volume carries annual seasonality, a marketing spike in weeks 31 to 34, and a
year-end lift, so the horizon has visible shape. Manila-1 must breach its
contracted cap at some point in the horizon, because the demo depends on showing
a bound cap.

Headcount rolls forward from week 1, so the supply side has real shape by the
time a viewer lands on week 12. New hires reaching production each week are
`round(opening headcount × 0.03)`.

---

## 5. Visual specification, Direction A

This was chosen from a two-direction study and is locked. The governing
principle: **the grid is the product, chrome recedes, data advances.**

### 5.1 Banned, without exception

Gradient headers. Cards with large radius and drop shadows. Emoji as icons.
Body text at 16px or above. Indigo or violet accents. Cards where a table
belongs. Centred single-column layouts. Animation on state change. Abbreviated
numbers such as `1.2k` in cells. Full-cell red or green fills. Tailwind default
palette. Any radius above 3px.

### 5.2 Tokens

```css
--accent:#1F3864; --accent-soft:#E8EEF7;
--neg:#A8201A; --pos:#1F6B32; --warn:#8A5D09;
--ink-900:#0F141C; --ink-600:#47525F; --ink-400:#7C8796;
--surface-0:#FFFFFF; --surface-1:#F7F9FC; --surface-2:#EEF2F7;
--line-1:#E7ECF2; --line-2:#D4DBE4;
--chrome:#17202C; --chrome-rail:#1C2531; --chrome-line:#28323F;
--chrome-ink:#DCE4EE; --chrome-mute:#7C8B9D;
--font-ui:Inter,-apple-system,"Segoe UI",system-ui,sans-serif;
--font-num:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;
```

### 5.3 Rules

- **Numerals are monospaced** (`--font-num`), 11px, right aligned, in every
  grid cell and in the inspector. The identity column and all headers use
  `--font-ui`
- **Row height 25px.** Cell padding `0 7px`
- **Every cell is ruled on all four sides** with 1px `--line-1`
- **Column group band**: 19px, solid `--accent` fill, reversed 9.5px uppercase
  Inter at weight 700, letter-spacing .09em, 1px divider in `#2E4A7A`
- **Header row**: 26px, `--surface-2`, 9.5px uppercase Inter weight 700 in
  `--ink-600`
- **Top bar, left rail and status bar are dark.** Grid stays light
- **Radius zero everywhere**, buttons included. No shadows except a 1px edge on
  the frozen column
- Row fills: site rows white, vendor rows `#EDF1F7` weight 700, subtotals
  `--surface-1` weight 600, grand total `--surface-2` weight 700 with a 2px
  `--ink-900` top border
- **Input cells** carry a 2px inset left marker in `--accent-soft`. Computed
  cells carry none, so a planner can see what they may change
- Status colour never stands alone. Pair with a sign, a glyph or a label

### 5.4 Number formatting

Thousands separated always. FTE and attrition to one decimal. Headcount and
volume as integers. Percentages to one decimal. Gap signed, negative values
(surplus) in `--pos`, positive values (deficit) in `--neg`. True zero renders
`0.0` in `--ink-400`. Not applicable renders an en dash in `--ink-400`. Never
abbreviate inside a grid cell.

---

## 6. Application shell

```
┌─────────────────────────────────────────────────────────────────┐
│ TOP BAR 48px  dark                                              │
│ mark │ Plan ▾ │ Scenario ▾ [LOCKED] │ Grain ▾ │ Period │ Export │
├──────────┬──────────────────────────────┬───────────────────────┤
│ RAIL     │ TOOLBAR 34px                 │ INSPECTOR 300px       │
│ 200px    │ Group ▾ Filter ▾ Columns ▾   │                       │
│ dark     ├──────────────────────────────┤ calculation chain     │
│          │ GRID                         │ for the selected cell │
├──────────┴──────────────────────────────┴───────────────────────┤
│ STATUS BAR 28px  dark                                           │
└─────────────────────────────────────────────────────────────────┘
```

Rail items: Plans, Scenarios, Hiring plan, then Vendors & sites, Assumptions,
Imports, Audit. Plan, scenario and lock state stay visible at all times.

### Grid columns, in five groups

| Group | Columns |
|---|---|
| Identity (frozen left) | Site |
| Demand | Volume, AHT s, Workload hrs |
| Requirement | Occ %, Shrink %, Required FTE, Rostered FTE |
| Supply | Opening HC, Attrition, Hires prod., Closing HC |
| Gap & hiring | Gap, Hire need, Class start |

Rows are ordered: vendor header, its sites, vendor subtotal, repeated per
vendor, then a grand total. Build this row model by hand and feed it to
TanStack Table. Do not use TanStack grouping. Header row and the identity
column are sticky.

A site at its contracted cap shows a `CAP` flag in `--warn` beside its name.

---

## 7. Build phases

Commit at the end of each phase. Push to `main`. Stop and report before moving
to the next phase.

### Phase 1 — Engine and data
The engine from section 3 with the tests from 3.5 passing, and the seeded
dataset from section 4. No UI.
**Done when:** `npm test` passes and a script prints dataset totals.

### Phase 2 — Plan grid
The shell from section 6 and the grid, in Direction A, running on real engine
output. Working toolbar filters for week, line of business, language and
channel. Changing week visibly changes volume and headcount.
**Done when:** it matches section 5 exactly and the numbers reconcile across
site, subtotal and total rows.

### Phase 3 — Calculation inspector
Clicking any computed cell renders that row's trace in the right panel: every
intermediate value, the formula, and the assumption code that supplied each
input. Include a "Copy as Excel formula" button that puts a working Excel
formula on the clipboard. Show the cap breach when one applies.
**Done when:** every number in the grid can be traced to its inputs on screen.

### Phase 4 — Scenario comparison
A locked production plan, forking a scenario, and overriding variables: volume,
AHT, shrinkage, attrition, site headcount cap. Comparison uses inline delta
columns, showing baseline, scenario and delta per metric. Changed rows only by
default with a toggle for all. Must render in under one second.
**Done when:** adding 10,000 contacts a week to a scenario shows the headcount
delta side by side without leaving the screen.

### Phase 5 — Hiring plan view
A view answering: how many to hire, at which site, starting which week. Grouped
by class start week. This is the product's payoff output.
**Done when:** it reads as a recruitment instruction a person could act on.

### Phase 6 — Excel export
Plans and comparisons to `.xlsx` preserving the group structure. Use a small
library and ask before adding it.

### Phase 7 — Deploy
Cloudflare Pages from this repo. Build `npm run build`, output `dist`.
`<meta name="robots" content="noindex, nofollow">` must be present. Report the
URL.

---

## 8. Out of scope

Do not build: forecast generation, interval or intraday spread, scheduling,
adherence, agent-level tracking, ACD or HRIS integrations, revenue or profit
modelling, Monte Carlo or probabilistic methods, support staff ratio planning,
multi-tenant billing, SSO, dark theme, mobile layouts.

If a phase seems to need one of these, stop and ask.

---

## 9. Acceptance: the demo script

The build is finished when someone can be walked through this without a stumble.

1. Open a locked production plan and read the grid
2. Move AHT by 5 percent and watch roughly 156 people appear
3. Fork a scenario, add 10,000 contacts a week, compare side by side
4. Cut Manila-1 below its requirement, see the cap bind and the shortfall surface
5. Open the hiring plan and read the instruction with site and start week
6. Select any computed cell and trace the chain in the inspector
7. Export to Excel

---

## 10. Attribution and repo hygiene

**This repository must contain no reference to the tooling used to build it,
and no reference to any automated authoring tool, model or vendor.** This is a
hard requirement with no exceptions. The repo is a Statixx Solutions work
product and reads as one, in its files, its history and its built output.

Rules:

- **No tool instruction files of any kind**, under any name or extension.
  This brief, committed as `BRIEF.md`, is the only instruction file in the repo
- **No co-author trailers.** A commit message ends at its subject and body.
  No trailer naming a tool, model or vendor
- **No generated-with footers** in commit messages, pull request descriptions,
  release notes, issue text or changelogs
- **No tooling directories committed.** Ignore them through your *global*
  gitignore so the repository's own `.gitignore` carries no reference to them
- **No mentions in source or docs.** Nothing in code, comments, README,
  variable names, test names, fixtures, HTML comments or the built bundle
- **No mentions in metadata.** Not in `package.json` fields, not in the page
  title, not in meta tags, not in the commit identity

Run the hygiene check before every commit. The term list is kept outside the
repository so the repository never contains the terms being searched for:

```bash
grep -rniEf ~/.statixx-hygiene-terms \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist . \
  && echo "ATTRIBUTION FOUND, fix before committing" || echo "clean"
```

Expect one benign hit on `cursor: pointer` in CSS. Everything else must be
fixed. If a tool writes attribution automatically, disable that behaviour
rather than cleaning up after it. Attribution already pushed must be amended or
rebased out of history, not left in place.

---

## 11. Working agreement

- Conventional commits. One commit per phase minimum
- Never commit `node_modules` or `dist`
- Never commit real client data. Everything in this repo is invented
- Run the attribution check in section 10 before every commit
- Keep `README.md` current with build status per phase
- If the visual specification in section 5 is inconvenient, follow it anyway and
  raise the issue in your report
- At the end of each phase, report: what was built, what the tests say, what you
  had to decide, and anything in this brief that turned out wrong
