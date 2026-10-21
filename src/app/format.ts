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
      // Over/Under: positive is over (a surplus), negative is under (a deficit).
      const body = oneFmt.format(Math.abs(shown));
      return value > 0 ? { text: `+${body}`, tone: 'pos' } : { text: `${MINUS}${body}`, tone: 'neg' };
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

// Inspector step values ------------------------------------------------------

export interface StepValue {
  text: string;
  unit: string;
}

const twoFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const countFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct3 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** A trace value in its unit. Week indices render through `weekLabel`. */
export function formatStep(value: number, unit: string, weekLabel: (index: number) => string): StepValue {
  const signed = (s: string) => (value < 0 ? `${MINUS}${s}` : s);
  const abs = Math.abs(value);
  switch (unit) {
    case 'contacts':
      return { text: signed(intFmt.format(abs)), unit: '' };
    case 'seconds':
      return { text: signed(oneFmt.format(abs)), unit: 's' };
    case 'hours':
      return { text: signed(oneFmt.format(abs)), unit: 'hrs' };
    case 'hours/week':
      return { text: oneFmt.format(abs), unit: 'h/wk' };
    case 'FTE':
      return { text: signed(oneFmt.format(abs)), unit: 'FTE' };
    case 'heads':
      return { text: signed(oneFmt.format(abs)), unit: 'HC' };
    case 'agents':
      return { text: intFmt.format(abs), unit: 'agents' };
    case 'erlangs':
      return { text: twoFmt.format(abs), unit: 'E' };
    case 'ratio':
      return { text: signed((abs < 0.1 && abs > 0 ? pct3 : pct1).format(abs * 100)), unit: '%' };
    case 'percent':
      return { text: signed(pct1.format(abs)), unit: '%' };
    case 'weeks':
      return { text: countFmt.format(value), unit: 'wks' };
    case 'week':
      return { text: weekLabel(value), unit: '' };
    default:
      return { text: signed(countFmt.format(abs)), unit: '' };
  }
}

/**
 * A change between two values. Always signed. Only Over/Under is coloured: a
 * rise moves a site towards over (better), a fall towards under (worse).
 */
export function formatDelta(value: number | null | undefined, format: Format, colour: boolean): Formatted {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_APPLICABLE;
  const decimals = format === 'int' ? 0 : 1;
  const zeroText = decimals === 0 ? '0' : '0.0';
  if (value === 0) return { text: zeroText, tone: 'muted' };
  const shown = format === 'pct' ? value * 100 : value;
  const scale = 10 ** decimals;
  const rounded = Math.round(Math.abs(shown) * scale) / scale;
  if (rounded === 0) return { text: zeroText, tone: undefined };
  const body = (decimals === 0 ? intFmt : oneFmt).format(rounded);
  const tone: Tone = colour ? (value > 0 ? 'pos' : 'neg') : undefined;
  return { text: `${value > 0 ? '+' : MINUS}${body}`, tone };
}
