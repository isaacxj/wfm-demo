/**
 * ISO week arithmetic for weekly planning periods. All dates are UTC.
 */

const DAY_MS = 86_400_000;

/** Monday of ISO week 1 of the given ISO year. */
export function isoWeekOneMonday(isoYear: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(jan4.getTime() - dow * DAY_MS);
}

export function isoWeekOf(date: Date): { isoYear: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the year
  const isoYear = d.getUTCFullYear();
  const isoWeek = 1 + Math.round((d.getTime() - isoWeekOneMonday(isoYear).getTime() - 3 * DAY_MS) / (7 * DAY_MS));
  return { isoYear, isoWeek };
}

export function isoWeeksInYear(isoYear: number): number {
  return isoWeekOf(new Date(Date.UTC(isoYear, 11, 28))).isoWeek;
}

/** "2027-W07" */
export function isoWeekLabel(date: Date): string {
  const { isoYear, isoWeek } = isoWeekOf(date);
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Monday of a period counted from a horizon that starts at ISO week 1 of
 * `isoYear`. Index 1 is week 1; index 0 and below fall in the prior year.
 */
export function periodStart(isoYear: number, index: number): Date {
  return new Date(isoWeekOneMonday(isoYear).getTime() + (index - 1) * 7 * DAY_MS);
}

export function periodLabel(isoYear: number, index: number): string {
  return isoWeekLabel(periodStart(isoYear, index));
}
