# Changelog

## v2.6 — Driver and event register

- Registered events: name, type, scope (all sites, outsourcer, site or
  business unit), week range, and a percentage effect on volume and AHT. The
  engine applies them; each effect is an input with its own assumption record.
- Three seeded: EV01 summer offer campaign (W31–W34), EV02 compliance
  disclosure training (W14–W19), EV03 billing platform migration (W38–W40).
  The W31–W34 marketing spike moved out of the forecast seasonality and into
  EV01, so the plan says what causes it.
- An Events view in the rail: the register, each event's peak effect on
  Required FTE and the starters it causes, Show in plan, Switch off, and
  Register event. Changes fork a scenario from the locked plan.
- The Periods grid annotates events over their weeks. The inspector names
  every event in effect for the selected cell, with what it contributes to the
  number and the value without it.
- Hiring class drivers name the events in their week; exports include an
  Events sheet.

## v2.5 — Bulk entry and Staff Type

- **Staff Type** on every planning unit: full-time or part-time. Kingston,
  Mexico City and Toronto run part-time programmes on their voice and chat
  queues; a part-time unit plans at its site's part-time work week (24, 24
  and 20 hours, records `KIN.PTW`, `MEX.PTW`, `YYZ.PTW`). 68 planning units
  become 88. Staff Type is a filter beside Business Unit, Language and
  Channel.
- **Bulk entry**: a view over the grid with a metric tree, filters for
  outsourcer, site, business unit, language, channel and staff type, and an
  editable list of the matching rows. Applying turns the edits into one bulk
  override per metric and recalculates once; on the locked plan it forks a
  scenario.

## v2.4 — Edit control and class constraints

- **Pause recalculation**: a toolbar toggle. Edits made while paused are
  staged; the grid greys out and the status bar counts pending changes.
  Resume recalculates once.
- **Class constraints** as plan constants: maximum class size (30), classes a
  site can start in one week (2), and blocked start weeks (W06 Lunar New Year,
  W12 Holy Week, W51 Christmas, W52 New Year), with assumption records.
- When the ideal start week is blocked or full, starters move to an earlier
  week, never later. The move is recorded with its reason, shown on the class,
  in the inspector and in the hiring plan's exceptions; a need no earlier week
  can take is listed as an exception.
- Starters per site-week are split into classes no larger than the maximum.
- Hires to start in the scenario summary now include moved classes.

## v2.3 — Actuals, plan and scenario

- Weeks W01 to W11 have elapsed and carry actuals: observed volume and AHT per
  planning unit, headcount per site. The Periods grid shows them as a shaded
  **Actual** band, then the locked **Plan**, or the open **Scenario**, tinted.
- Actual Required FTE is what the observed volume and AHT imply, by the plan's
  arithmetic; actual Over/Under = observed headcount − that requirement.
- A **Var. vs plan** row under each row: actual − plan, then scenario − plan.
  A site whose Over/Under has drifted 5% of its requirement or more over the
  last four elapsed weeks is flagged **OFF PLAN**.
- The Periods export adds a locked-plan sheet and a variance sheet of live
  formulas against it.
- Screenshots refreshed with the v2 names.

## v2.2 — Grid orientation

- **Periods** mode, the new default: weeks across the columns, one metric in
  the cells. **Metrics** mode is the v1 grid. A **Density** toggle switches
  between 25px and 21px rows.

## v2.1 — Terminology

Names now follow the incumbent WFM tools, so a planner moving from Verint,
Genesys or NICE reads the grid the way they already read their own.

| v1 | v2 |
|---|---|
| Required FTE (before shrinkage) | Productive FTE |
| Rostered FTE (after shrinkage) | Required FTE |
| Gap (rostered − closing) | Over/Under (planned − required) |
| Closing HC | Planned FTE |
| Gap & hiring | Over/under & hiring |
| Vendor | Outsourcer |
| Line of business | Business Unit |

- **Over/Under changes sign.** v1's Gap was positive for a deficit. Over/Under
  is positive for a surplus and negative for a deficit, as in the incumbent
  tools. Colours follow: over in green, under in red, always with a sign.
- **Required FTE includes shrinkage.** The inspector states this on every
  Required FTE step and on every selected Required FTE cell; Excel exports
  state it under each sheet title.
- **Code follows the screen.** `rosteredFromProductive` → `requiredFromProductive`;
  `RequirementResult.rosteredFte` → `requiredFte` and `.requiredFte` →
  `productiveFte`; trace steps `rostered` → `required`, `required` →
  `productive`, `gap` → `overUnder`; grid columns `closing` → `planned`;
  `SiteInput.vendor` → `outsourcer`; scenario scope `vendor` → `outsourcer`;
  grouping `vendor` → `outsourcer`.
- **Saved scenarios** scoped to a vendor are migrated to the outsourcer scope
  when read; anything unreadable is dropped silently.
- Numbers are unchanged. The dataset fingerprint changes only because the
  site field is renamed.
