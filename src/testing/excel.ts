/**
 * Evaluates the Excel subset the engine emits: arithmetic, ^, MAX, MIN,
 * CEILING(x,1), EXP. Test helper only; the app never imports it.
 */
export function evaluateExcel(formula: string): number {
  const js = formula
    .replace(/^=/, '')
    .replace(/\^/g, '**')
    .replace(/CEILING\(/g, '__ceil(')
    .replace(/MAX\(/g, 'Math.max(')
    .replace(/MIN\(/g, 'Math.min(')
    .replace(/EXP\(/g, 'Math.exp(');
  if (!/^[\d.+\-*/(),\s_a-zA-Z]*$/.test(js)) throw new Error(`Unexpected token in ${formula}`);
  const fn = new Function('__ceil', `return (${js});`) as (c: (x: number, s: number) => number) => number;
  return fn((x, s) => Math.ceil(x / s - 1e-9) * s);
}
