/**
 * One site, one week: roll-forward with the recommended class fed back in.
 *
 *   attrition            = opening × period attrition rate
 *   HC before new class  = opening − attrition + committed hires + transfers in − transfers out
 *   deficit              = max(0, required FTE − HC before new class)
 *   hireable deficit     = min(deficit, cap − HC before new class)
 *   hires to start       = ceil(hireable deficit ÷ (1 − training attrition))
 *   class start          = needed week − (training + nesting)
 *   graduates            = hires to start × (1 − training attrition)
 *   closing              = HC before new class + graduates
 *   over/under           = closing − required FTE
 *
 * The class recommended for a week lands in that week and stays in supply, so
 * a deficit is hired for once, not again in every later week it persists.
 * Committed hires are classes already in training when the plan starts. A
 * deficit whose class would have to start before the horizon cannot be hired
 * for and remains as a lead-time shortfall. Demand above a contracted cap
 * remains as a cap shortfall. Both show as a negative over/under.
 *
 * Class constraints limit how many may start in the ideal week. What does not
 * fit is returned as unplaced starters; the plan moves them to an earlier
 * week. Their graduates land early, and until the week they were hired for
 * they are reserved: in supply, but not counted against this week's deficit,
 * so an early class is extra cover rather than a substitute for this week's.
 */
import { assertFraction, assertNonNegative, REQUIRED_FTE_NOTE } from './requirement.ts';
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
  requiredFte: number;
  /** Index of this week in the horizon. */
  week: number;
  /** First week a new class can start. */
  firstStartWeek: number;
  trainingAttrition: number;
  /** Smallest class worth running. A smaller need rounds up to it, room under any cap permitting. */
  minClassSize?: number;
  trainingWeeks: number;
  nestingWeeks: number;
  /** Class constraints on the ideal start week. Unlimited if absent. */
  startLimits?: StartLimits;
  /** Graduates of classes moved earlier, landing this week. */
  earlyGraduates?: number;
  /** Heads in supply hired early for a later week, not counted against this week's deficit. */
  reserved?: number;
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

export interface StartLimits {
  maxClassSize: number;
  maxClassesPerWeek: number;
  /** Starters already moved into the start week from later weeks. */
  taken: number;
  /** The start week is blocked, and why, e.g. "W12 blocked (Holy Week)". */
  blocked?: string;
  codes?: { maxClassSize?: string; maxClassesPerWeek?: string; blocked?: string };
}

export interface SiteWeekResult {
  opening: number;
  attritionRate: number;
  attrition: number;
  /** Committed hires that land after the cap. */
  committedHires: number;
  /** Graduates of the recommended class that land after the cap. */
  classGraduates: number;
  /** Graduates of classes moved earlier that land this week, after the cap. */
  earlyGraduates: number;
  /** Heads in supply reserved for later weeks. */
  reserved: number;
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
  requiredFte: number;
  deficit: number;
  hireableDeficit: number;
  capShortfall: number;
  /** Deficit a class could not reach in time. */
  leadTimeShortfall: number;
  hiresToStart: number;
  /** Starters needed that the ideal start week has no room for. The plan moves them earlier. */
  unplacedStarters: number;
  leadWeeks: number;
  /** Week the class starts. May precede the horizon. */
  startPeriod: number;
  /** False when the class would have to start before the first start week. */
  classPossible: boolean;
  /** Planned FTE (closing) − required FTE. Positive is over, negative is under. */
  overUnder: number;
  trace: TraceStep[];
}

export function siteWeek(input: SiteWeekInput): SiteWeekResult {
  const codes = input.codes ?? {};
  const cap = input.cap;
  assertNonNegative('opening', input.opening);
  assertNonNegative('committedHires', input.committedHires);
  assertNonNegative('requiredFte', input.requiredFte);
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
  const earlyPlanned = input.earlyGraduates ?? 0;
  let early: Ref | null = null;
  if (earlyPlanned > 0) {
    const planned = t.input('earlyPlanned', 'Graduates of classes moved earlier', earlyPlanned, 'heads');
    early = capRef
      ? t.calc(
          'early',
          'Early graduates landing (after cap)',
          Math.max(0, Math.min(planned.value, capRef.value - retained - committed.value)),
          'heads',
          'min(early graduates, max(0, cap − retained HC − committed hires))',
          `MAX(0,MIN(${planned.expr},${capRef.expr}-(${retainedExpr})-${group(committed.expr)}))`,
          [planned, capRef, opening, attrition, tin, tout, committed],
        )
      : planned;
  }
  const before = early
    ? t.calc(
        'beforeClass',
        'HC before new class',
        retained + committed.value + early.value,
        'heads',
        'opening − attrition + transfers in − transfers out + committed hires + early graduates',
        `${retainedExpr}+${group(committed.expr)}+${group(early.expr)}`,
        [opening, attrition, tin, tout, committed, early],
      )
    : t.calc(
        'beforeClass',
        'HC before new class',
        retained + committed.value,
        'heads',
        'opening − attrition + transfers in − transfers out + committed hires',
        `${retainedExpr}+${group(committed.expr)}`,
        [opening, attrition, tin, tout, committed],
      );
  let available = before;
  // Early graduates landing now are hired for a later week too.
  const reservedValue = (input.reserved ?? 0) + (early?.value ?? 0);
  if (reservedValue > EPS) {
    const carried = t.input('reservedCarried', 'Hired early, landed in earlier weeks', input.reserved ?? 0, 'heads');
    const reserved = early
      ? t.calc(
          'reserved',
          'Hired early for later weeks',
          reservedValue,
          'heads',
          'carried + early graduates landing',
          `${carried.expr}+${group(early.expr)}`,
          [carried, early],
        )
      : t.calc('reserved', 'Hired early for later weeks', reservedValue, 'heads', 'carried from earlier weeks, after attrition', carried.expr, [carried]);
    available = t.calc(
      'available',
      'HC available to this week',
      before.value - reserved.value,
      'heads',
      'HC before new class − heads hired early for later weeks',
      `${group(before.expr)}-${reserved.expr}`,
      [before, reserved],
    );
  }

  // Recommended class.
  const required = t.input('required', 'Required FTE', input.requiredFte, 'FTE');
  t.note('required', REQUIRED_FTE_NOTE);
  const deficit = t.calc(
    'deficit',
    'Deficit before new class',
    Math.max(0, required.value - available.value),
    'FTE',
    available === before ? 'max(0, required FTE − HC before new class)' : 'max(0, required FTE − HC available to this week)',
    `MAX(0,${group(required.expr)}-${group(available.expr)})`,
    [required, available],
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
  const limits = input.startLimits;
  if (limits?.blocked) t.note('startPeriod', `${limits.blocked}: no class starts that week.`);

  const tAttr = t.input('trainingAttrition', 'Training attrition', input.trainingAttrition, 'ratio', codes.trainingAttrition);
  let starters: Ref;
  let leadTimeShortfall = 0;
  let unplaced = 0;
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
    // The class wanted before constraints; when the start week cannot take it all, the step is named for what it is.
    const fit = headroom ? Math.floor(headroom.value / (1 - tAttr.value) + EPS) : Infinity;
    const wantedValue = needed.value > 0 ? Math.max(needed.value, Math.min(minClass.value, fit)) : 0;
    const room = !limits ? Infinity : limits.blocked ? 0 : Math.max(0, limits.maxClassSize * limits.maxClassesPerWeek - limits.taken);
    const binds = room < wantedValue;
    const key = binds ? 'startersWanted' : 'hiresToStart';
    const label = binds ? 'Starters wanted' : 'Hires to start';
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
        key,
        label,
        needed.value > 0 ? Math.max(needed.value, Math.min(minClass.value, room.value)) : 0,
        'heads',
        'max(starters needed, min(minimum class, starters that fit)); none if none needed',
        `IF(${needed.expr}>0,MAX(${needed.expr},MIN(${minClass.expr},${room.expr})),0)`,
        [needed, minClass, room],
      );
    } else {
      starters = t.calc(
        key,
        label,
        needed.value > 0 ? Math.max(needed.value, minClass.value) : 0,
        'heads',
        'max(starters needed, minimum class size); none if none needed',
        `IF(${needed.expr}>0,MAX(${needed.expr},${minClass.expr}),0)`,
        [needed, minClass],
      );
    }
    if (binds) {
      const wanted = starters;
      const roomRef = startRoom(t, limits!);
      starters = t.calc(
        'hiresToStart',
        'Hires to start in the start week',
        Math.min(wanted.value, roomRef.value),
        'heads',
        'min(starters wanted, room in the start week)',
        `MIN(${wanted.expr},${roomRef.expr})`,
        [wanted, roomRef],
      );
      unplaced = t.calc(
        'unplacedStarters',
        'Starters moved to an earlier week',
        wanted.value - starters.value,
        'heads',
        'starters wanted − hires to start',
        `${group(wanted.expr)}-${group(starters.expr)}`,
        [wanted, starters],
      ).value;
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

  const hires = early
    ? t.calc(
        'hiresProductive',
        'Hires productive',
        committed.value + early.value + graduates.value,
        'heads',
        'committed hires + early graduates + class graduates',
        `${group(committed.expr)}+${group(early.expr)}+${group(graduates.expr)}`,
        [committed, early, graduates],
      )
    : t.calc(
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
    'Planned FTE (closing HC)',
    before.value + graduates.value,
    'heads',
    'opening − attrition + hires productive + transfers in − transfers out',
    `${group(before.expr)}+${group(graduates.expr)}`,
    [before, graduates],
  );
  const overUnder = t.calc(
    'overUnder',
    'Over/Under',
    closing.value - required.value,
    'FTE',
    'planned FTE − required FTE',
    `${group(closing.expr)}-${group(required.expr)}`,
    [closing, required],
  );

  return {
    opening: opening.value,
    attritionRate: rate.rate,
    attrition: attrition.value,
    committedHires: committed.value,
    classGraduates: graduates.value,
    earlyGraduates: early?.value ?? 0,
    reserved: reservedValue,
    hiresProductive: hires.value,
    hiresHeldByCap: committedPlanned.value - committed.value,
    transfersIn: tin.value,
    transfersOut: tout.value,
    beforeClass: before.value,
    closing: closing.value,
    cap,
    atCap: cap !== null && closing.value >= cap - EPS,
    requiredFte: required.value,
    deficit: deficit.value,
    hireableDeficit: hireable.value,
    capShortfall,
    leadTimeShortfall,
    hiresToStart: starters.value,
    unplacedStarters: unplaced,
    leadWeeks: lead.value,
    startPeriod: start.value,
    classPossible,
    overUnder: overUnder.value,
    trace: t.steps,
  };
}

/** Starters the start week can still take: none if blocked, else classes × class size − starters already there. */
function startRoom(t: TraceBuilder, limits: StartLimits): Ref {
  if (limits.blocked) return t.input('startRoom', `Room in the start week (${limits.blocked})`, 0, 'heads', limits.codes?.blocked);
  const size = t.input('maxClassSize', 'Maximum class size', limits.maxClassSize, 'heads', limits.codes?.maxClassSize);
  const classes = t.input('maxClassesPerWeek', 'Classes a site can start in one week', limits.maxClassesPerWeek, 'count', limits.codes?.maxClassesPerWeek);
  const taken = t.input('startTaken', 'Starters moved into the start week', limits.taken, 'heads');
  return t.calc(
    'startRoom',
    'Room in the start week',
    Math.max(0, size.value * classes.value - taken.value),
    'heads',
    'max(0, classes a week × class size − starters already there)',
    `MAX(0,${size.expr}*${classes.expr}-${taken.expr})`,
    [size, classes, taken],
  );
}
