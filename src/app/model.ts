/**
 * Grid view model. Columns, filters and the hand-built row model: group
 * header, its sites, its subtotal, repeated, then a grand total.
 *
 * Subtotals add the site values as displayed, so every column that sums
 * reconciles on screen: the digits a planner reads in the site rows add to the
 * digits in the subtotal, and subtotals add to the grand total.
 */
import { engine, type PlanResult, type PlanningUnit, type SiteSlice } from '../engine/index.ts';
import { displayRound, type Format } from './format.ts';

export type ColumnKey =
  | 'site'
  | 'volume'
  | 'aht'
  | 'workload'
  | 'occ'
  | 'shrink'
  | 'required'
  | 'rostered'
  | 'opening'
  | 'attrition'
  | 'hires'
  | 'closing'
  | 'gap'
  | 'hireNeed'
  | 'classStart';

export type NumericKey = Exclude<ColumnKey, 'site' | 'classStart'>;

export type GroupId = 'identity' | 'demand' | 'requirement' | 'supply' | 'hiring';

export interface ColumnGroupSpec {
  id: GroupId;
  label: string;
}

export const COLUMN_GROUPS: readonly ColumnGroupSpec[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'demand', label: 'Demand' },
  { id: 'requirement', label: 'Requirement' },
  { id: 'supply', label: 'Supply' },
  { id: 'hiring', label: 'Gap & hiring' },
];

type Aggregate = 'sum' | 'ahtWeighted' | 'effectiveShrink' | 'none';

export interface ColumnSpec {
  key: ColumnKey;
  header: string;
  group: GroupId;
  width: number;
  format?: Format;
  aggregate: Aggregate;
  /** Planner-editable on site rows. 'week1' only in the first week. */
  input?: 'always' | 'week1';
}

export const COLUMNS: readonly ColumnSpec[] = [
  { key: 'site', header: 'Site', group: 'identity', width: 204, aggregate: 'none' },
  { key: 'volume', header: 'Volume', group: 'demand', width: 82, format: 'int', aggregate: 'sum', input: 'always' },
  { key: 'aht', header: 'AHT s', group: 'demand', width: 56, format: 'int', aggregate: 'ahtWeighted', input: 'always' },
  { key: 'workload', header: 'Workload hrs', group: 'demand', width: 98, format: 'one', aggregate: 'sum' },
  { key: 'occ', header: 'Occ %', group: 'requirement', width: 58, format: 'pct', aggregate: 'none', input: 'always' },
  { key: 'shrink', header: 'Shrink %', group: 'requirement', width: 70, format: 'pct', aggregate: 'effectiveShrink', input: 'always' },
  { key: 'required', header: 'Required FTE', group: 'requirement', width: 94, format: 'one', aggregate: 'sum' },
  { key: 'rostered', header: 'Rostered FTE', group: 'requirement', width: 96, format: 'one', aggregate: 'sum' },
  { key: 'opening', header: 'Opening HC', group: 'supply', width: 86, format: 'int', aggregate: 'sum', input: 'week1' },
  { key: 'attrition', header: 'Attrition', group: 'supply', width: 74, format: 'one', aggregate: 'sum' },
  { key: 'hires', header: 'Hires prod.', group: 'supply', width: 82, format: 'int', aggregate: 'sum' },
  { key: 'closing', header: 'Closing HC', group: 'supply', width: 84, format: 'int', aggregate: 'sum' },
  { key: 'gap', header: 'Gap', group: 'hiring', width: 72, format: 'signed', aggregate: 'sum' },
  { key: 'hireNeed', header: 'Hire need', group: 'hiring', width: 76, format: 'int', aggregate: 'sum' },
  { key: 'classStart', header: 'Class start', group: 'hiring', width: 86, aggregate: 'none' },
];

export function columnSpec(key: ColumnKey): ColumnSpec {
  const spec = COLUMNS.find((c) => c.key === key);
  if (!spec) throw new Error(`Unknown column ${key}`);
  return spec;
}

// Filters ---------------------------------------------------------------------

export const FILTER_DIMENSIONS = [
  { key: 'lob', label: 'Line of business', values: ['Mobile', 'Internet', 'Cable'] },
  { key: 'language', label: 'Language', values: ['EN', 'FR', 'ES', 'TL'] },
  { key: 'channel', label: 'Channel', values: ['voice', 'chat', 'deferred'] },
] as const;

export type FilterKey = (typeof FILTER_DIMENSIONS)[number]['key'];

/** Selected values per dimension. Every value selected means no filter. */
export type Filters = Readonly<Record<FilterKey, readonly string[]>>;

export const ALL_FILTERS: Filters = {
  lob: FILTER_DIMENSIONS[0].values,
  language: FILTER_DIMENSIONS[1].values,
  channel: FILTER_DIMENSIONS[2].values,
};

export function isFiltered(filters: Filters): boolean {
  return FILTER_DIMENSIONS.some((d) => filters[d.key].length < d.values.length);
}

export function unitPredicate(filters: Filters): (u: PlanningUnit) => boolean {
  const lob = new Set(filters.lob);
  const language = new Set(filters.language);
  const channel = new Set<string>(filters.channel);
  return (u) => lob.has(u.lob) && language.has(u.language) && channel.has(u.channel);
}

export const CHANNEL_LABEL: Readonly<Record<string, string>> = { voice: 'Voice', chat: 'Chat', deferred: 'Deferred' };

// Rows ------------------------------------------------------------------------

export type Grouping = 'vendor' | 'country' | 'none';

export const GROUPINGS: readonly { id: Grouping; label: string; band: string }[] = [
  { id: 'vendor', label: 'Vendor', band: 'Vendor / site' },
  { id: 'country', label: 'Country', band: 'Country / site' },
  { id: 'none', label: 'None', band: 'Site' },
];

export const COUNTRY_NAME: Readonly<Record<string, string>> = {
  PH: 'Philippines',
  EG: 'Egypt',
  JM: 'Jamaica',
  CN: 'China',
  MX: 'Mexico',
  CA: 'Canada',
};

export type RowKind = 'group' | 'site' | 'subtotal' | 'total';

export interface GridRow {
  id: string;
  kind: RowKind;
  label: string;
  siteId?: string;
  /** Short site code shown beside the name. */
  code?: string;
  vendor?: string;
  atCap?: boolean;
  cells: Readonly<Partial<Record<NumericKey, number | null>>>;
  classStart: string | null;
  /** Columns a planner may change on this row. */
  inputs: ReadonlySet<ColumnKey>;
  slice?: SiteSlice;
}

export interface RowModelOptions {
  week: number;
  filters: Filters;
  grouping: Grouping;
}

export function buildRows(plan: PlanResult, opts: RowModelOptions): GridRow[] {
  const include = unitPredicate(opts.filters);
  const siteRows: GridRow[] = [];
  for (const sp of plan.sites) {
    const period = sp.periods[opts.week - 1];
    if (!period) throw new RangeError(`Week ${opts.week} outside the horizon`);
    const slice = engine.sliceSitePeriod(period, include);
    if (!slice) continue;
    siteRows.push(siteRow(sp.site.id, sp.site.name, sp.site.vendor, slice, opts.week));
  }

  const rows: GridRow[] = [];
  if (opts.grouping === 'none') {
    rows.push(...siteRows);
  } else {
    const keyOf = (r: GridRow) => (opts.grouping === 'vendor' ? (r.vendor ?? '') : countryOf(plan, r.siteId));
    const order: string[] = [];
    for (const r of siteRows) if (!order.includes(keyOf(r))) order.push(keyOf(r));
    for (const key of order) {
      const members = siteRows.filter((r) => keyOf(r) === key);
      const label = opts.grouping === 'vendor' ? key : (COUNTRY_NAME[key] ?? key);
      rows.push({ id: `group:${key}`, kind: 'group', label, cells: {}, classStart: null, inputs: new Set() });
      rows.push(...members);
      rows.push(aggregateRow(`subtotal:${key}`, 'subtotal', `Subtotal ${label}`, members));
    }
  }
  if (siteRows.length > 0) rows.push(aggregateRow('total', 'total', 'Grand total', siteRows));
  return rows;
}

function countryOf(plan: PlanResult, siteId: string | undefined): string {
  return plan.sites.find((s) => s.site.id === siteId)?.site.country ?? '';
}

function siteRow(id: string, name: string, vendor: string, s: SiteSlice, week: number): GridRow {
  const inputs = new Set<ColumnKey>(
    COLUMNS.filter((c) => c.input === 'always' || (c.input === 'week1' && week === 1)).map((c) => c.key),
  );
  return {
    id: `site:${id}`,
    kind: 'site',
    label: name,
    siteId: id,
    code: id,
    vendor,
    atCap: s.atCap,
    cells: {
      volume: s.volume,
      aht: s.aht,
      workload: s.workloadHours,
      occ: s.occupancyCeiling,
      shrink: s.shrinkage,
      required: s.requiredFte,
      rostered: s.rosteredFte,
      opening: s.opening,
      attrition: s.attrition,
      hires: s.hiresProductive,
      closing: s.closing,
      gap: s.gap,
      hireNeed: s.hiresToStart,
    },
    classStart: s.hiresToStart > 0 ? s.classStartLabel : null,
    inputs,
    slice: s,
  };
}

function aggregateRow(id: string, kind: 'subtotal' | 'total', label: string, members: readonly GridRow[]): GridRow {
  const slices = members.map((m) => m.slice).filter((s): s is SiteSlice => s !== undefined);
  const cells: Partial<Record<NumericKey, number | null>> = {};
  for (const col of COLUMNS) {
    if (col.key === 'site' || col.key === 'classStart') continue;
    const key = col.key;
    switch (col.aggregate) {
      case 'sum':
        cells[key] = members.reduce((s, m) => s + displayRound(m.cells[key] ?? 0, col.format ?? 'one'), 0);
        break;
      case 'ahtWeighted': {
        const vol = slices.reduce((s, x) => s + x.volume, 0);
        cells[key] = vol === 0 ? null : slices.reduce((s, x) => s + x.volume * x.aht, 0) / vol;
        break;
      }
      case 'effectiveShrink': {
        const rost = slices.reduce((s, x) => s + x.rosteredFte, 0);
        cells[key] = rost === 0 ? null : 1 - slices.reduce((s, x) => s + x.requiredFte, 0) / rost;
        break;
      }
      case 'none':
        cells[key] = null;
        break;
    }
  }
  // Summing rounded values can leave float dust; settle at display precision.
  for (const col of COLUMNS) {
    const key = col.key as NumericKey;
    const v = cells[key];
    if (col.aggregate === 'sum' && typeof v === 'number') cells[key] = displayRound(v, col.format ?? 'one');
  }
  return { id, kind, label, cells, classStart: null, inputs: new Set() };
}
