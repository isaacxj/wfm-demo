/**
 * One site, one week: roll-forward with the recommended class fed back in.
 *
 *   attrition            = opening × period attrition rate
 *   HC before new class  = opening − attrition + committed hires + transfers in − transfers out
 *   deficit              = max(0, rostered required − HC before new class)
 *   hireable deficit     = min(deficit, cap − HC before new class)
 *   hires to start       = ceil(hireable deficit ÷ (1 − training attrition))
 *   class start          = needed week − (training + nesting)
 *   graduates            = hires to start × (1 − training attrition)
 *   closing              = HC before new class + graduates
 *   gap                  = rostered required − closing
 *
 * The class recommended for a week lands in that week and stays in supply, so
 * a deficit is hired for once, not again in every later week it persists.
 * Committed hires are classes already in training when the plan starts. A
 * deficit whose class would have to start before the horizon cannot be hired
 * for and remains as a lead-time shortfall. Demand above a contracted cap
 * remains as a cap shortfall. Both show in the residual gap.
 */
import { assertFraction, assertNonNegative } from './requirement.ts';
import { periodAttritionRate } from './supply.ts';
import { TraceBuilder, group, type Ref, type TraceStep } from './trace.ts';

const EPS = 1e-9;

export interface SiteWeekInput {
  opening: number;
  monthlyAttrition: number;
  periodsPerMonth: number;
  /** Hires from classes already in training, reaching production this week. */
  committedHires: number;
  transfersIn?: number;
  transfersOut?: number;
  cap: number | null;
  rosteredRequired: number;
  /** Index of this week in the horizon. */
  week: number;
  /** First week a new class can start. */
  firstStartWeek: number;
  trainingAttrition: number;
  /** Smallest class worth running. A smaller need rounds up to it, room under any cap permitting. */
  minClassSize?: number;
  trainingWeeks: number;
  nestingWeeks: number;
  codes?: {
    opening?: string;
    monthlyAttrition?: string;
    periodsPerMonth?: string;
    committedHires?: string;
    cap?: string;
    trainingAttrition?: string;
    minClassSize?: string;
    trainingWeeks?: string;
    nestingWeeks?: string;
  };
}

export interface SiteWeekResult {
  opening: number;
  attritionRate: number;
  attrition: number;
  /** Committed hires that land after the cap. */
  committedHires: number;
  /** Graduates of the recommended class that land after the cap. */
  classGraduates: number;
  /** Committed hires plus class graduates: the grid's Hires prod. */
  hiresProductive: number;
  /** Committed hires the cap held back. */
  hiresHeldByCap: number;
  transfersIn: number;
  transfersOut: number;
  beforeClass: number;
  closing: number;
  cap: number | null;
  atCap: boolean;
  rosteredRequired: number;
  deficit: number;
  hireableDeficit: number;
  capShortfall: number;
  /** Deficit a class could not reach in time. */
  leadTimeShortfall: number;
  hiresToStart: number;
  leadWeeks: number;
  /** Week the class starts. May precede the horizon. */
  startPeriod: number;
  /** False when the class would have to start before the first start week. */
  classPossible: boolean;
  /** Rostered required − closing. Positive is a deficit, negative a surplus. */
  gap: number;
  trace: TraceStep[];
}

export function siteWeek(input: SiteWeekInput): SiteWeekResult {
  const codes = input.codes ?? {};
  const cap = input.cap;
  assertNonNegative('opening', input.opening);
  assertNonNegative('committedHires', input.committedHires);
  assertNonNegative('rosteredRequired', input.rosteredRequired);
  assertFraction('trainingAttrition', input.trainingAttrition, true);
  if (cap !== null) assertNonNegative('cap', cap);

  const t = new TraceBuilder();

  // Supply before any new class.
  const opening = t.input('opening', input.week === 1 ? 'Opening HC' : 'Opening HC (prior week closing)', input.opening, 'heads', codes.opening);
  const rate = periodAttritionRate(input.monthlyAttrition, input.periodsPerMonth, {
    monthlyRate: codes.monthlyAttrition,
    periodsPerMonth: codes.periodsPerMonth,
  });
  t.include('attr', rate.trace);
  const rateExpr = (rate.trace.at(-1)?.excel ?? '').slice(1);
  const attrition = t.calc(
    'attrition',
    'Attrition',
    opening.value * rate.rate,
    'heads',
    'opening × period attrition rate',
    `${group(opening.expr)}*${group(rateExpr)}`,
    [opening, t.ref('attr.periodAttrition')],
  );
  const tin = t.input('transfersIn', 'Transfers in', input.transfersIn ?? 0, 'heads');
  const tout = t.input('transfersOut', 'Transfers out', input.transfersOut ?? 0, 'heads');
  const retained = opening.value - attrition.value + tin.value - tout.value;
  const retainedExpr = `${group(opening.expr)}-${group(attrition.expr)}+${tin.expr}-${tout.expr}`;

  const committedPlanned = t.input('committedPlanned', 'Committed hires (pipeline)', input.committedHires, 'heads', codes.committedHires);
  const capRef = cap === null ? null : t.input('cap', 'Contracted HC cap', cap, 'heads', codes.cap);
  const committed = capRef
    ? t.calc(
        'committed',
        'Committed hires landing (after cap)',
        Math.max(0, Math.min(committedPlanned.value, capRef.value - retained)),
        'heads',
        'min(committed, max(0, cap − retained HC))',
        `MAX(0,MIN(${committedPlanned.expr},${capRef.expr}-(${retainedExpr})))`,
        [committedPlanned, capRef, opening, attrition, tin, tout],
      )
    : committedPlanned;
  const before = t.calc(
    'beforeClass',
    'HC before new class',
    retained + committed.value,
    'heads',
    'opening − attrition + transfers in − transfers out + committed hires',
    `${retainedExpr}+${group(committed.expr)}`,
    [opening, attrition, tin, tout, committed],
  );

  // Recommended class.
  const required = t.input('rostered', 'Rostered FTE required', input.rosteredRequired, 'FTE');
  const deficit = t.calc(
    'deficit',
    'Deficit before new class',
    Math.max(0, required.value - before.value),
    'FTE',
    'max(0, rostered required − HC before new class)',
    `MAX(0,${group(required.expr)}-${group(before.expr)})`,
    [required, before],
  );
  let hireable = deficit;
  let capShortfall = 0;
  let headroom: Ref | null = null;
  if (capRef) {
    headroom = t.calc(
      'headroom',
      'Headroom under cap',
      Math.max(0, capRef.value - before.value),
      'heads',
      'max(0, cap − HC before new class)',
      `MAX(0,${capRef.expr}-${group(before.expr)})`,
      [capRef, before],
    );
    hireable = t.calc(
      'hireable',
      'Hireable deficit',
      Math.min(deficit.value, headroom.value),
      'FTE',
      'min(deficit, headroom)',
      `MIN(${group(deficit.expr)},${group(headroom.expr)})`,
      [deficit, headroom],
    );
    capShortfall = t.calc(
      'capShortfall',
      'Cap shortfall',
      deficit.value - hireable.value,
      'FTE',
      'deficit − hireable deficit',
      `${group(deficit.expr)}-${group(hireable.expr)}`,
      [deficit, hireable],
    ).value;
  }

  const trn = t.input('trainingWeeks', 'Training', input.trainingWeeks, 'weeks', codes.trainingWeeks);
  const nst = t.input('nestingWeeks', 'Nesting', input.nestingWeeks, 'weeks', codes.nestingWeeks);
  const lead = t.calc('leadWeeks', 'Lead time', trn.value + nst.value, 'weeks', 'training + nesting', `${trn.expr}+${nst.expr}`, [trn, nst]);
  const needed = t.input('week', 'Needed in week', input.week, 'week');
  const start = t.calc(
    'startPeriod',
    'Class start week',
    needed.value - lead.value,
    'week',
    'needed week − (training + nesting)',
    `${needed.expr}-${group(lead.expr)}`,
    [needed, lead],
  );
  const classPossible = start.value >= input.firstStartWeek;

  const tAttr = t.input('trainingAttrition', 'Training attrition', input.trainingAttrition, 'ratio', codes.trainingAttrition);
  let starters: Ref;
  let leadTimeShortfall = 0;
  if (classPossible) {
    const needed = t.calc(
      'startersNeeded',
      'Starters needed',
      Math.max(0, Math.ceil(hireable.value / (1 - tAttr.value) - EPS)),
      'heads',
      'ceil(hireable deficit ÷ (1 − training attrition))',
      `CEILING(${group(hireable.expr)}/(1-${tAttr.expr}),1)`,
      [hireable, tAttr],
    );
    const minClass = t.input('minClassSize', 'Minimum class size', input.minClassSize ?? 1, 'heads', codes.minClassSize);
    if (headroom) {
      // Round up to the minimum class only as far as graduates still fit under the cap.
      const room = t.calc(
        'classRoom',
        'Starters that fit under cap',
        Math.floor(headroom.value / (1 - tAttr.value) + EPS),
        'heads',
        'floor(headroom ÷ (1 − training attrition))',
        `FLOOR(${group(headroom.expr)}/(1-${tAttr.expr}),1)`,
        [headroom, tAttr],
      );
      starters = t.calc(
        'hiresToStart',
        'Hires to start',
        needed.value > 0 ? Math.max(needed.value, Math.min(minClass.value, room.value)) : 0,
        'heads',
        'max(starters needed, min(minimum class, starters that fit)); none if none needed',
        `IF(${needed.expr}>0,MAX(${needed.expr},MIN(${minClass.expr},${room.expr})),0)`,
        [needed, minClass, room],
      );
    } else {
      starters = t.calc(
        'hiresToStart',
        'Hires to start',
        needed.value > 0 ? Math.max(needed.value, minClass.value) : 0,
        'heads',
        'max(starters needed, minimum class size); none if none needed',
        `IF(${needed.expr}>0,MAX(${needed.expr},${minClass.expr}),0)`,
        [needed, minClass],
      );
    }
  } else {
    starters = t.calc('hiresToStart', 'Hires to start (start week precedes plan)', 0, 'heads', 'no class can land inside the lead time', '0', [start]);
    leadTimeShortfall = t.calc(
      'leadTimeShortfall',
      'Lead-time shortfall',
      hireable.value,
      'FTE',
      'hireable deficit no class can reach in time',
      hireable.expr,
      [hireable, start],
    ).value;
  }

  const graduatesPlanned = starters.value * (1 - tAttr.value);
  const graduates = capRef
    ? t.calc(
        'classGraduates',
        'Class graduates landing (after cap)',
        Math.max(0, Math.min(graduatesPlanned, capRef.value - before.value)),
        'heads',
        'min(hires to start × (1 − training attrition), cap − HC before new class)',
        `MAX(0,MIN(${group(starters.expr)}*(1-${tAttr.expr}),${capRef.expr}-${group(before.expr)}))`,
        [starters, tAttr, capRef, before],
      )
    : t.calc(
        'classGraduates',
        'Class graduates landing',
        graduatesPlanned,
        'heads',
        'hires to start × (1 − training attrition)',
        `${group(starters.expr)}*(1-${tAttr.expr})`,
        [starters, tAttr],
      );

  const hires = t.calc(
    'hiresProductive',
    'Hires productive',
    committed.value + graduates.value,
    'heads',
    'committed hires + class graduates',
    `${group(committed.expr)}+${group(graduates.expr)}`,
    [committed, graduates],
  );
  const closing = t.calc(
    'closing',
    'Closing HC',
    before.value + graduates.value,
    'heads',
    'opening − attrition + hires productive + transfers in − transfers out',
    `${group(before.expr)}+${group(graduates.expr)}`,
    [before, graduates],
  );
  const gap = t.calc(
    'gap',
    'Gap',
    required.value - closing.value,
    'FTE',
    'rostered required − closing',
    `${group(required.expr)}-${group(closing.expr)}`,
    [required, closing],
  );

  return {
    opening: opening.value,
    attritionRate: rate.rate,
    attrition: attrition.value,
    committedHires: committed.value,
    classGraduates: graduates.value,
    hiresProductive: hires.value,
    hiresHeldByCap: committedPlanned.value - committed.value,
    transfersIn: tin.value,
    transfersOut: tout.value,
    beforeClass: before.value,
    closing: closing.value,
    cap,
    atCap: cap !== null && closing.value >= cap - EPS,
    rosteredRequired: required.value,
    deficit: deficit.value,
    hireableDeficit: hireable.value,
    capShortfall,
    leadTimeShortfall,
    hiresToStart: starters.value,
    leadWeeks: lead.value,
    startPeriod: start.value,
    classPossible,
    gap: gap.value,
    trace: t.steps,
  };
}
