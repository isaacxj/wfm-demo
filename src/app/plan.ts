/** The production plan this demo opens on. Invented. */
export const PLAN = {
  name: 'FY27 Production Plan',
  version: 'v3',
  scenario: 'Baseline',
  locked: true,
  lockedOn: '2026-10-12',
  owner: 'Capacity planning',
  /** Week a viewer lands on. Supply has rolled forward for 11 weeks by then. */
  landingWeek: 12,
} as const;
