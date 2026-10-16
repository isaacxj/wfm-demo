/**
 * A filtered slice of one site-week: the planning units matching a line of
 * business, language or channel filter.
 *
 * Demand sums over the matching units. Supply exists per site, not per unit,
 * so it is allocated to the slice by its share of the site's rostered FTE:
 *
 *   share           = slice rostered FTE ÷ site rostered FTE
 *   allocated value = site value × share
 *
 * With every unit included the slice is the site row and nothing is allocated.
 */
import { rollUpDemand, type PlanningUnit, type SitePeriod } from './plan.ts';
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
  requiredFte: number;
  rosteredFte: number;
  opening: number;
  attrition: number;
  hiresProductive: number;
  closing: number;
  gap: number;
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
      requiredFte: p.requiredFte,
      rosteredFte: p.rosteredFte,
      opening: f.opening,
      attrition: f.attrition,
      hiresProductive: f.hiresProductive,
      closing: f.closing,
      gap: f.gap,
      hiresToStart: f.hiresToStart,
      capShortfall: f.capShortfall,
      leadTimeShortfall: f.leadTimeShortfall,
      trace: p.trace,
    };
  }

  const t = new TraceBuilder();
  const d = rollUpDemand(t, units);
  const siteRostered = t.input('siteRostered', 'Site rostered FTE (all units)', p.rosteredFte, 'FTE');
  t.attach('siteRostered', [{ id: p.siteId, label: `Site ${p.weekLabel}`, steps: p.trace, focus: 'rostered' }]);
  const share = t.calc(
    'share',
    'Share of site requirement',
    siteRostered.value === 0 ? 0 : d.rostered.value / siteRostered.value,
    'ratio',
    'slice rostered FTE ÷ site rostered FTE',
    siteRostered.value === 0 ? '0' : `${group(d.rostered.expr)}/${siteRostered.expr}`,
    [d.rostered, siteRostered],
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
  const closingRef = alloc('closing', 'Closing HC', f.closing, 'heads');
  const closing = closingRef.value;
  const gap = t.calc(
    'gap',
    'Gap',
    d.rostered.value - closing,
    'FTE',
    'slice rostered FTE − allocated closing',
    `${group(d.rostered.expr)}-${group(closingRef.expr)}`,
    [d.rostered, closingRef],
  ).value;
  const starters = alloc('hiresToStart', 'Hires to start', f.hiresToStart, 'heads').value;

  return {
    ...base,
    allocated: true,
    share: share.value,
    volume: d.volume.value,
    aht: d.aht.value,
    workloadHours: d.workload.value,
    requiredFte: d.required.value,
    rosteredFte: d.rostered.value,
    opening,
    attrition,
    hiresProductive: hires,
    closing,
    gap,
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
