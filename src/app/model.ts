/**
 * Grid view model. Columns, filters and the hand-built row model: group
 * header, its sites, its subtotal, repeated, then a grand total.
 *
 * Subtotals add the site values as displayed, so every column that sums
 * reconciles on screen: the digits a planner reads in the site rows add to the
 * digits in the subtotal, and subtotals add to the grand total.
 */
import { engine, type ActualResult, type ActualSlice, type PlanResult, type PlanningUnit, type SiteSlice } from '../engine/index.ts';
import { displayRound, type Format } from './format.ts';

export type ColumnKey =
  | 'site'
  | 'volume'
  | 'aht'
  | 'workload'
  | 'occ'
  | 'shrink'
  | 'productive'
  | 'required'
  | 'opening'
  | 'attrition'
  | 'hires'
  | 'planned'
  | 'overUnder'
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
  { id: 'hiring', label: 'Over/under & hiring' },
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
  { key: 'productive', header: 'Productive FTE', group: 'requirement', width: 106, format: 'one', aggregate: 'sum' },
  { key: 'required', header: 'Required FTE', group: 'requirement', width: 96, format: 'one', aggregate: 'sum' },
  { key: 'opening', header: 'Opening HC', group: 'supply', width: 86, format: 'int', aggregate: 'sum', input: 'week1' },
  { key: 'attrition', header: 'Attrition', group: 'supply', width: 74, format: 'one', aggregate: 'sum' },
  { key: 'hires', header: 'Hires prod.', group: 'supply', width: 82, format: 'int', aggregate: 'sum' },
  { key: 'planned', header: 'Planned FTE', group: 'supply', width: 92, format: 'int', aggregate: 'sum' },
  { key: 'overUnder', header: 'Over/Under', group: 'hiring', width: 88, format: 'signed', aggregate: 'sum' },
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
  { key: 'lob', label: 'Business Unit', values: ['Mobile', 'Internet', 'Cable'] },
  { key: 'language', label: 'Language', values: ['EN', 'FR', 'ES', 'TL'] },
  { key: 'channel', label: 'Channel', values: ['voice', 'chat', 'deferred'] },
  { key: 'staffType', label: 'Staff Type', values: ['full-time', 'part-time'] },
] as const;

export type FilterKey = (typeof FILTER_DIMENSIONS)[number]['key'];

/** Selected values per dimension. Every value selected means no filter. */
export type Filters = Readonly<Record<FilterKey, readonly string[]>>;

export const ALL_FILTERS: Filters = {
  lob: FILTER_DIMENSIONS[0].values,
  language: FILTER_DIMENSIONS[1].values,
  channel: FILTER_DIMENSIONS[2].values,
  staffType: FILTER_DIMENSIONS[3].values,
};

export function isFiltered(filters: Filters): boolean {
  return FILTER_DIMENSIONS.some((d) => filters[d.key].length < d.values.length);
}

export function unitPredicate(filters: Filters): (u: PlanningUnit) => boolean {
  const lob = new Set(filters.lob);
  const language = new Set(filters.language);
  const channel = new Set<string>(filters.channel);
  const staffType = new Set<string>(filters.staffType);
  return (u) => lob.has(u.lob) && language.has(u.language) && channel.has(u.channel) && staffType.has(u.staffType ?? 'full-time');
}

export const CHANNEL_LABEL: Readonly<Record<string, string>> = { voice: 'Voice', chat: 'Chat', deferred: 'Deferred' };
export const STAFF_TYPE_LABEL: Readonly<Record<string, string>> = { 'full-time': 'Full-time', 'part-time': 'Part-time' };

/** A filter value as the screen names it. */
export function filterValueLabel(key: FilterKey, value: string): string {
  if (key === 'channel') return CHANNEL_LABEL[value] ?? value;
  if (key === 'staffType') return STAFF_TYPE_LABEL[value] ?? value;
  return value;
}

// Rows ------------------------------------------------------------------------

export type Grouping = 'outsourcer' | 'country' | 'none';

export const GROUPINGS: readonly { id: Grouping; label: string; band: string }[] = [
  { id: 'outsourcer', label: 'Outsourcer', band: 'Outsourcer / site' },
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
  outsourcer?: string;
  atCap?: boolean;
  cells: Readonly<Partial<Record<NumericKey, number | null>>>;
  classStart: string | null;
  /** Columns a planner may change on this row. */
  inputs: ReadonlySet<ColumnKey>;
  slice?: SiteSlice;
  /** Set on rows of an elapsed week: observed, not planned. */
  actual?: ActualSlice;
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
    siteRows.push(siteRow(sp.site.id, sp.site.name, sp.site.outsourcer, slice, opts.week));
  }
  return assembleRows(plan, siteRows, opts.grouping);
}

/**
 * Rows of an elapsed week from actuals, in the same order and with the same ids
 * as the plan's rows for that week. Actuals are observed, so nothing is an input.
 */
export function buildActualRows(actuals: ActualResult, plan: PlanResult, opts: RowModelOptions): GridRow[] {
  const include = unitPredicate(opts.filters);
  const siteRows: GridRow[] = [];
  for (const sp of plan.sites) {
    const period = actuals.sites.find((a) => a.siteId === sp.site.id)?.periods[opts.week - 1];
    if (!period) throw new RangeError(`No actuals for ${sp.site.id} in week ${opts.week}`);
    const a = engine.sliceActualPeriod(period, include);
    if (!a) continue;
    siteRows.push({
      id: `site:${sp.site.id}`,
      kind: 'site',
      label: sp.site.name,
      siteId: sp.site.id,
      code: sp.site.id,
      outsourcer: sp.site.outsourcer,
      atCap: sp.site.cap !== null && period.headcount >= sp.site.cap,
      cells: {
        volume: a.volume,
        aht: a.aht,
        workload: a.workloadHours,
        occ: a.occupancyCeiling,
        shrink: a.shrinkage,
        productive: a.productiveFte,
        required: a.requiredFte,
        opening: null,
        attrition: null,
        hires: null,
        planned: a.headcount,
        overUnder: a.overUnder,
        hireNeed: null,
      },
      classStart: null,
      inputs: new Set(),
      actual: a,
    });
  }
  return assembleRows(plan, siteRows, opts.grouping);
}

function assembleRows(plan: PlanResult, siteRows: readonly GridRow[], grouping: Grouping): GridRow[] {
  const rows: GridRow[] = [];
  if (grouping === 'none') {
    rows.push(...siteRows);
  } else {
    const keyOf = (r: GridRow) => (grouping === 'outsourcer' ? (r.outsourcer ?? '') : countryOf(plan, r.siteId));
    const order: string[] = [];
    for (const r of siteRows) if (!order.includes(keyOf(r))) order.push(keyOf(r));
    for (const key of order) {
      const members = siteRows.filter((r) => keyOf(r) === key);
      const label = grouping === 'outsourcer' ? key : (COUNTRY_NAME[key] ?? key);
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

function siteRow(id: string, name: string, outsourcer: string, s: SiteSlice, week: number): GridRow {
  const inputs = new Set<ColumnKey>(
    COLUMNS.filter((c) => c.input === 'always' || (c.input === 'week1' && week === 1)).map((c) => c.key),
  );
  return {
    id: `site:${id}`,
    kind: 'site',
    label: name,
    siteId: id,
    code: id,
    outsourcer,
    atCap: s.atCap,
    cells: {
      volume: s.volume,
      aht: s.aht,
      workload: s.workloadHours,
      occ: s.occupancyCeiling,
      shrink: s.shrinkage,
      productive: s.productiveFte,
      required: s.requiredFte,
      opening: s.opening,
      attrition: s.attrition,
      hires: s.hiresProductive,
      planned: s.closing,
      overUnder: s.overUnder,
      hireNeed: s.hiresToStart,
    },
    classStart: s.hiresToStart > 0 ? s.classStartLabel : null,
    inputs,
    slice: s,
  };
}

function aggregateRow(id: string, kind: 'subtotal' | 'total', label: string, members: readonly GridRow[]): GridRow {
  const raw = (m: GridRow, key: NumericKey) => m.cells[key] ?? 0;
  const cells: Partial<Record<NumericKey, number | null>> = {};
  for (const col of COLUMNS) {
    if (col.key === 'site' || col.key === 'classStart') continue;
    const key = col.key;
    // A value no member carries, such as hire need in an elapsed week, has no total either.
    if (col.aggregate !== 'none' && members.every((m) => m.cells[key] == null)) {
      cells[key] = null;
      continue;
    }
    switch (col.aggregate) {
      case 'sum':
        cells[key] = members.reduce((s, m) => s + displayRound(raw(m, key), col.format ?? 'one'), 0);
        break;
      case 'ahtWeighted': {
        const vol = members.reduce((s, m) => s + raw(m, 'volume'), 0);
        cells[key] = vol === 0 ? null : members.reduce((s, m) => s + raw(m, 'volume') * raw(m, 'aht'), 0) / vol;
        break;
      }
      case 'effectiveShrink': {
        const reqd = members.reduce((s, m) => s + raw(m, 'required'), 0);
        cells[key] = reqd === 0 ? null : 1 - members.reduce((s, m) => s + raw(m, 'productive'), 0) / reqd;
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
