import type { ReactNode } from 'react';
import type { PlanWeek } from '../../engine/index.ts';
import { shortDate } from '../format.ts';
import {
  ALL_FILTERS,
  CHANNEL_LABEL,
  COLUMN_GROUPS,
  COLUMNS,
  FILTER_DIMENSIONS,
  GROUPINGS,
  isFiltered,
  type ColumnKey,
  type FilterKey,
  type Filters,
  type Grouping,
  type NumericKey,
  columnSpec,
} from '../model.ts';
import { PERIOD_METRICS } from '../periods.ts';
import { Caret, Check, Close, StepLeft, StepRight } from './icons.tsx';
import type { Density } from './PeriodsGrid.tsx';
import { Menu } from './Menu.tsx';

interface ToolbarProps {
  weeks: readonly PlanWeek[];
  week: number;
  onWeek: (week: number) => void;
  grouping: Grouping;
  onGrouping: (g: Grouping) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  hidden: ReadonlySet<ColumnKey>;
  onHidden: (h: ReadonlySet<ColumnKey>) => void;
  /** Columns the Columns menu offers. Defaults to every grid column but Site. */
  columnChoices?: readonly ColumnKey[];
  /** Extra controls after the filter chips. */
  children?: ReactNode;
  /** Periods / Metrics orientation; omitted where the view has only one. */
  mode?: GridMode;
  onMode?: (m: GridMode) => void;
  density?: Density;
  onDensity?: (d: Density) => void;
  /** Periods mode: the one metric that fills the grid. */
  metric?: NumericKey;
  onMetric?: (m: NumericKey) => void;
}

export type GridMode = 'periods' | 'metrics';

const valueLabel = (key: FilterKey, v: string) => (key === 'channel' ? (CHANNEL_LABEL[v] ?? v) : v);

export function Toolbar(props: ToolbarProps) {
  const { weeks, week, onWeek, grouping, onGrouping, filters, onFilters, hidden, onHidden, children } = props;
  const { mode, onMode, density, onDensity, metric, onMetric } = props;
  const periods = mode === 'periods';
  const choices = props.columnChoices ?? COLUMNS.filter((c) => c.key !== 'site').map((c) => c.key);
  const shownCount = choices.filter((k) => !hidden.has(k)).length;
  const current = weeks[week - 1];
  const filtered = isFiltered(filters);
  const activeCount = FILTER_DIMENSIONS.filter((d) => filters[d.key].length < d.values.length).length;

  const toggleValue = (key: FilterKey, value: string) => {
    const set = new Set(filters[key]);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    const dim = FILTER_DIMENSIONS.find((d) => d.key === key)!;
    // Keep dimension order; an empty selection would show nothing, so refuse it.
    const next = (dim.values as readonly string[]).filter((v) => set.has(v));
    if (next.length === 0) return;
    onFilters({ ...filters, [key]: next });
  };

  return (
    <div className="toolbar" role="toolbar" aria-label="Grid controls">
      <div className="tl-seg">
        <Menu
          trigger={(p) => (
            <button className="tl-button" {...p}>
              <span className="tl-key">Group</span> {GROUPINGS.find((g) => g.id === grouping)?.label} <Caret />
            </button>
          )}
        >
          {(close) =>
            GROUPINGS.map((g) => (
              <button
                key={g.id}
                className="menu-item"
                role="menuitemradio"
                aria-checked={g.id === grouping}
                onClick={() => {
                  onGrouping(g.id);
                  close();
                }}
              >
                <span className="tick">{g.id === grouping && <Check />}</span>
                {g.label}
              </button>
            ))
          }
        </Menu>
      </div>

      {periods && metric && onMetric && (
        <div className="tl-seg">
          <Menu
            trigger={(p) => (
              <button className="tl-button" {...p}>
                <span className="tl-key">Metric</span> {columnSpec(metric).header} <Caret />
              </button>
            )}
          >
            {(close) =>
              PERIOD_METRICS.map((m) => (
                <button
                  key={m}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={m === metric}
                  onClick={() => {
                    onMetric(m);
                    close();
                  }}
                >
                  <span className="tick">{m === metric && <Check />}</span>
                  {columnSpec(m).header}
                </button>
              ))
            }
          </Menu>
        </div>
      )}

      <div className="tl-seg">
        <button className="tl-button tl-step" aria-label="Previous week" disabled={week <= 1} onClick={() => onWeek(week - 1)}>
          <StepLeft />
        </button>
        <Menu
          trigger={(p) => (
            <button className="tl-button" {...p}>
              <span className="tl-key">Week</span>
              <span className="tl-num">{current?.label}</span>
              <span className="tl-key">{current ? shortDate(current.start) : ''}</span>
              <Caret />
            </button>
          )}
        >
          {(close) => (
            <div className="menu-scroll">
              {weeks.map((w) => (
                <button
                  key={w.index}
                  className="menu-item"
                  role="menuitemradio"
                  aria-checked={w.index === week}
                  ref={(el) => {
                    if (el && w.index === week) el.scrollIntoView({ block: 'center' });
                  }}
                  onClick={() => {
                    onWeek(w.index);
                    close();
                  }}
                >
                  <span className="tick">{w.index === week && <Check />}</span>
                  <span className="num">{w.label}</span>
                  <span className="aside">{shortDate(w.start)}</span>
                </button>
              ))}
            </div>
          )}
        </Menu>
        <button
          className="tl-button tl-step"
          aria-label="Next week"
          disabled={week >= weeks.length}
          onClick={() => onWeek(week + 1)}
        >
          <StepRight />
        </button>
      </div>

      <div className="tl-seg">
        <Menu
          trigger={(p) => (
            <button className="tl-button" {...p}>
              Filter {activeCount > 0 && <span className="tl-count">{activeCount}</span>} <Caret />
            </button>
          )}
        >
          {() => (
            <>
              <div className="menu-columns">
                {FILTER_DIMENSIONS.map((d) => (
                  <div key={d.key}>
                    <div className="menu-heading">{d.label}</div>
                    {d.values.map((v) => {
                      const on = filters[d.key].includes(v);
                      return (
                        <button
                          key={v}
                          className="menu-item"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          onClick={() => toggleValue(d.key, v)}
                        >
                          <span className={`check ${on ? 'on' : ''}`}>{on && <Check />}</span>
                          {valueLabel(d.key, v)}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="menu-foot">
                <button onClick={() => onFilters(ALL_FILTERS)} disabled={!filtered}>
                  Clear filters
                </button>
              </div>
            </>
          )}
        </Menu>
      </div>

      <div className="chips">
        {FILTER_DIMENSIONS.filter((d) => filters[d.key].length < d.values.length).map((d) => (
          <span className="chip" key={d.key}>
            <span className="chip-key">{d.label}</span>
            {filters[d.key].map((v) => valueLabel(d.key, v)).join(', ')}
            <button aria-label={`Clear ${d.label} filter`} onClick={() => onFilters({ ...filters, [d.key]: ALL_FILTERS[d.key] })}>
              <Close />
            </button>
          </span>
        ))}
      </div>

      {children}

      <div className="tl-spacer" />

      {filtered && <div className="tl-note">Supply split by share of required FTE</div>}

      {mode && onMode && (
        <div className="tl-seg end">
          <span className="seg-group" role="group" aria-label="Orientation">
            <button aria-pressed={mode === 'periods'} onClick={() => onMode('periods')} title="Weeks across the columns, one metric">
              Periods
            </button>
            <button aria-pressed={mode === 'metrics'} onClick={() => onMode('metrics')} title="One week, metrics across the columns">
              Metrics
            </button>
          </span>
        </div>
      )}
      {density && onDensity && (
        <div className="tl-seg end">
          <span className="tl-key">Density</span>
          <span className="seg-group" role="group" aria-label="Density">
            <button aria-pressed={density === 'comfortable'} onClick={() => onDensity('comfortable')}>
              Comfortable
            </button>
            <button aria-pressed={density === 'compact'} onClick={() => onDensity('compact')}>
              Compact
            </button>
          </span>
        </div>
      )}

      {!periods && (
      <div className="tl-seg end">
        <Menu
          align="right"
          trigger={(p) => (
            <button className="tl-button" {...p}>
              Columns {shownCount < choices.length && <span className="tl-count">{shownCount}</span>} <Caret />
            </button>
          )}
        >
          {() => (
            <div className="menu-scroll">
              {COLUMN_GROUPS.filter((g) => g.id !== 'identity' && COLUMNS.some((c) => c.group === g.id && choices.includes(c.key))).map((g) => (
                <div key={g.id}>
                  <div className="menu-heading">{g.label}</div>
                  {COLUMNS.filter((c) => c.group === g.id && choices.includes(c.key)).map((c) => {
                    const on = !hidden.has(c.key);
                    return (
                      <button
                        key={c.key}
                        className="menu-item"
                        role="menuitemcheckbox"
                        aria-checked={on}
                        onClick={() => {
                          const next = new Set(hidden);
                          if (on) next.add(c.key);
                          else next.delete(c.key);
                          onHidden(next);
                        }}
                      >
                        <span className={`check ${on ? 'on' : ''}`}>{on && <Check />}</span>
                        {c.header}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="menu-foot">
                <button onClick={() => onHidden(new Set())} disabled={shownCount === choices.length}>
                  Show all
                </button>
              </div>
            </div>
          )}
        </Menu>
      </div>
      )}
    </div>
  );
}
