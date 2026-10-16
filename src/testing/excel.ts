/**
 * Evaluates the Excel subset the engine emits: arithmetic, comparison, ^,
 * MAX, MIN, CEILING(x,1), FLOOR(x,1), IF, EXP. Test helper only; the app never imports it.
 */
export function evaluateExcel(formula: string): number {
  const js = formula
    .replace(/^=/, '')
    .replace(/\^/g, '**')
    .replace(/CEILING\(/g, '__ceil(')
    .replace(/FLOOR\(/g, '__floor(')
    .replace(/IF\(/g, '__if(')
    .replace(/MAX\(/g, 'Math.max(')
    .replace(/MIN\(/g, 'Math.min(')
    .replace(/EXP\(/g, 'Math.exp(');
  if (!/^[\d.+\-*/(),\s_a-zA-Z<>=]*$/.test(js)) throw new Error(`Unexpected token in ${formula}`);
  const fn = new Function('__ceil', '__floor', '__if', `return (${js});`) as (
    c: (x: number, s: number) => number,
    f: (x: number, s: number) => number,
    i: (c: boolean, a: number, b: number) => number,
  ) => number;
  return fn(
    (x, s) => Math.ceil(x / s - 1e-9) * s,
    (x, s) => Math.floor(x / s + 1e-9) * s,
    (c, a, b) => (c ? a : b),
  );
}
