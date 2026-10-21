# Changelog

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
