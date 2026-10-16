/**
 * Interval staffing with Erlang C (brief 3.3).
 *
 *   B(0,A) = 1
 *   B(n,A) = A·B(n−1,A) / (n + A·B(n−1,A))
 *   C(N,A) = B(N,A) / (1 − (A/N)(1 − B(N,A)))
 *   SL(T)  = 1 − C(N,A) · e^(−(N−A)·T/AHT)
 *   ASA    = C(N,A) · AHT / (N − A)
 *   occ    = A / N
 *
 * The answer is always max(Erlang requirement, ceil(A ÷ occupancy ceiling)).
 * Without the ceiling, enterprise-scale queues staff at 99.5% occupancy.
 */
import { assertFraction, assertNonNegative, assertPositive } from './requirement.ts';
import { TraceBuilder, group, literal, type TraceStep } from './trace.ts';

const MAX_AGENTS = 200_000;

export interface IntervalInput {
  /** Contacts offered in the interval. */
  contacts: number;
  intervalSeconds: number;
  aht: number;
  /** Service level target as a fraction, e.g. 0.8. */
  serviceLevelTarget: number;
  /** Answer threshold, seconds, e.g. 20. */
  serviceLevelSeconds: number;
  /** Omit or null only to show the raw Erlang result. */
  occupancyCeiling?: number | null;
  codes?: {
    contacts?: string;
    aht?: string;
    serviceLevelTarget?: string;
    serviceLevelSeconds?: string;
    occupancyCeiling?: string;
  };
}

export interface IntervalResult {
  trafficErlangs: number;
  /** Fewest agents meeting the service level target. */
  erlangAgents: number;
  /** ceil(A ÷ ceiling), or null without a ceiling. */
  ceilingAgents: number | null;
  /** Agents returned: the larger of the two. */
  agents: number;
  occupancyBound: boolean;
  probabilityOfWait: number;
  serviceLevel: number;
  asa: number;
  occupancy: number;
  trace: TraceStep[];
}

/** Erlang B by the stable recursion. */
export function erlangB(n: number, a: number): number {
  let b = 1;
  for (let k = 1; k <= n; k++) b = (a * b) / (k + a * b);
  return b;
}

/** Erlang C from Erlang B. Defined for N > A; returns 1 otherwise. */
export function erlangC(n: number, a: number): number {
  if (n <= a) return 1;
  const b = erlangB(n, a);
  return b / (1 - (a / n) * (1 - b));
}

export function serviceLevel(n: number, a: number, aht: number, thresholdSeconds: number): number {
  if (n <= a) return 0;
  return 1 - erlangC(n, a) * Math.exp((-(n - a) * thresholdSeconds) / aht);
}

export function averageSpeedOfAnswer(n: number, a: number, aht: number): number {
  if (n <= a) return Infinity;
  return (erlangC(n, a) * aht) / (n - a);
}

/** Fewest agents meeting the target. One pass of the B recursion. */
export function erlangAgentsFor(a: number, aht: number, target: number, thresholdSeconds: number): number {
  if (a === 0) return 0;
  let b = 1;
  for (let n = 1; n <= MAX_AGENTS; n++) {
    b = (a * b) / (n + a * b);
    if (n <= a) continue;
    const c = b / (1 - (a / n) * (1 - b));
    const sl = 1 - c * Math.exp((-(n - a) * thresholdSeconds) / aht);
    if (sl >= target) return n;
  }
  throw new RangeError(`Traffic ${a} needs more than ${MAX_AGENTS} agents`);
}

export function intervalStaffing(input: IntervalInput): IntervalResult {
  const codes = input.codes ?? {};
  assertNonNegative('contacts', input.contacts);
  assertPositive('intervalSeconds', input.intervalSeconds);
  assertPositive('aht', input.aht);
  assertFraction('serviceLevelTarget', input.serviceLevelTarget, true);
  assertNonNegative('serviceLevelSeconds', input.serviceLevelSeconds);
  const ceiling = input.occupancyCeiling ?? null;
  if (ceiling !== null) assertFraction('occupancyCeiling', ceiling, false);

  const t = new TraceBuilder();
  const contacts = t.input('contacts', 'Contacts in interval', input.contacts, 'contacts', codes.contacts);
  const aht = t.input('aht', 'AHT', input.aht, 'seconds', codes.aht);
  const interval = t.input('interval', 'Interval length', input.intervalSeconds, 'seconds');
  const target = t.input('slTarget', 'Service level target', input.serviceLevelTarget, 'ratio', codes.serviceLevelTarget);
  const threshold = t.input('slSeconds', 'Answer within', input.serviceLevelSeconds, 'seconds', codes.serviceLevelSeconds);

  const traffic = t.calc(
    'traffic',
    'Traffic intensity',
    (contacts.value * aht.value) / interval.value,
    'erlangs',
    'contacts × AHT ÷ interval',
    `${contacts.expr}*${aht.expr}/${interval.expr}`,
    [contacts, aht, interval],
  );
  const a = traffic.value;

  const erlangN = erlangAgentsFor(a, aht.value, target.value, threshold.value);
  t.calc(
    'erlangAgents',
    'Erlang C requirement',
    erlangN,
    'agents',
    'smallest N where SL(T) ≥ target',
    literal(erlangN),
    [traffic, aht, target, threshold],
  );

  let ceilingN: number | null = null;
  if (ceiling !== null) {
    const occ = t.input('occCeiling', 'Occupancy ceiling', ceiling, 'ratio', codes.occupancyCeiling);
    ceilingN = Math.ceil(a / ceiling - 1e-9);
    t.calc(
      'ceilingAgents',
      'Occupancy ceiling requirement',
      ceilingN,
      'agents',
      'ceil(traffic ÷ occupancy ceiling)',
      `CEILING(${group(traffic.expr)}/${occ.expr},1)`,
      [traffic, occ],
    );
  }

  const agents = ceilingN === null ? erlangN : Math.max(erlangN, ceilingN);
  const bound = ceilingN !== null && ceilingN > erlangN;
  t.calc(
    'agents',
    bound ? 'Agents (occupancy bound)' : 'Agents',
    agents,
    'agents',
    ceilingN === null ? 'Erlang C requirement' : 'max(Erlang C, occupancy ceiling)',
    ceilingN === null ? literal(erlangN) : `MAX(${erlangN},${ceilingN})`,
    [t.ref('erlangAgents'), ...(ceilingN === null ? [] : [t.ref('ceilingAgents')])],
  );

  // With no traffic nobody waits.
  const idle = a === 0;
  const pw = idle ? 0 : erlangC(agents, a);
  const sl = idle ? 1 : serviceLevel(agents, a, aht.value, threshold.value);
  const asa = idle ? 0 : averageSpeedOfAnswer(agents, a, aht.value);
  const occupancy = idle ? 0 : a / agents;
  // The Erlang terms have no closed Excel form; their Excel cells carry the value.
  t.calc('pw', 'Probability of wait', pw, 'ratio', 'C(N,A)', literal(pw), [t.ref('agents'), traffic]);
  t.calc(
    'serviceLevel',
    'Service level',
    sl,
    'ratio',
    '1 − C(N,A) · e^(−(N−A)·T/AHT)',
    idle ? literal(sl) : `1-${literal(pw)}*EXP(-(${agents}-${group(traffic.expr)})*${threshold.expr}/${aht.expr})`,
    [t.ref('pw'), t.ref('agents'), traffic, threshold, aht],
  );
  t.calc(
    'asa',
    'Average speed of answer',
    asa,
    'seconds',
    'C(N,A) · AHT ÷ (N − A)',
    idle ? literal(asa) : `${literal(pw)}*${aht.expr}/(${agents}-${group(traffic.expr)})`,
    [t.ref('pw'), aht, t.ref('agents'), traffic],
  );
  t.calc('occupancy', 'Occupancy', occupancy, 'ratio', 'A ÷ N', idle ? literal(0) : `${group(traffic.expr)}/${agents}`, [traffic, t.ref('agents')]);

  return {
    trafficErlangs: a,
    erlangAgents: erlangN,
    ceilingAgents: ceilingN,
    agents,
    occupancyBound: bound,
    probabilityOfWait: pw,
    serviceLevel: sl,
    asa,
    occupancy,
    trace: t.steps,
  };
}
