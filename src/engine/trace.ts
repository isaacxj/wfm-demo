/**
 * Calculation trace.
 *
 * Every engine function records its chain as it computes, so the value the
 * grid shows and the chain the inspector shows are the same arithmetic. Each
 * step also carries an Excel expression built from literal inputs, so any step
 * can be pasted into a spreadsheet and reproduce its own value.
 */

export type Unit =
  | 'contacts'
  | 'seconds'
  | 'hours'
  | 'hours/week'
  | 'FTE'
  | 'agents'
  | 'erlangs'
  | 'heads'
  | 'ratio'
  | 'percent'
  | 'weeks'
  | 'week'
  | 'count';

/** A sub-chain a step was built from, e.g. one planning unit of a site roll-up. */
export interface TracePart {
  id: string;
  label: string;
  steps: readonly TraceStep[];
  /** Key of the step in `steps` this part contributes. */
  focus: string;
}

export interface TraceStep {
  /** Stable key, unique within one trace. */
  key: string;
  label: string;
  value: number;
  unit: Unit;
  /** Formula in planning notation, e.g. "volume × AHT ÷ 3600". */
  formula?: string;
  /** Code of the assumption or forecast record that supplied an input. */
  assumption?: string;
  /** Self-contained Excel formula reproducing this value from literal inputs. */
  excel?: string;
  /** Keys of the steps in the same trace this value was computed from. */
  deps?: string[];
  /** Sub-chains summed or carried into this step, each with its own trace. */
  parts?: TracePart[];
  /** A convention the reader must know to read the value, stated in words. */
  note?: string;
}

/** A recorded step: its key, value and the Excel expression that reproduces it. */
export interface Ref {
  key: string;
  value: number;
  expr: string;
}

export class TraceBuilder {
  readonly steps: TraceStep[] = [];

  /** Record an input. Its Excel expression is the literal value. */
  input(key: string, label: string, value: number, unit: Unit, assumption?: string): Ref {
    const expr = literal(value);
    this.push({ key, label, value, unit, assumption, excel: `=${expr}` });
    return { key, value, expr };
  }

  /** Record a computed value with its formula, Excel expression and the steps it used. */
  calc(key: string, label: string, value: number, unit: Unit, formula: string, expr: string, deps: readonly Ref[]): Ref {
    for (const d of deps) {
      if (!this.steps.some((s) => s.key === d.key)) throw new Error(`Step ${key} depends on unknown step ${d.key}`);
    }
    this.push({ key, label, value, unit, formula, excel: `=${expr}`, deps: deps.map((d) => d.key) });
    return { key, value, expr };
  }

  /** Append another trace's steps under a key prefix, keeping order and links. */
  include(prefix: string, steps: readonly TraceStep[]): void {
    for (const s of steps) {
      const step: TraceStep = { ...s, key: `${prefix}.${s.key}` };
      if (s.deps) step.deps = s.deps.map((d) => `${prefix}.${d}`);
      this.push(step);
    }
  }

  /** Reference to a recorded step. */
  ref(key: string): Ref {
    const s = findStep(this.steps, key);
    return { key, value: s.value, expr: (s.excel ?? '=0').slice(1) };
  }

  /** Mark a recorded step as taking its value from other steps in this trace. */
  link(key: string, deps: readonly Ref[]): void {
    const s = findStep(this.steps, key);
    s.deps = [...(s.deps ?? []), ...deps.map((d) => d.key)];
  }

  /** State a convention beside a recorded step. */
  note(key: string, text: string): void {
    findStep(this.steps, key).note = text;
  }

  /** Attach the sub-chains a step was built from. */
  attach(key: string, parts: TracePart[]): void {
    findStep(this.steps, key).parts = parts;
  }

  private push(step: TraceStep): void {
    if (this.steps.some((s) => s.key === step.key)) {
      throw new Error(`Duplicate trace key: ${step.key}`);
    }
    const clean: TraceStep = { key: step.key, label: step.label, value: step.value, unit: step.unit };
    if (step.formula !== undefined) clean.formula = step.formula;
    if (step.assumption !== undefined) clean.assumption = step.assumption;
    if (step.excel !== undefined) clean.excel = step.excel;
    if (step.deps !== undefined && step.deps.length > 0) clean.deps = step.deps;
    if (step.parts !== undefined) clean.parts = step.parts;
    if (step.note !== undefined) clean.note = step.note;
    this.steps.push(clean);
  }
}

/** Literal for an Excel expression. Negative literals are parenthesised. */
export function literal(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite value in trace: ${value}`);
  const s = String(value);
  return value < 0 ? `(${s})` : s;
}

/** Wrap an expression in parentheses unless it is already a bare literal. */
export function group(expr: string): string {
  return /^\(?-?[\d.]+(e[+-]?\d+)?\)?$/i.test(expr) ? expr : `(${expr})`;
}

export function findStep(steps: readonly TraceStep[], key: string): TraceStep {
  const step = steps.find((s) => s.key === key);
  if (!step) throw new Error(`No trace step ${key}`);
  return step;
}
