/**
 * Period requirement: the capacity planning model (brief 3.1, 3.2).
 *
 *   workload hours = volume × AHT ÷ 3600
 *   productive FTE = workload ÷ (work week hours × occupancy ceiling)
 *   required FTE   = productive FTE ÷ (1 − shrinkage)
 *
 * Required FTE includes shrinkage: it is the headcount a planner budgets and
 * hires to. Productive FTE excludes it.
 */
import { TraceBuilder, group, type Ref, type TraceStep } from './trace.ts';

export type Channel = 'voice' | 'chat' | 'deferred';

/** Stated wherever Required FTE appears, so no reader takes it for the pre-shrinkage number. */
export const REQUIRED_FTE_NOTE = 'Required FTE includes shrinkage.';

/** Chat efficiency by concurrency. One session at a time is voice-like. */
export const DEFAULT_CHAT_EFFICIENCY: Readonly<Record<number, number>> = {
  1: 1.0,
  2: 0.85,
  3: 0.75,
  4: 0.65,
};

/** Assumption record codes for each input, where one supplied it. */
export interface RequirementCodes {
  volume?: string;
  aht?: string;
  workWeekHours?: string;
  occupancyCeiling?: string;
  shrinkage?: string;
  concurrency?: string;
  chatEfficiency?: string;
}

export interface RequirementInput {
  volume: number;
  /** Handle time per contact, seconds. */
  aht: number;
  channel: Channel;
  workWeekHours: number;
  occupancyCeiling: number;
  shrinkage: number;
  /** Chat only. Simultaneous sessions per agent. */
  concurrency?: number;
  /** Chat only. Overrides the default efficiency for the concurrency. */
  chatEfficiency?: number;
  codes?: RequirementCodes;
}

export interface RequirementResult {
  effectiveAht: number;
  workloadHours: number;
  /** Occupancy actually applied: the ceiling, or 1.0 for deferred work. */
  occupancyApplied: number;
  productiveFte: number;
  requiredFte: number;
  trace: TraceStep[];
}

export function chatEfficiencyFor(concurrency: number): number {
  const eff = DEFAULT_CHAT_EFFICIENCY[concurrency];
  if (eff === undefined) {
    throw new RangeError(`No default chat efficiency for concurrency ${concurrency}; supply one`);
  }
  return eff;
}

/** Effective AHT for chat: AHT ÷ (concurrency × efficiency). */
export function effectiveChatAht(aht: number, concurrency: number, efficiency = chatEfficiencyFor(concurrency)): number {
  return aht / (concurrency * efficiency);
}

/** Required FTE from productive (on-phone) FTE: productive ÷ (1 − shrinkage). */
export function requiredFromProductive(productiveFte: number, shrinkage: number): number {
  assertFraction('shrinkage', shrinkage, true);
  return productiveFte / (1 - shrinkage);
}

export function periodRequirement(input: RequirementInput): RequirementResult {
  const { channel, codes = {} } = input;
  assertNonNegative('volume', input.volume);
  assertPositive('aht', input.aht);
  assertPositive('workWeekHours', input.workWeekHours);
  assertFraction('occupancyCeiling', input.occupancyCeiling, false);
  assertFraction('shrinkage', input.shrinkage, true);

  const t = new TraceBuilder();
  const volume = t.input('volume', 'Volume', input.volume, 'contacts', codes.volume);
  const aht = t.input('aht', 'AHT', input.aht, 'seconds', codes.aht);

  let handle: Ref = aht;
  if (channel === 'chat') {
    const c = input.concurrency ?? 1;
    if (!Number.isInteger(c) || c < 1) throw new RangeError(`concurrency must be a positive integer, got ${c}`);
    const conc = t.input('concurrency', 'Concurrency', c, 'count', codes.concurrency);
    const eff = t.input(
      'chatEfficiency',
      'Chat efficiency',
      input.chatEfficiency ?? chatEfficiencyFor(c),
      'ratio',
      codes.chatEfficiency,
    );
    handle = t.calc(
      'effectiveAht',
      'Effective AHT',
      aht.value / (conc.value * eff.value),
      'seconds',
      'AHT ÷ (concurrency × efficiency)',
      `${group(aht.expr)}/(${conc.expr}*${eff.expr})`,
      [aht, conc, eff],
    );
  }

  const workload = t.calc(
    'workload',
    'Workload',
    (volume.value * handle.value) / 3600,
    'hours',
    channel === 'chat' ? 'volume × effective AHT ÷ 3600' : 'volume × AHT ÷ 3600',
    `${group(volume.expr)}*${group(handle.expr)}/3600`,
    [volume, handle],
  );

  const week = t.input('workWeekHours', 'Work week', input.workWeekHours, 'hours/week', codes.workWeekHours);
  let occ: Ref;
  if (channel === 'deferred') {
    // Deferred work queues for hours, so no occupancy ceiling applies.
    occ = t.input('occupancy', 'Occupancy (deferred, not applied)', 1.0, 'ratio');
  } else {
    occ = t.input('occupancy', 'Occupancy ceiling', input.occupancyCeiling, 'ratio', codes.occupancyCeiling);
  }

  const productive = t.calc(
    'productive',
    'Productive FTE',
    workload.value / (week.value * occ.value),
    'FTE',
    'workload ÷ (work week × occupancy)',
    `${group(workload.expr)}/(${week.expr}*${occ.expr})`,
    [workload, week, occ],
  );

  const shrink = t.input('shrinkage', 'Shrinkage', input.shrinkage, 'ratio', codes.shrinkage);
  const required = t.calc(
    'required',
    'Required FTE',
    requiredFromProductive(productive.value, shrink.value),
    'FTE',
    'productive ÷ (1 − shrinkage)',
    `${group(productive.expr)}/(1-${shrink.expr})`,
    [productive, shrink],
  );

  t.note('required', REQUIRED_FTE_NOTE);

  return {
    effectiveAht: handle.value,
    workloadHours: workload.value,
    occupancyApplied: occ.value,
    productiveFte: productive.value,
    requiredFte: required.value,
    trace: t.steps,
  };
}

export function assertPositive(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be positive, got ${v}`);
}

export function assertNonNegative(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} must be non-negative, got ${v}`);
}

/** A fraction in (0, 1], or [0, 1) when it is a loss rate. */
export function assertFraction(name: string, v: number, lossRate: boolean): void {
  const ok = lossRate ? v >= 0 && v < 1 : v > 0 && v <= 1;
  if (!Number.isFinite(v) || !ok) throw new RangeError(`${name} out of range: ${v}`);
}
