/**
 * Driver and event register: what each registered event does to the plan.
 *
 * An event's contribution to a number is the number with every event, less
 * the number with that one event switched off: the same plan recomputed, so
 * it includes what the event does to hiring and supply, not just demand.
 */
import { eventApplies, type EventType, type PlanEvent, type PlanResult } from '../engine/index.ts';
import { buildRows, unitPredicate, type Filters, type GridRow, type Grouping, type NumericKey } from './model.ts';

export const EVENT_TYPE_LABEL: Readonly<Record<EventType, string>> = {
  campaign: 'Campaign',
  training: 'Training',
  system: 'System change',
  other: 'Other',
};

/** Events in effect for any planning unit of the row, under the filters, in the week. */
export function eventsInRow(
  plan: PlanResult,
  events: readonly PlanEvent[],
  row: GridRow,
  members: readonly GridRow[],
  week: number,
  filters: Filters,
): PlanEvent[] {
  const siteIds = row.kind === 'site' ? [row.siteId] : members.map((m) => m.siteId);
  const include = unitPredicate(filters);
  return events.filter((e) =>
    siteIds.some((id) => {
      const sp = plan.sites.find((s) => s.site.id === id);
      const p = sp?.periods[week - 1];
      return !!sp && !!p && p.units.some((u) => include(u.unit) && eventApplies(e, sp.site, u.unit, week));
    }),
  );
}

/** A row's value with every event, and without one, for one metric in one week. */
export function contribution(
  withEvent: PlanResult,
  withoutEvent: PlanResult,
  rowId: string,
  key: NumericKey,
  opts: { week: number; filters: Filters; grouping: Grouping },
): { with: number; without: number } | null {
  const a = buildRows(withEvent, opts).find((r) => r.id === rowId)?.cells[key];
  const b = buildRows(withoutEvent, opts).find((r) => r.id === rowId)?.cells[key];
  if (a == null || b == null) return null;
  return { with: a, without: b };
}

export interface EventImpact {
  /** Week the event adds most to total Required FTE, and how much. */
  peakWeek: number;
  peakRequired: number;
  /** Starters across the horizon with the event, less without it. */
  starters: number;
}

/** What one event does to the whole plan: its peak on Required FTE, and the hiring it causes. */
export function eventImpact(withEvent: PlanResult, withoutEvent: PlanResult, e: PlanEvent): EventImpact {
  let peakWeek = e.fromWeek;
  let peakRequired = -Infinity;
  for (let w = e.fromWeek; w <= e.toWeek; w++) {
    const total = (p: PlanResult) => p.sites.reduce((s, sp) => s + (sp.periods[w - 1]?.requiredFte ?? 0), 0);
    const d = total(withEvent) - total(withoutEvent);
    if (d > peakRequired) {
      peakRequired = d;
      peakWeek = w;
    }
  }
  return { peakWeek, peakRequired, starters: startersOf(withEvent) - startersOf(withoutEvent) };
}

function startersOf(p: PlanResult): number {
  return p.sites.reduce((s, sp) => s + sp.periods.reduce((a, x) => a + x.flow.hiresToStart, 0) + sp.moved.reduce((a, m) => a + m.starters, 0), 0);
}

/** The plan input without one event: what "switched off" recomputes. */
export function withoutEvent<T extends { events?: readonly PlanEvent[] }>(input: T, code: string): T {
  return { ...input, events: (input.events ?? []).filter((e) => e.code !== code) };
}
