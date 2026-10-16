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
}

/** A value plus the Excel expression that reproduces it. */
export interface Ref {
  value: number;
  expr: string;
}

export class TraceBuilder {
  readonly steps: TraceStep[] = [];

  /** Record an input. Its Excel expression is the literal value. */
  input(key: string, label: string, value: number, unit: Unit, assumption?: string): Ref {
    const expr = literal(value);
    this.push({ key, label, value, unit, assumption, excel: `=${expr}` });
    return { value, expr };
  }

  /** Record a computed value with its formula and Excel expression. */
  calc(key: string, label: string, value: number, unit: Unit, formula: string, expr: string): Ref {
    this.push({ key, label, value, unit, formula, excel: `=${expr}` });
    return { value, expr };
  }

  /** Append another trace's steps under a key prefix, keeping order. */
  include(prefix: string, steps: readonly TraceStep[]): void {
    for (const s of steps) this.push({ ...s, key: `${prefix}.${s.key}` });
  }

  private push(step: TraceStep): void {
    if (this.steps.some((s) => s.key === step.key)) {
      throw new Error(`Duplicate trace key: ${step.key}`);
    }
    const clean: TraceStep = { key: step.key, label: step.label, value: step.value, unit: step.unit };
    if (step.formula !== undefined) clean.formula = step.formula;
    if (step.assumption !== undefined) clean.assumption = step.assumption;
    if (step.excel !== undefined) clean.excel = step.excel;
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
