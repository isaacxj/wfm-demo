import { describe, expect, it } from 'vitest';
import { demoDataset } from '../data/dataset.ts';
import { engine } from '../engine/index.ts';
import { formatValue, parseFormatted } from './format.ts';
import { ALL_FILTERS, buildRows, COLUMNS, type Filters, type GridRow, type Grouping, type NumericKey } from './model.ts';

const plan = engine.computePlan(demoDataset().plan);
const shown = (row: GridRow, key: NumericKey) => {
  const col = COLUMNS.find((c) => c.key === key)!;
  return parseFormatted(formatValue(row.cells[key], col.format!).text);
};
const summed = COLUMNS.filter((c) => c.aggregate === 'sum').map((c) => c.key as NumericKey);

function expectReconciles(rows: readonly GridRow[]): void {
  const sites = rows.filter((r) => r.kind === 'site');
  const total = rows.find((r) => r.kind === 'total')!;
  for (const key of summed) {
    const add = (rs: readonly GridRow[]) => Math.round(rs.reduce((s, r) => s + (shown(r, key) ?? 0), 0) * 10) / 10;
    expect(shown(total, key), `total ${key}`).toBe(add(sites));
    let block: GridRow[] = [];
    for (const r of rows) {
      if (r.kind === 'group') block = [];
      else if (r.kind === 'site') block.push(r);
      else if (r.kind === 'subtotal') expect(shown(r, key), `${r.label} ${key}`).toBe(add(block));
    }
  }
}

describe('row model', () => {
  it('orders outsourcer header, sites, subtotal per outsourcer, then the grand total', () => {
    const rows = buildRows(plan, { week: 12, filters: ALL_FILTERS, grouping: 'outsourcer' });
    expect(rows.map((r) => `${r.kind}:${r.label}`)).toEqual([
      'group:Teleperformance',
      'site:Manila-1',
      'site:Manila-2',
      'site:Cairo',
      'subtotal:Subtotal Teleperformance',
      'group:Telus International',
      'site:Kingston',
      'site:Guangzhou',
      'subtotal:Subtotal Telus International',
      'group:Accenture',
      'site:Shenzhen',
      'site:Mexico City',
      'subtotal:Subtotal Accenture',
      'group:In-house',
      'site:Toronto',
      'subtotal:Subtotal In-house',
      'total:Grand total',
    ]);
  });

  it('reconciles displayed digits across site, subtotal and total rows in every week and grouping', () => {
    for (const grouping of ['outsourcer', 'country', 'none'] as Grouping[]) {
      for (let week = 1; week <= 52; week++) {
        expectReconciles(buildRows(plan, { week, filters: ALL_FILTERS, grouping }));
      }
    }
  });

  it('reconciles under filters', () => {
    const cases: Filters[] = [
      { ...ALL_FILTERS, lob: ['Mobile'] },
      { ...ALL_FILTERS, language: ['TL'] },
      { ...ALL_FILTERS, channel: ['chat', 'deferred'] },
      { ...ALL_FILTERS, lob: ['Internet'], language: ['EN', 'FR'], channel: ['voice'] },
    ];
    for (const filters of cases) {
      for (const week of [1, 12, 32, 52]) expectReconciles(buildRows(plan, { week, filters, grouping: 'outsourcer' }));
    }
  });

  it('changing week changes volume and headcount', () => {
    const at = (week: number) => buildRows(plan, { week, filters: ALL_FILTERS, grouping: 'outsourcer' }).at(-1)!;
    expect(at(12).cells.volume).not.toBe(at(13).cells.volume);
    expect(at(12).cells.planned).not.toBe(at(13).cells.planned);
  });

  it('drops sites and groups with no matching planning units', () => {
    const rows = buildRows(plan, { week: 12, filters: { ...ALL_FILTERS, language: ['TL'] }, grouping: 'outsourcer' });
    expect(rows.filter((r) => r.kind === 'site').map((r) => r.siteId)).toEqual(['MNL1', 'MNL2']);
    expect(rows.filter((r) => r.kind === 'group').map((r) => r.label)).toEqual(['Teleperformance']);
  });

  it('flags Manila-1 at its cap', () => {
    const rows = buildRows(plan, { week: 32, filters: ALL_FILTERS, grouping: 'outsourcer' });
    expect(rows.find((r) => r.siteId === 'MNL1')?.atCap).toBe(true);
  });

  it('marks planner inputs on site rows only, opening HC only in week 1', () => {
    const w1 = buildRows(plan, { week: 1, filters: ALL_FILTERS, grouping: 'outsourcer' });
    const w2 = buildRows(plan, { week: 2, filters: ALL_FILTERS, grouping: 'outsourcer' });
    const site = (rows: GridRow[]) => rows.find((r) => r.kind === 'site')!;
    expect([...site(w1).inputs].sort()).toEqual(['aht', 'occ', 'opening', 'shrink', 'volume']);
    expect(site(w2).inputs.has('opening')).toBe(false);
    expect(w1.find((r) => r.kind === 'subtotal')!.inputs.size).toBe(0);
  });
});

describe('formatting', () => {
  it('separates thousands and never abbreviates', () => {
    expect(formatValue(1_234_567, 'int').text).toBe('1,234,567');
    expect(formatValue(1015.07, 'one').text).toBe('1,015.1');
  });

  it('signs Over/Under the industry way: over positive in --pos, under negative in --neg', () => {
    expect(formatValue(12.44, 'signed')).toEqual({ text: '+12.4', tone: 'pos' });
    expect(formatValue(-8.06, 'signed')).toEqual({ text: '−8.1', tone: 'neg' });
  });

  it('renders true zero muted and not applicable as an en dash', () => {
    expect(formatValue(0, 'signed')).toEqual({ text: '0.0', tone: 'muted' });
    expect(formatValue(0, 'int')).toEqual({ text: '0', tone: 'muted' });
    expect(formatValue(null, 'one')).toEqual({ text: '–', tone: 'muted' });
    expect(formatValue(0.02, 'signed')).toEqual({ text: '0.0', tone: undefined });
  });

  it('shows percentages to one decimal from ratios', () => {
    expect(formatValue(0.305, 'pct').text).toBe('30.5');
  });
});
