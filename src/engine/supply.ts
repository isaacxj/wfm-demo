/**
 * Roll-forward and hiring (brief 3.4).
 *
 *   period attrition rate = 1 − (1 − monthly rate)^(1 ÷ periods per month)
 *   attrition             = opening × period rate
 *   closing               = opening − attrition + hires productive + transfers in − transfers out
 *   gap                   = rostered required − closing
 *   hires to start        = ceil(gap ÷ (1 − training attrition))
 *   start period          = needed period − (training weeks + nesting weeks)
 *
 * A contracted headcount cap limits productive hires so closing never exceeds
 * it, and limits the hire need to the headroom under it. Demand above the cap
 * surfaces as a cap shortfall rather than a hire.
 */
import { assertFraction, assertNonNegative } from './requirement.ts';
import { TraceBuilder, group, type TraceStep } from './trace.ts';

/** Weeks per month. Dividing a monthly rate by four compounds wrongly. */
export const WEEKS_PER_MONTH = 4.33;

const EPS = 1e-9;

export interface AttritionRateResult {
  rate: number;
  trace: TraceStep[];
}

export function periodAttritionRate(
  monthlyRate: number,
  periodsPerMonth = WEEKS_PER_MONTH,
  codes: { monthlyRate?: string; periodsPerMonth?: string } = {},
): AttritionRateResult {
  assertFraction('monthlyRate', monthlyRate, true);
  const t = new TraceBuilder();
  const m = t.input('monthlyAttrition', 'Monthly attrition', monthlyRate, 'ratio', codes.monthlyRate);
  const p = t.input('periodsPerMonth', 'Periods per month', periodsPerMonth, 'count', codes.periodsPerMonth);
  const rate = t.calc(
    'periodAttrition',
    'Period attrition rate',
    1 - Math.pow(1 - m.value, 1 / p.value),
    'ratio',
    '1 − (1 − monthly)^(1 ÷ periods per month)',
    `1-(1-${m.expr})^(1/${p.expr})`,
  );
  return { rate: rate.value, trace: t.steps };
}

export interface RollForwardInput {
  opening: number;
  monthlyAttrition: number;
  periodsPerMonth?: number;
  /** Planned hires reaching production this period, before any cap. */
  hiresProductive: number;
  transfersIn?: number;
  transfersOut?: number;
  /** Contracted headcount cap, or null when uncapped. */
  cap?: number | null;
  codes?: {
    opening?: string;
    monthlyAttrition?: string;
    periodsPerMonth?: string;
    hiresProductive?: string;
    transfersIn?: string;
    transfersOut?: string;
    cap?: string;
  };
}

export interface RollForwardResult {
  opening: number;
  attritionRate: number;
  attrition: number;
  /** Hires that reach production after the cap is applied. */
  hiresProductive: number;
  /** Planned hires the cap held back. */
  hiresHeldByCap: number;
  transfersIn: number;
  transfersOut: number;
  closing: number;
  cap: number | null;
  /** Closing headcount sits at the contracted cap. */
  atCap: boolean;
  trace: TraceStep[];
}

export function rollForward(input: RollForwardInput): RollForwardResult {
  const codes = input.codes ?? {};
  const cap = input.cap ?? null;
  assertNonNegative('opening', input.opening);
  assertNonNegative('hiresProductive', input.hiresProductive);
  assertNonNegative('transfersIn', input.transfersIn ?? 0);
  assertNonNegative('transfersOut', input.transfersOut ?? 0);
  if (cap !== null) assertNonNegative('cap', cap);

  const t = new TraceBuilder();
  const opening = t.input('opening', 'Opening HC', input.opening, 'heads', codes.opening);
  const rate = periodAttritionRate(input.monthlyAttrition, input.periodsPerMonth ?? WEEKS_PER_MONTH, {
    monthlyRate: codes.monthlyAttrition,
    periodsPerMonth: codes.periodsPerMonth,
  });
  t.include('attr', rate.trace);
  const rateExpr = stripEquals(rate.trace[rate.trace.length - 1]?.excel);

  const attrition = t.calc(
    'attrition',
    'Attrition',
    opening.value * rate.rate,
    'heads',
    'opening × period attrition rate',
    `${group(opening.expr)}*${group(rateExpr)}`,
  );
  const planned = t.input('hiresPlanned', 'Hires reaching production (planned)', input.hiresProductive, 'heads', codes.hiresProductive);
  const tin = t.input('transfersIn', 'Transfers in', input.transfersIn ?? 0, 'heads', codes.transfersIn);
  const tout = t.input('transfersOut', 'Transfers out', input.transfersOut ?? 0, 'heads', codes.transfersOut);

  const beforeHires = opening.value - attrition.value + tin.value - tout.value;
  const beforeHiresExpr = `${group(opening.expr)}-${group(attrition.expr)}+${tin.expr}-${tout.expr}`;

  let hires = planned;
  if (cap !== null) {
    const capRef = t.input('cap', 'Contracted HC cap', cap, 'heads', codes.cap);
    hires = t.calc(
      'hiresProductive',
      'Hires productive (after cap)',
      Math.max(0, Math.min(planned.value, capRef.value - beforeHires)),
      'heads',
      'min(planned, max(0, cap − (opening − attrition + transfers)))',
      `MAX(0,MIN(${planned.expr},${capRef.expr}-(${beforeHiresExpr})))`,
    );
  }

  const closing = t.calc(
    'closing',
    'Closing HC',
    beforeHires + hires.value,
    'heads',
    'opening − attrition + hires productive + transfers in − transfers out',
    `${group(opening.expr)}-${group(attrition.expr)}+${group(hires.expr)}+${tin.expr}-${tout.expr}`,
  );

  return {
    opening: opening.value,
    attritionRate: rate.rate,
    attrition: attrition.value,
    hiresProductive: hires.value,
    hiresHeldByCap: planned.value - hires.value,
    transfersIn: tin.value,
    transfersOut: tout.value,
    closing: closing.value,
    cap,
    atCap: cap !== null && closing.value >= cap - EPS,
    trace: t.steps,
  };
}

export interface HiringInput {
  rosteredRequired: number;
  closing: number;
  /** Index of the period the heads are needed in. */
  neededPeriod: number;
  trainingAttrition: number;
  trainingWeeks: number;
  nestingWeeks: number;
  cap?: number | null;
  codes?: {
    rosteredRequired?: string;
    closing?: string;
    trainingAttrition?: string;
    trainingWeeks?: string;
    nestingWeeks?: string;
    cap?: string;
  };
}

export interface HiringResult {
  /** Positive is a deficit, negative a surplus. */
  gap: number;
  /** Part of the deficit the site can absorb under its cap. */
  hireableGap: number;
  /** Deficit above the contracted cap; no hire can close it at this site. */
  capShortfall: number;
  hiresToStart: number;
  leadWeeks: number;
  /** Period index the class must start in. May precede the horizon. */
  startPeriod: number;
  trace: TraceStep[];
}

export function hiringNeed(input: HiringInput): HiringResult {
  const codes = input.codes ?? {};
  const cap = input.cap ?? null;
  assertFraction('trainingAttrition', input.trainingAttrition, true);
  assertNonNegative('trainingWeeks', input.trainingWeeks);
  assertNonNegative('nestingWeeks', input.nestingWeeks);

  const t = new TraceBuilder();
  const req = t.input('rostered', 'Rostered FTE required', input.rosteredRequired, 'FTE', codes.rosteredRequired);
  const closing = t.input('closing', 'Closing HC', input.closing, 'heads', codes.closing);
  const gap = t.calc(
    'gap',
    'Gap',
    req.value - closing.value,
    'FTE',
    'rostered required − closing',
    `${group(req.expr)}-${group(closing.expr)}`,
  );

  let hireable = t.calc('deficit', 'Deficit', Math.max(0, gap.value), 'FTE', 'max(0, gap)', `MAX(0,${group(gap.expr)})`);
  let shortfall = 0;
  if (cap !== null) {
    const capRef = t.input('cap', 'Contracted HC cap', cap, 'heads', codes.cap);
    const headroomValue = Math.max(0, capRef.value - closing.value);
    const headroom = t.calc(
      'headroom',
      'Headroom under cap',
      headroomValue,
      'heads',
      'max(0, cap − closing)',
      `MAX(0,${capRef.expr}-${group(closing.expr)})`,
    );
    const deficit = hireable;
    hireable = t.calc(
      'hireable',
      'Hireable deficit',
      Math.min(deficit.value, headroom.value),
      'FTE',
      'min(deficit, headroom)',
      `MIN(${deficit.expr},${headroom.expr})`,
    );
    shortfall = t.calc(
      'capShortfall',
      'Cap shortfall',
      deficit.value - hireable.value,
      'FTE',
      'deficit − hireable deficit',
      `${group(deficit.expr)}-${group(hireable.expr)}`,
    ).value;
  }

  const tAttr = t.input('trainingAttrition', 'Training attrition', input.trainingAttrition, 'ratio', codes.trainingAttrition);
  // Guard against ceil(70.000000001) from floating point noise.
  const startersValue = Math.ceil(hireable.value / (1 - tAttr.value) - EPS);
  const starters = t.calc(
    'hiresToStart',
    'Hires to start',
    Math.max(0, startersValue),
    'heads',
    'ceil(gap ÷ (1 − training attrition))',
    `CEILING(${group(hireable.expr)}/(1-${tAttr.expr}),1)`,
  );

  const trn = t.input('trainingWeeks', 'Training', input.trainingWeeks, 'weeks', codes.trainingWeeks);
  const nst = t.input('nestingWeeks', 'Nesting', input.nestingWeeks, 'weeks', codes.nestingWeeks);
  const lead = t.calc('leadWeeks', 'Lead time', trn.value + nst.value, 'weeks', 'training + nesting', `${trn.expr}+${nst.expr}`);
  const needed = t.input('neededPeriod', 'Needed in week', input.neededPeriod, 'week');
  const start = t.calc(
    'startPeriod',
    'Class start week',
    needed.value - lead.value,
    'week',
    'needed week − (training + nesting)',
    `${needed.expr}-${group(lead.expr)}`,
  );

  return {
    gap: gap.value,
    hireableGap: hireable.value,
    capShortfall: shortfall,
    hiresToStart: starters.value,
    leadWeeks: lead.value,
    startPeriod: start.value,
    trace: t.steps,
  };
}

function stripEquals(excel: string | undefined): string {
  if (!excel) throw new Error('Missing Excel expression');
  return excel.startsWith('=') ? excel.slice(1) : excel;
}
