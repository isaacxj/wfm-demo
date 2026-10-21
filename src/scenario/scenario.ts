/**
 * Scenarios: a locked plan's inputs with a list of overrides applied.
 *
 * A scenario never edits the baseline. applyScenario returns a new PlanInput
 * the engine computes like any other, so the baseline and the scenario are two
 * independent, fully traced plans. Every overridden input carries the
 * override's code in its assumption record, so the inspector shows which
 * override changed it.
 */
import type { DemandCell, PlanInput, SiteInput } from '../engine/index.ts';

export type OverrideKind = 'volume' | 'aht' | 'shrinkage' | 'attrition' | 'cap';

/** Which sites an override touches. */
export type Scope = { type: 'all' } | { type: 'outsourcer'; outsourcer: string } | { type: 'site'; siteId: string };

interface Base {
  /** Stable code, e.g. "SC1.OV2". Appears in assumption records. */
  code: string;
  scope: Scope;
}

/** Weekly volume: add contacts per week across the scope, or change by a percentage. */
export interface VolumeOverride extends Base {
  kind: 'volume';
  mode: 'add' | 'pct';
  value: number;
  fromWeek: number;
  toWeek: number;
}

/** Handle time changed by a percentage. */
export interface AhtOverride extends Base {
  kind: 'aht';
  pct: number;
  fromWeek: number;
  toWeek: number;
}

/** Shrinkage set to a ratio, for the whole horizon. */
export interface ShrinkageOverride extends Base {
  kind: 'shrinkage';
  value: number;
}

/** Monthly attrition set to a ratio, for the whole horizon. */
export interface AttritionOverride extends Base {
  kind: 'attrition';
  value: number;
}

/** Contracted headcount cap set for one site; null removes the cap. */
export interface CapOverride extends Base {
  kind: 'cap';
  scope: { type: 'site'; siteId: string };
  value: number | null;
}

export type Override = VolumeOverride | AhtOverride | ShrinkageOverride | AttritionOverride | CapOverride;

export interface Scenario {
  id: string;
  /** Short code, e.g. "SC1". */
  code: string;
  name: string;
  /** Plan version it was forked from. */
  forkedFrom: string;
  overrides: Override[];
}

export function siteInScope(site: Pick<SiteInput, 'id' | 'outsourcer'>, scope: Scope): boolean {
  switch (scope.type) {
    case 'all':
      return true;
    case 'outsourcer':
      return site.outsourcer === scope.outsourcer;
    case 'site':
      return site.id === scope.siteId;
  }
}

export function applyScenario(base: PlanInput, scenario: Scenario): PlanInput {
  let sites: SiteInput[] = base.sites.map((s) => ({ ...s, codes: { ...s.codes } }));
  const demand: Record<string, DemandCell[]> = Object.fromEntries(
    Object.entries(base.demand).map(([id, cells]) => [id, cells.map((c) => ({ ...c }))]),
  );
  const siteOf = new Map(base.units.map((u) => [u.id, u.siteId]));

  for (const o of scenario.overrides) {
    const inScope = (siteId: string) => {
      const site = sites.find((s) => s.id === siteId);
      return site !== undefined && siteInScope(site, o.scope);
    };
    switch (o.kind) {
      case 'volume':
        applyVolume(demand, base, o, (unitId) => inScope(siteOf.get(unitId) ?? ''));
        break;
      case 'aht':
        for (const [unitId, cells] of Object.entries(demand)) {
          if (!inScope(siteOf.get(unitId) ?? '')) continue;
          forWeeks(base, o.fromWeek, o.toWeek, (w) => {
            const c = cells[w]!;
            c.aht = c.aht * (1 + o.pct);
            c.source = tag(c.source, o.code);
          });
        }
        break;
      case 'shrinkage':
        sites = sites.map((s) => (siteInScope(s, o.scope) ? { ...s, shrinkage: o.value, codes: { ...s.codes, shrinkage: o.code } } : s));
        break;
      case 'attrition':
        sites = sites.map((s) =>
          siteInScope(s, o.scope) ? { ...s, monthlyAttrition: o.value, codes: { ...s.codes, monthlyAttrition: o.code } } : s,
        );
        break;
      case 'cap':
        sites = sites.map((s) => (siteInScope(s, o.scope) ? { ...s, cap: o.value, codes: { ...s.codes, cap: o.code } } : s));
        break;
    }
  }
  return { ...base, sites, demand };
}

/**
 * Adds contacts per week across the units in scope, split by each unit's
 * share of that week's volume. Whole contacts by largest remainder, so the
 * scope receives exactly the stated number.
 */
function applyVolume(
  demand: Record<string, DemandCell[]>,
  base: PlanInput,
  o: VolumeOverride,
  unitInScope: (unitId: string) => boolean,
): void {
  const unitIds = Object.keys(demand).filter(unitInScope);
  forWeeks(base, o.fromWeek, o.toWeek, (w) => {
    if (o.mode === 'pct') {
      for (const id of unitIds) {
        const c = demand[id]![w]!;
        c.volume = Math.max(0, Math.round(c.volume * (1 + o.value)));
        c.source = tag(c.source, o.code);
      }
      return;
    }
    const total = unitIds.reduce((s, id) => s + demand[id]![w]!.volume, 0);
    if (total === 0 || unitIds.length === 0) return;
    const exact = unitIds.map((id) => (o.value * demand[id]![w]!.volume) / total);
    const floors = exact.map((x) => Math.floor(x));
    let left = Math.round(o.value) - floors.reduce((s, x) => s + x, 0);
    const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (const { i } of order) {
      if (left <= 0) break;
      floors[i]! += 1;
      left -= 1;
    }
    unitIds.forEach((id, i) => {
      const c = demand[id]![w]!;
      c.volume = Math.max(0, c.volume + floors[i]!);
      c.source = tag(c.source, o.code);
    });
  });
}

function forWeeks(base: PlanInput, from: number, to: number, fn: (w: number) => void): void {
  for (let w = 0; w < base.weeks.length; w++) {
    const index = base.weeks[w]!.index;
    if (index >= from && index <= to) fn(w);
  }
}

function tag(source: string, code: string): string {
  return `${source} + ${code}`;
}

// Descriptions ----------------------------------------------------------------

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MINUS = '−';

const signedPct = (v: number) => `${v < 0 ? MINUS : '+'}${one.format(Math.abs(v) * 100)}%`;

export const OVERRIDE_LABEL: Readonly<Record<OverrideKind, string>> = {
  volume: 'Volume',
  aht: 'AHT',
  shrinkage: 'Shrinkage',
  attrition: 'Attrition',
  cap: 'HC cap',
};

export function describeScope(scope: Scope, siteName: (id: string) => string): string {
  switch (scope.type) {
    case 'all':
      return 'All sites';
    case 'outsourcer':
      return scope.outsourcer;
    case 'site':
      return siteName(scope.siteId);
  }
}

function weeksText(from: number, to: number, horizon: number): string {
  if (from <= 1 && to >= horizon) return 'all weeks';
  return from === to ? `W${pad(from)}` : `W${pad(from)}–W${pad(to)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Volume +10,000/wk", "AHT +5.0%", "HC cap 900". */
export function describeChange(o: Override): string {
  switch (o.kind) {
    case 'volume':
      return o.mode === 'add' ? `${o.value < 0 ? MINUS : '+'}${int.format(Math.abs(o.value))}/wk` : signedPct(o.value);
    case 'aht':
      return signedPct(o.pct);
    case 'shrinkage':
    case 'attrition':
      return `${one.format(o.value * 100)}%`;
    case 'cap':
      return o.value === null ? 'removed' : int.format(o.value);
  }
}

export function describeWhen(o: Override, horizon: number): string {
  return o.kind === 'volume' || o.kind === 'aht' ? weeksText(o.fromWeek, o.toWeek, horizon) : 'all weeks';
}

// Stored scenarios ----------------------------------------------------------------

/**
 * Reads scenarios kept in browser storage. Entries saved before the outsourcer
 * rename, scoped { type: 'vendor', vendor }, are migrated; anything else that
 * does not parse is dropped silently rather than breaking the app.
 */
export function parseStoredScenarios(raw: string): Scenario[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: Scenario[] = [];
  for (const item of value) {
    const s = item as Partial<Scenario> | null;
    if (!s || typeof s.id !== 'string' || typeof s.code !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.overrides)) continue;
    const overrides = s.overrides.map(migrateOverride).filter((o): o is Override => o !== null);
    if (overrides.length !== s.overrides.length) continue;
    out.push({ id: s.id, code: s.code, name: s.name, forkedFrom: typeof s.forkedFrom === 'string' ? s.forkedFrom : '', overrides });
  }
  return out;
}

const KINDS: readonly OverrideKind[] = ['volume', 'aht', 'shrinkage', 'attrition', 'cap'];

function migrateOverride(raw: unknown): Override | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o.code !== 'string' || !KINDS.includes(o.kind as OverrideKind)) return null;
  const scope = migrateScope(o.scope);
  if (!scope) return null;
  return { ...(o as unknown as Override), scope } as Override;
}

function migrateScope(raw: unknown): Scope | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s.type !== 'string') return null;
  if (s.type === 'all') return { type: 'all' };
  if (s.type === 'site' && typeof s.siteId === 'string') return { type: 'site', siteId: s.siteId };
  if (s.type === 'outsourcer' && typeof s.outsourcer === 'string') return { type: 'outsourcer', outsourcer: s.outsourcer };
  // Saved before the rename.
  if (s.type === 'vendor' && typeof s.vendor === 'string') return { type: 'outsourcer', outsourcer: s.vendor };
  return null;
}
