/**
 * Budget variance: the budget against the plan and the actuals, by month.
 *
 * Budget, plan and actuals are all in FTE a week, so a month's figure is the
 * average of its weeks, and the year's the average of all 52. Actuals cover
 * the elapsed weeks only, so a month part-way elapsed averages those weeks,
 * and its variance compares like weeks with like.
 *
 *   plan variance   = planned FTE − budget FTE
 *   actual variance = actual headcount − budget FTE, over elapsed weeks
 *
 * Positive is over budget. Subtotals add the site values as displayed.
 */
import type { ActualResult, PlanResult, PlanWeek, SiteInput } from '../engine/index.ts';
import type { Budget } from '../data/budget.ts';
import { displayRound } from './format.ts';
import { monthOf } from './periods.ts';

export interface BudgetMonth {
  key: string;
  label: string;
  /** Week indices in the horizon, 0-based. */
  weeks: number[];
  /** How many of its weeks have elapsed. */
  elapsed: number;
}

export function budgetMonths(weeks: readonly PlanWeek[], throughWeek: number): BudgetMonth[] {
  const out: BudgetMonth[] = [];
  weeks.forEach((w, i) => {
    const m = monthOf(w);
    let month = out.at(-1);
    if (!month || month.key !== m.key) {
      month = { key: m.key, label: m.label, weeks: [], elapsed: 0 };
      out.push(month);
    }
    month.weeks.push(i);
    if (w.index <= throughWeek) month.elapsed++;
  });
  return out;
}

/** Edits keyed "site:2027-04" (a month) or "site:W14" (one week), in FTE. */
export type BudgetEdits = Readonly<Record<string, number>>;

export function applyBudgetEdits(budget: Budget, edits: BudgetEdits, weeks: readonly PlanWeek[]): Budget {
  const keys = weeks.map((w) => monthOf(w).key);
  const bySite: Record<string, number[]> = {};
  for (const [siteId, values] of Object.entries(budget.bySite)) {
    bySite[siteId] = values.map((v, i) => edits[`${siteId}:W${pad(weeks[i]!.index)}`] ?? edits[`${siteId}:${keys[i]}`] ?? v);
  }
  return { ...budget, bySite };
}

export type BudgetLine = 'budget' | 'required' | 'planned' | 'actual' | 'plannedVar' | 'actualVar';

export const BUDGET_LINES: readonly { key: BudgetLine; label: string }[] = [
  { key: 'budget', label: 'Budget' },
  { key: 'required', label: 'Required FTE' },
  { key: 'planned', label: 'Planned FTE' },
  { key: 'actual', label: 'Actual HC' },
  { key: 'plannedVar', label: 'Planned − budget' },
  { key: 'actualVar', label: 'Actual − budget' },
];

export interface BudgetRow {
  id: string;
  kind: 'group' | 'site' | 'subtotal' | 'total';
  label: string;
  code?: string;
  siteIds: string[];
  /** Per line, one value per month and then the full year. Null where there is nothing to show. */
  lines: Record<BudgetLine, (number | null)[]>;
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

function siteLines(siteId: string, plan: PlanResult, actuals: ActualResult | null, budget: Budget, months: readonly BudgetMonth[]) {
  const sp = plan.sites.find((s) => s.site.id === siteId)!;
  const bud = budget.bySite[siteId] ?? [];
  const act = actuals?.sites.find((a) => a.siteId === siteId)?.periods ?? [];
  const spans = [...months.map((m) => m.weeks), months.flatMap((m) => m.weeks)];
  const elapsedOf = (idx: number[]) => idx.filter((i) => i < act.length);
  const lines = {} as Record<BudgetLine, (number | null)[]>;
  lines.budget = spans.map((idx) => mean(idx.map((i) => bud[i] ?? 0)));
  lines.required = spans.map((idx) => mean(idx.map((i) => sp.periods[i]!.requiredFte)));
  lines.planned = spans.map((idx) => mean(idx.map((i) => sp.periods[i]!.flow.closing)));
  lines.actual = spans.map((idx) => mean(elapsedOf(idx).map((i) => act[i]!.headcount)));
  lines.plannedVar = spans.map((_, j) => (lines.planned[j]! === null ? null : lines.planned[j]! - lines.budget[j]!));
  lines.actualVar = spans.map((idx) => mean(elapsedOf(idx).map((i) => act[i]!.headcount - (bud[i] ?? 0))));
  return lines;
}

export function buildBudgetRows(
  plan: PlanResult,
  actuals: ActualResult | null,
  budget: Budget,
  months: readonly BudgetMonth[],
  grouping: 'outsourcer' | 'none',
): BudgetRow[] {
  const sites: BudgetRow[] = plan.sites.map((sp) => ({
    id: `site:${sp.site.id}`,
    kind: 'site',
    label: sp.site.name,
    code: sp.site.id,
    siteIds: [sp.site.id],
    lines: siteLines(sp.site.id, plan, actuals, budget, months),
  }));
  const rows: BudgetRow[] = [];
  if (grouping === 'none') rows.push(...sites);
  else {
    const outsourcerOf = (r: BudgetRow) => plan.sites.find((s) => s.site.id === r.code)!.site.outsourcer;
    for (const o of [...new Set(sites.map(outsourcerOf))]) {
      const members = sites.filter((r) => outsourcerOf(r) === o);
      rows.push({ id: `group:${o}`, kind: 'group', label: o, siteIds: [], lines: emptyLines(months.length + 1) });
      rows.push(...members, sumRows(`subtotal:${o}`, 'subtotal', `Subtotal ${o}`, members));
    }
  }
  rows.push(sumRows('total', 'total', 'Grand total', sites));
  return rows;
}

function emptyLines(n: number): Record<BudgetLine, (number | null)[]> {
  const none = () => Array.from({ length: n }, () => null);
  return { budget: none(), required: none(), planned: none(), actual: none(), plannedVar: none(), actualVar: none() };
}

/** Adds the site values as displayed, one decimal, so the digits reconcile on screen. */
function sumRows(id: string, kind: 'subtotal' | 'total', label: string, members: readonly BudgetRow[]): BudgetRow {
  const lines = emptyLines(members[0]?.lines.budget.length ?? 0);
  for (const { key } of BUDGET_LINES) {
    lines[key] = lines[key].map((_, j) => {
      const vals = members.map((m) => m.lines[key][j]).filter((v): v is number => v !== null);
      return vals.length === 0 ? null : displayRound(vals.reduce((s, v) => s + displayRound(v, 'one'), 0), 'one');
    });
  }
  return { id, kind, label, siteIds: members.flatMap((m) => m.siteIds), lines };
}

// CSV -----------------------------------------------------------------------------

/** The budget by site and month, as finance would send it. */
export function budgetCsv(budget: Budget, sites: readonly SiteInput[], months: readonly BudgetMonth[]): string {
  const lines = ['site,month,budget_fte'];
  for (const s of sites) {
    const values = budget.bySite[s.id] ?? [];
    for (const m of months) lines.push(`${s.id},${m.key},${values[m.weeks[0]!] ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}

export interface BudgetImport {
  edits: Record<string, number>;
  rows: number;
  errors: string[];
}

/**
 * Reads budget lines: site (id or name), period (2027-04, Apr 2027 or
 * 2027-W14) and FTE, comma or tab separated, with or without a header.
 */
export function parseBudgetCsv(text: string, sites: readonly SiteInput[], weeks: readonly PlanWeek[]): BudgetImport {
  const months = new Map(weeks.map((w) => [monthOf(w).key, monthOf(w).label]));
  const byLabel = new Map([...months].map(([k, label]) => [label.toLowerCase(), k]));
  const edits: Record<string, number> = {};
  const errors: string[] = [];
  let rows = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    const [siteText = '', periodText = '', fteText = ''] = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    if (i === 0 && !/\d/.test(fteText)) return; // header
    const site = sites.find((s) => s.id.toLowerCase() === siteText.toLowerCase() || s.name.toLowerCase() === siteText.toLowerCase());
    const fte = Number(fteText.replace(/,/g, ''));
    let period: string | null = null;
    const wk = /^(\d{4})-?W(\d{1,2})$/i.exec(periodText);
    if (wk && weeks.some((w) => w.label === `${wk[1]}-W${pad(Number(wk[2]))}`)) period = `W${pad(Number(wk[2]))}`;
    else if (months.has(periodText)) period = periodText;
    else if (byLabel.has(periodText.toLowerCase())) period = byLabel.get(periodText.toLowerCase())!;
    const where = `Line ${i + 1}`;
    if (!site) errors.push(`${where}: no site "${siteText}".`);
    else if (!period) errors.push(`${where}: "${periodText}" is not a month or week of the plan.`);
    else if (!Number.isFinite(fte) || fte < 0) errors.push(`${where}: "${fteText}" is not an FTE figure.`);
    else {
      edits[`${site.id}:${period}`] = fte;
      rows++;
    }
  });
  return { edits, rows, errors };
}

const pad = (n: number) => String(n).padStart(2, '0');
