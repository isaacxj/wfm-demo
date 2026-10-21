/**
 * Prints dataset totals: annual roll-up by outsourcer and site, and the week 12
 * snapshot in grid column order. Run with `npm run totals`.
 */
import { demoDataset } from '../src/data/dataset.ts';
import { fnv1a } from '../src/data/rng.ts';
import { engine, type SitePlan } from '../src/engine/index.ts';

const SNAPSHOT_WEEK = 12;

const ds = demoDataset();
const plan = engine.computePlan(ds.plan);
const fingerprint = fnv1a(JSON.stringify(ds.plan)).toString(16).padStart(8, '0');

const int = (v: number) => Math.round(v).toLocaleString('en-US');
const one = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => (Math.abs(v) < 0.05 ? '0.0' : `${v > 0 ? '+' : '−'}${one(Math.abs(v))}`);

function table(head: readonly string[], rows: readonly (readonly string[])[], leftCols = 1): void {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const fmt = (r: readonly string[]) =>
    r.map((c, i) => (i < leftCols ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join('  ');
  console.log(fmt(head));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(r[0] === '' ? '' : fmt(r));
}

console.log('WFM Capacity Planner, demo dataset');
console.log(
  `Seed ${ds.seed} · ${plan.weeks.length} weeks ${plan.weeks[0]?.label} to ${plan.weeks.at(-1)?.label} · ` +
    `${ds.plan.sites.length} sites · ${ds.outsourcers.length} outsourcers · ${ds.units.length} planning units · fingerprint ${fingerprint}`,
);
console.log();

// Annual roll-up ------------------------------------------------------------

interface Annual {
  volume: number;
  workload: number;
  avgRequired: number;
  peakRequired: number;
  peakWeek: string;
  openingHc: number;
  closingHc: number;
  attrition: number;
  hires: number;
  weeksAtCap: number;
  weeksOverCap: number;
  hireNeed: number;
}

function annual(sp: SitePlan): Annual {
  const p = sp.periods;
  const peak = p.reduce((a, b) => (b.requiredFte > a.requiredFte ? b : a));
  return {
    volume: sum(p.map((x) => x.volume)),
    workload: sum(p.map((x) => x.workloadHours)),
    avgRequired: sum(p.map((x) => x.requiredFte)) / p.length,
    peakRequired: peak.requiredFte,
    peakWeek: peak.weekLabel,
    openingHc: p[0]?.flow.opening ?? 0,
    closingHc: p.at(-1)?.flow.closing ?? 0,
    attrition: sum(p.map((x) => x.flow.attrition)),
    hires: sum(p.map((x) => x.flow.hiresProductive)),
    weeksAtCap: p.filter((x) => x.flow.atCap).length,
    weeksOverCap: p.filter((x) => x.flow.capShortfall > 0).length,
    hireNeed: sum(p.map((x) => x.flow.hiresToStart)),
  };
}

function addAnnual(list: readonly Annual[]): Annual {
  return {
    volume: sum(list.map((a) => a.volume)),
    workload: sum(list.map((a) => a.workload)),
    avgRequired: sum(list.map((a) => a.avgRequired)),
    peakRequired: NaN,
    peakWeek: '',
    openingHc: sum(list.map((a) => a.openingHc)),
    closingHc: sum(list.map((a) => a.closingHc)),
    attrition: sum(list.map((a) => a.attrition)),
    hires: sum(list.map((a) => a.hires)),
    weeksAtCap: NaN,
    weeksOverCap: NaN,
    hireNeed: sum(list.map((a) => a.hireNeed)),
  };
}

const annualRow = (label: string, a: Annual): string[] => [
  label,
  int(a.volume),
  int(a.workload),
  one(a.avgRequired),
  Number.isNaN(a.peakRequired) ? '–' : `${one(a.peakRequired)} ${a.peakWeek.slice(5)}`,
  int(a.openingHc),
  int(a.closingHc),
  one(a.attrition),
  int(a.hires),
  int(a.hireNeed),
  Number.isNaN(a.weeksAtCap) ? '–' : `${a.weeksAtCap}`,
  Number.isNaN(a.weeksOverCap) ? '–' : `${a.weeksOverCap}`,
];

console.log('ANNUAL 2027');
const annualRows: string[][] = [];
const outsourcerTotals: Annual[] = [];
for (const outsourcer of ds.outsourcers) {
  const sites = plan.sites.filter((s) => s.site.outsourcer === outsourcer);
  annualRows.push([outsourcer.toUpperCase(), ...Array<string>(11).fill('')]);
  const list = sites.map((s) => {
    const a = annual(s);
    annualRows.push(annualRow(`  ${s.site.name}${s.site.cap !== null ? ` (cap ${s.site.cap})` : ''}`, a));
    return a;
  });
  const t = addAnnual(list);
  outsourcerTotals.push(t);
  annualRows.push(annualRow(`  Subtotal ${outsourcer}`, t));
}
annualRows.push(annualRow('GRAND TOTAL', addAnnual(outsourcerTotals)));
table(
  ['Site', 'Volume', 'Workload hrs', 'Avg req.', 'Peak req. (wk)', 'HC W01', 'HC W52', 'Attrition', 'Hires prod.', 'Hire need Σ', 'Wks at cap', 'Wks over cap'],
  annualRows,
);
console.log();

// Week snapshot, grid column order -------------------------------------------

const wk = plan.weeks[SNAPSHOT_WEEK - 1];
console.log(`WEEK ${wk?.label} (starting ${wk?.start})`);
const snapRows: string[][] = [];
const snapTotal = (label: string, list: readonly SitePlan[]): string[] => {
  const ps = list.map((s) => s.periods[SNAPSHOT_WEEK - 1]!);
  const vol = sum(ps.map((p) => p.volume));
  const handled = sum(ps.map((p) => p.volume * p.aht));
  return [
    label,
    int(vol),
    int(vol === 0 ? 0 : handled / vol),
    one(sum(ps.map((p) => p.workloadHours))),
    '–',
    '–',
    one(sum(ps.map((p) => p.productiveFte))),
    one(sum(ps.map((p) => p.requiredFte))),
    int(sum(ps.map((p) => p.flow.opening))),
    one(sum(ps.map((p) => p.flow.attrition))),
    int(sum(ps.map((p) => p.flow.hiresProductive))),
    int(sum(ps.map((p) => p.flow.closing))),
    signed(sum(ps.map((p) => p.flow.overUnder))),
    int(sum(ps.map((p) => p.flow.hiresToStart))),
    '–',
  ];
};
for (const outsourcer of ds.outsourcers) {
  const sites = plan.sites.filter((s) => s.site.outsourcer === outsourcer);
  snapRows.push([outsourcer.toUpperCase(), ...Array<string>(14).fill('')]);
  for (const s of sites) {
    const p = s.periods[SNAPSHOT_WEEK - 1]!;
    snapRows.push([
      `  ${s.site.name}${p.flow.atCap ? ' CAP' : ''}`,
      int(p.volume),
      int(p.aht),
      one(p.workloadHours),
      pct(p.occupancyCeiling),
      pct(p.shrinkage),
      one(p.productiveFte),
      one(p.requiredFte),
      int(p.flow.opening),
      one(p.flow.attrition),
      int(p.flow.hiresProductive),
      int(p.flow.closing),
      signed(p.flow.overUnder),
      int(p.flow.hiresToStart),
      p.classStartLabel ?? '–',
    ]);
  }
  snapRows.push(snapTotal(`  Subtotal ${outsourcer}`, sites));
}
snapRows.push(snapTotal('GRAND TOTAL', plan.sites));
table(
  ['Site', 'Volume', 'AHT s', 'Workload hrs', 'Occ %', 'Shrink %', 'Productive', 'Required', 'Opening HC', 'Attrition', 'Hires prod.', 'Planned FTE', 'Over/Under', 'Hire need', 'Class start'],
  snapRows,
);
console.log();

// Manila-1 cap ----------------------------------------------------------------

const mnl1 = plan.sites.find((s) => s.site.id === 'MNL1');
if (mnl1) {
  const over = mnl1.periods.filter((p) => p.flow.capShortfall > 0);
  const worst = over.reduce((a, b) => (b.flow.capShortfall > a.flow.capShortfall ? b : a), over[0]!);
  console.log(
    `Manila-1 cap ${mnl1.site.cap}: requirement exceeds cap in ${over.length} weeks ` +
      `(${over.map((p) => p.weekLabel.slice(5)).join(' ')}); ` +
      (worst ? `worst ${worst.weekLabel}, required ${one(worst.requiredFte)}, shortfall ${one(worst.flow.capShortfall)}` : ''),
  );
}

function sum(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
