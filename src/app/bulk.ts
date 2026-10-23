/**
 * Bulk entry: many rows of one metric edited at once.
 *
 * Volume and AHT are set per planning unit, as a percentage change over a
 * week range. Shrinkage, occupancy, attrition and the cap are set per site,
 * the work week per site and staff type. Edits become one bulk override per
 * metric, so closing the view recalculates once however many rows changed.
 */
import { unitLabel, type PlanInput, type PlanningUnit, type SiteInput, type StaffType } from '../engine/index.ts';
import { BULK_LEVEL, BULK_METRIC_LABEL, type BulkMetric, type BulkOverride } from '../scenario/scenario.ts';
import { STAFF_TYPE_LABEL } from './model.ts';

export const BULK_TREE: readonly { group: string; metrics: readonly BulkMetric[] }[] = [
  { group: 'Demand', metrics: ['volume', 'aht'] },
  { group: 'Requirement', metrics: ['shrinkage', 'occupancy', 'workWeek'] },
  { group: 'Supply', metrics: ['attrition', 'cap'] },
];

export const BULK_FILTERS = [
  { key: 'outsourcer', label: 'Outsourcer', level: 'site' },
  { key: 'site', label: 'Site', level: 'site' },
  { key: 'lob', label: 'Business Unit', level: 'unit' },
  { key: 'language', label: 'Language', level: 'unit' },
  { key: 'channel', label: 'Channel', level: 'unit' },
  { key: 'staffType', label: 'Staff Type', level: 'staffType' },
] as const;

export type BulkFilterKey = (typeof BULK_FILTERS)[number]['key'];
/** Selected values per filter. Every value selected means no filter. */
export type BulkFilters = Readonly<Record<BulkFilterKey, readonly string[]>>;

/** What an edit means for each metric, as the planner types it. */
export const BULK_INPUT: Readonly<Record<BulkMetric, { unit: string; label: string; min: number; max: number }>> = {
  volume: { unit: '%', label: 'Change', min: -99.9, max: 1000 },
  aht: { unit: '%', label: 'Change', min: -99.9, max: 1000 },
  shrinkage: { unit: '%', label: 'Set to', min: 0, max: 94.9 },
  occupancy: { unit: '%', label: 'Set to', min: 1, max: 100 },
  workWeek: { unit: 'hrs', label: 'Set to', min: 1, max: 80 },
  attrition: { unit: '%', label: 'Set to', min: 0, max: 49.9 },
  cap: { unit: 'heads', label: 'Set to', min: 0, max: 100_000 },
};

export interface BulkRow {
  /** The key the override stores: unit id, site id or "site:staff type". */
  key: string;
  label: string;
  site: SiteInput;
  unit?: PlanningUnit;
  staffType?: StaffType;
  /** Value now, in the units the planner types (percent for ratios), at the focus week for volume and AHT. */
  current: number | null;
}

/** Values each filter offers, from the plan. */
export function filterValues(input: PlanInput): Record<BulkFilterKey, string[]> {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    outsourcer: uniq(input.sites.map((s) => s.outsourcer)),
    site: input.sites.map((s) => s.id),
    lob: uniq(input.units.map((u) => u.lob)),
    language: uniq(input.units.map((u) => u.language)),
    channel: uniq(input.units.map((u) => u.channel)),
    staffType: ['full-time', 'part-time'],
  };
}

export function allFilters(input: PlanInput): BulkFilters {
  return filterValues(input);
}

/** Whether a filter narrows the rows of a metric: unit filters do not apply to site rows. */
export function filterApplies(metric: BulkMetric, key: BulkFilterKey): boolean {
  const level = BULK_FILTERS.find((f) => f.key === key)!.level;
  const rows = BULK_LEVEL[metric];
  return level === 'site' || level === rows || (level === 'staffType' && rows === 'unit');
}

/** The rows a metric lists under the filters, with their values in `input` (the plan as the scenario stands). */
export function bulkRows(input: PlanInput, metric: BulkMetric, filters: BulkFilters, week: number): BulkRow[] {
  const has = (key: BulkFilterKey, v: string) => filters[key].includes(v);
  const sites = input.sites.filter((s) => has('outsourcer', s.outsourcer) && has('site', s.id));
  const level = BULK_LEVEL[metric];
  if (level === 'unit') {
    const w = input.weeks.findIndex((x) => x.index === week);
    return sites.flatMap((site) =>
      input.units
        .filter(
          (u) =>
            u.siteId === site.id &&
            has('lob', u.lob) &&
            has('language', u.language) &&
            has('channel', u.channel) &&
            has('staffType', u.staffType ?? 'full-time'),
        )
        .map((u) => {
          const cell = input.demand[u.id]?.[w];
          return { key: u.id, label: unitLabel(u), site, unit: u, current: cell ? (metric === 'volume' ? cell.volume : cell.aht) : null };
        }),
    );
  }
  if (level === 'staffType') {
    return sites.flatMap((site) => {
      const types: StaffType[] = input.units.some((u) => u.siteId === site.id && u.staffType === 'part-time') ? ['full-time', 'part-time'] : ['full-time'];
      return types
        .filter((t) => has('staffType', t))
        .map((t) => ({
          key: `${site.id}:${t}`,
          label: STAFF_TYPE_LABEL[t]!,
          site,
          staffType: t,
          current: t === 'part-time' ? (site.partTimeWorkWeekHours ?? null) : site.workWeekHours,
        }));
    });
  }
  const value = (s: SiteInput) =>
    metric === 'shrinkage' ? s.shrinkage * 100 : metric === 'occupancy' ? s.occupancyCeiling * 100 : metric === 'attrition' ? s.monthlyAttrition * 100 : s.cap;
  return sites.map((site) => ({ key: site.id, label: site.name, site, current: value(site) }));
}

/** The value a row would take, in typed units. */
export function editedValue(metric: BulkMetric, row: BulkRow, edit: number): number | null {
  if (BULK_LEVEL[metric] !== 'unit') return edit;
  if (row.current === null) return null;
  return metric === 'volume' ? Math.max(0, Math.round(row.current * (1 + edit / 100))) : row.current * (1 + edit / 100);
}

/** Why a typed edit is refused, or null when it is fine. */
export function invalidEdit(metric: BulkMetric, edit: number): string | null {
  const { min, max, unit } = BULK_INPUT[metric];
  if (!Number.isFinite(edit)) return 'Enter a number.';
  if (edit < min || edit > max) return `Between ${min} and ${max} ${unit}.`;
  return null;
}

export type BulkEdits = Readonly<Partial<Record<BulkMetric, Readonly<Record<string, number>>>>>;

/** One override per edited metric. Volume and AHT apply over their chosen weeks, else `defaultWeeks`. */
export function bulkDrafts(
  edits: BulkEdits,
  weeks: Readonly<Partial<Record<BulkMetric, [number, number]>>>,
  defaultWeeks: readonly [number, number],
): Omit<BulkOverride, 'code'>[] {
  const drafts: Omit<BulkOverride, 'code'>[] = [];
  for (const { metrics } of BULK_TREE) {
    for (const metric of metrics) {
      const rows = edits[metric];
      if (!rows || Object.keys(rows).length === 0) continue;
      const toPlan = (v: number) => (metric === 'workWeek' || metric === 'cap' ? (metric === 'cap' ? Math.round(v) : v) : v / 100);
      const [fromWeek, toWeek] = weeks[metric] ?? defaultWeeks;
      drafts.push({
        kind: 'bulk',
        scope: { type: 'all' },
        metric,
        values: Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, toPlan(v)])),
        fromWeek,
        toWeek,
      });
    }
  }
  return drafts;
}

export function bulkMetricLabel(metric: BulkMetric): string {
  return BULK_METRIC_LABEL[metric];
}
