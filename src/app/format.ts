/**
 * Grid number formatting, brief 5.4. Thousands always separated, never
 * abbreviated. Tone carries colour; the sign or dash always carries meaning too.
 */

export type Format = 'int' | 'one' | 'pct' | 'signed';
export type Tone = 'muted' | 'pos' | 'neg' | undefined;

export interface Formatted {
  text: string;
  tone: Tone;
}

const MINUS = '−';
const EN_DASH = '–';

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const NOT_APPLICABLE: Formatted = { text: EN_DASH, tone: 'muted' };

export function decimalsOf(format: Format): number {
  return format === 'int' ? 0 : 1;
}

/** Round to what the grid displays. Percentages are stored as ratios. */
export function displayRound(value: number, format: Format): number {
  const scale = format === 'pct' ? 1000 : 10 ** decimalsOf(format);
  const r = Math.round(value * scale) / scale;
  return Object.is(r, -0) ? 0 : r;
}

export function formatValue(value: number | null | undefined, format: Format): Formatted {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_APPLICABLE;
  const shown = format === 'pct' ? value * 100 : value;
  const rounded = displayRound(value, format);
  const zeroText = format === 'int' ? '0' : '0.0';
  if (value === 0) return { text: zeroText, tone: 'muted' };
  // Non-zero but too small to show: no sign, no colour, ordinary ink.
  if (rounded === 0) return { text: zeroText, tone: undefined };

  switch (format) {
    case 'int':
      return { text: intFmt.format(shown), tone: undefined };
    case 'one':
    case 'pct':
      return { text: oneFmt.format(shown), tone: undefined };
    case 'signed': {
      // Gap: positive is a deficit, negative a surplus.
      const body = oneFmt.format(Math.abs(shown));
      return value > 0 ? { text: `+${body}`, tone: 'neg' } : { text: `${MINUS}${body}`, tone: 'pos' };
    }
  }
}

/** Parse a formatted cell back to a number. Test and export helper. */
export function parseFormatted(text: string): number | null {
  if (text === EN_DASH) return null;
  return Number(text.replace(/,/g, '').replace(MINUS, '-').replace('+', ''));
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "22 Mar" from "2027-03-22". */
export function shortDate(isoDate: string): string {
  return dateFmt.format(new Date(`${isoDate}T00:00:00Z`));
}
