import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlanEvent, PlanWeek } from '../../engine/index.ts';
import { shortDate } from '../format.ts';
import { monthOf, startsMonth } from '../periods.ts';
import type { CurveSeries } from '../report.ts';

interface OverUnderChartProps {
  weeks: readonly PlanWeek[];
  /** One series, or the baseline then the scenario. */
  series: readonly CurveSeries[];
  /** Weeks up to this one are actuals. */
  throughWeek: number;
  events: readonly PlanEvent[];
  height?: number;
  /** Opens the same numbers as a table. */
  onTable?: () => void;
}

const M = { top: 34, right: 112, bottom: 26, left: 52 };
const MINUS = '−';
const one = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const signed = (v: number) => (Math.abs(v) < 0.05 ? '0.0' : `${v > 0 ? '+' : MINUS}${one.format(Math.abs(v))}`);
const tick = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : MINUS}${int.format(Math.abs(v))}`);

/** Emphasis: with two series the baseline recedes to grey and the scenario carries the accent. */
const SERIES_CLASS = (count: number, i: number) => (count > 1 && i === 0 ? 'de' : 'em');

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function OverUnderChart({ weeks, series, throughWeek, events, height = 280, onTable }: OverUnderChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (box.current) setWidth(box.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = weeks.length;
  const all = series.flatMap((s) => s.values);
  const ticks = useMemo(() => niceTicks(Math.min(0, ...all), Math.max(0, ...all)), [all]);
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const plotW = Math.max(200, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const x = (week: number) => M.left + ((week - 0.5) / n) * plotW;
  const y = (v: number) => M.top + ((hi - v) / (hi - lo)) * plotH;
  const path = (vals: readonly number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = (vals: readonly number[]) => `${path(vals)}L${x(n).toFixed(1)},${y(0).toFixed(1)}L${x(1).toFixed(1)},${y(0).toFixed(1)}Z`;
  const months = weeks.map((w, i) => ({ i, w })).filter(({ i }) => i === 0 || startsMonth(weeks, i));
  const hw = hover === null ? null : weeks[hover];
  // End labels: at each line's end, pushed apart when two ends sit closer than a line of text.
  const endLabelY = series.map((s) => y(s.values.at(-1)!) + 4);
  if (endLabelY.length === 2 && Math.abs(endLabelY[0]! - endLabelY[1]!) < 14) {
    const [a, b] = endLabelY as [number, number];
    const mid = (a + b) / 2;
    const upper = a <= b ? 0 : 1;
    endLabelY[upper] = mid - 7;
    endLabelY[1 - upper] = mid + 7;
  }
  const summary = series.map((s) => `${s.name}: lowest ${signed(Math.min(...s.values))}, highest ${signed(Math.max(...s.values))}`).join('; ');

  return (
    <div className="ou-chart" ref={box}>
      {series.length > 1 && (
        <div className="ou-legend" aria-hidden>
          {series.map((s, i) => (
            <span key={s.name} className="ou-key">
              <span className={`ou-swatch ${SERIES_CLASS(series.length, i)}`} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg width={width} height={height} role="img" aria-label={`Over/Under by week, all sites. ${summary}.`}>
        {/* Actual weeks, shaded as in the grid. */}
        <rect className="ou-actual" x={x(1) - plotW / n / 2} y={M.top} width={(throughWeek / n) * plotW} height={plotH} />
        <text className="ou-band-label" x={x(1) - plotW / n / 2 + 6} y={M.top + 13}>
          Actual
        </text>
        <text className="ou-band-label" x={x(throughWeek + 1) - plotW / n / 2 + 6} y={M.top + 13}>
          Plan
        </text>
        {events.map((e) => (
          <g key={e.code}>
            <rect className="ou-event" x={x(e.fromWeek) - plotW / n / 2} y={6} width={((e.toWeek - e.fromWeek + 1) / n) * plotW} height={16} />
            <text className="ou-event-label" x={x(e.fromWeek) - plotW / n / 2 + 4} y={18}>
              {e.code}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'ou-zero' : 'ou-grid'} x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="ou-tick" x={M.left - 8} y={y(t) + 3.5} textAnchor="end">
              {tick(t)}
            </text>
          </g>
        ))}
        {months.map(({ i, w }) => (
          <text key={w.index} className="ou-tick" x={x(i + 1) - plotW / n / 2} y={height - 8}>
            {monthOf(w).label.slice(0, 3)}
          </text>
        ))}
        <line className="ou-now" x1={x(throughWeek + 1) - plotW / n / 2} x2={x(throughWeek + 1) - plotW / n / 2} y1={M.top} y2={M.top + plotH} />
        {series.map((s, i) => (
          <g key={s.name} className={`ou-series ${SERIES_CLASS(series.length, i)}`}>
            <path className="ou-area" d={area(s.values)} />
            <path className="ou-line" d={path(s.values)} />
            <circle className="ou-end" cx={x(n)} cy={y(s.values.at(-1)!)} r={4} />
            <text className="ou-end-label" x={x(n) + 10} y={endLabelY[i]}>
              {series.length > 1 ? `${s.name} ` : ''}
              {signed(s.values.at(-1)!)}
            </text>
          </g>
        ))}
        {hover !== null && hw && (
          <g className="ou-hover">
            <line x1={x(hover + 1)} x2={x(hover + 1)} y1={M.top} y2={M.top + plotH} />
            {series.map((s, i) => (
              <circle key={s.name} className={SERIES_CLASS(series.length, i)} cx={x(hover + 1)} cy={y(s.values[hover]!)} r={4} />
            ))}
          </g>
        )}
        <rect
          className="ou-hit"
          x={M.left}
          y={M.top}
          width={plotW}
          height={plotH}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            setHover(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && hw && (
        <div className="ou-tip" style={{ left: Math.min(x(hover + 1) + 12, width - 200), top: M.top + 6 }}>
          <div className="ou-tip-head">
            {hw.label} · {shortDate(hw.start)} · {hw.index <= throughWeek ? 'Actual' : 'Plan'}
          </div>
          {series.map((s, i) => (
            <div key={s.name} className="ou-tip-row">
              <span className={`ou-swatch ${SERIES_CLASS(series.length, i)}`} />
              <span>{s.name}</span>
              <span className="num">{signed(s.values[hover]!)}</span>
            </div>
          ))}
          {events
            .filter((e) => hw.index >= e.fromWeek && hw.index <= e.toWeek)
            .map((e) => (
              <div key={e.code} className="ou-tip-event">
                {e.code} {e.name}
              </div>
            ))}
        </div>
      )}
      {onTable && (
        <button className="link-button ou-table" onClick={onTable}>
          View as table
        </button>
      )}
    </div>
  );
}
