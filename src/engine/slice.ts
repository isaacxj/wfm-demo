/**
 * A filtered slice of one site-week: the planning units matching a business
 * unit, language or channel filter.
 *
 * Demand sums over the matching units. Supply exists per site, not per unit,
 * so it is allocated to the slice by its share of the site's required FTE:
 *
 *   share           = slice required FTE ÷ site required FTE
 *   allocated value = site value × share
 *
 * With every unit included the slice is the site row and nothing is allocated.
 */
import { rollUpDemand, type PlanningUnit, type SitePeriod } from './plan.ts';
import { REQUIRED_FTE_NOTE } from './requirement.ts';
import { TraceBuilder, group, type TraceStep } from './trace.ts';

export interface SiteSlice {
  siteId: string;
  week: number;
  allocated: boolean;
  share: number;
  unitCount: number;
  volume: number;
  aht: number;
  workloadHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  productiveFte: number;
  requiredFte: number;
  opening: number;
  attrition: number;
  hiresProductive: number;
  closing: number;
  /** Planned FTE − required FTE. Positive is over, negative is under. */
  overUnder: number;
  hiresToStart: number;
  classStartLabel: string | null;
  atCap: boolean;
  capShortfall: number;
  leadTimeShortfall: number;
  trace: TraceStep[];
  /** The whole site-week's trace, for metrics a slice does not allocate. */
  siteTrace: TraceStep[];
}

export function sliceSitePeriod(p: SitePeriod, include: (u: PlanningUnit) => boolean): SiteSlice | null {
  const units = p.units.filter((u) => include(u.unit));
  if (units.length === 0) return null;
  const f = p.flow;
  const base = {
    siteId: p.siteId,
    week: p.week,
    unitCount: units.length,
    occupancyCeiling: p.occupancyCeiling,
    shrinkage: p.shrinkage,
    classStartLabel: p.classStartLabel,
    atCap: f.atCap,
    siteTrace: p.trace,
  };

  if (units.length === p.units.length) {
    return {
      ...base,
      allocated: false,
      share: 1,
      volume: p.volume,
      aht: p.aht,
      workloadHours: p.workloadHours,
      productiveFte: p.productiveFte,
      requiredFte: p.requiredFte,
      opening: f.opening,
      attrition: f.attrition,
      hiresProductive: f.hiresProductive,
      closing: f.closing,
      overUnder: f.overUnder,
      hiresToStart: f.hiresToStart,
      capShortfall: f.capShortfall,
      leadTimeShortfall: f.leadTimeShortfall,
      trace: p.trace,
    };
  }

  const t = new TraceBuilder();
  const d = rollUpDemand(t, units);
  const siteRequired = t.input('siteRequired', 'Site required FTE (all units)', p.requiredFte, 'FTE');
  t.note('siteRequired', REQUIRED_FTE_NOTE);
  t.attach('siteRequired', [{ id: p.siteId, label: `Site ${p.weekLabel}`, steps: p.trace, focus: 'required' }]);
  const share = t.calc(
    'share',
    'Share of site requirement',
    siteRequired.value === 0 ? 0 : d.required.value / siteRequired.value,
    'ratio',
    'slice required FTE ÷ site required FTE',
    siteRequired.value === 0 ? '0' : `${group(d.required.expr)}/${siteRequired.expr}`,
    [d.required, siteRequired],
  );
  const alloc = (key: string, label: string, siteValue: number, unit: 'heads' | 'FTE') => {
    const lower = lowerFirst(label);
    const site = t.input(`site.${key}`, `Site ${lower}`, siteValue, unit);
    t.attach(`site.${key}`, [{ id: p.siteId, label: `Site ${p.weekLabel}`, steps: p.trace, focus: `flow.${key}` }]);
    return t.calc(key, `${label} (allocated)`, siteValue * share.value, unit, `site ${lower} × share`, `${group(site.expr)}*${group(share.expr)}`, [site, share]);
  };
  const opening = alloc('opening', 'Opening HC', f.opening, 'heads').value;
  const attrition = alloc('attrition', 'Attrition', f.attrition, 'heads').value;
  const hires = alloc('hiresProductive', 'Hires productive', f.hiresProductive, 'heads').value;
  const closingRef = alloc('closing', 'Planned FTE', f.closing, 'heads');
  const closing = closingRef.value;
  const overUnder = t.calc(
    'overUnder',
    'Over/Under',
    closing - d.required.value,
    'FTE',
    'allocated planned FTE − slice required FTE',
    `${group(closingRef.expr)}-${group(d.required.expr)}`,
    [closingRef, d.required],
  ).value;
  const starters = alloc('hiresToStart', 'Hires to start', f.hiresToStart, 'heads').value;

  return {
    ...base,
    allocated: true,
    share: share.value,
    volume: d.volume.value,
    aht: d.aht.value,
    workloadHours: d.workload.value,
    productiveFte: d.productive.value,
    requiredFte: d.required.value,
    opening,
    attrition,
    hiresProductive: hires,
    closing,
    overUnder,
    hiresToStart: starters,
    capShortfall: f.capShortfall * share.value,
    leadTimeShortfall: f.leadTimeShortfall * share.value,
    trace: t.steps,
  };
}

/** "Closing HC" → "closing HC": lower-case the first word only, keeping acronyms. */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}
