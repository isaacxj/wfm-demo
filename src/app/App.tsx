import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoDataset } from '../data/dataset.ts';
import { engine, periodLabel } from '../engine/index.ts';
import { Grid, type CellRef } from './components/Grid.tsx';
import { Inspector } from './components/Inspector.tsx';
import { Rail } from './components/Rail.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { ALL_FILTERS, buildRows, isFiltered, unitPredicate, type ColumnKey, type Filters, type Grouping } from './model.ts';
import { PLAN } from './plan.ts';

const dataset = demoDataset();
const t0 = performance.now();
const plan = engine.computePlan(dataset.plan);
const calcMs = performance.now() - t0;
const labelOfWeek = (index: number) => periodLabel(dataset.plan.isoYear, index);

const INSPECTOR_KEY = 'capacity-planner.inspector-open';

function readInspectorOpen(): boolean {
  try {
    return window.localStorage.getItem(INSPECTOR_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function App() {
  const [week, setWeek] = useState<number>(PLAN.landingWeek);
  const [grouping, setGrouping] = useState<Grouping>('vendor');
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS);
  const [hidden, setHidden] = useState<ReadonlySet<ColumnKey>>(new Set());
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(readInspectorOpen);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((open) => {
      try {
        window.localStorage.setItem(INSPECTOR_KEY, String(!open));
      } catch {
        // Preference only; ignore storage failures.
      }
      return !open;
    });
  }, []);

  const select = useCallback((ref: CellRef | null) => {
    setSelected(ref);
    if (ref) setInspectorOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const rows = useMemo(() => buildRows(plan, { week, filters, grouping }), [week, filters, grouping]);
  const unitCount = useMemo(() => dataset.units.filter(unitPredicate(filters)).length, [filters]);
  const weekLabel = plan.weeks[week - 1]?.label ?? '';
  const selectedRow = selected ? rows.find((r) => r.id === selected.rowId) : undefined;

  return (
    <div className={`shell ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
      <TopBar weeks={plan.weeks} />
      <Rail sites={dataset.plan.sites.length} units={dataset.units.length} />
      <main className="main">
        <Toolbar
          weeks={plan.weeks}
          week={week}
          onWeek={setWeek}
          grouping={grouping}
          onGrouping={setGrouping}
          filters={filters}
          onFilters={setFilters}
          hidden={hidden}
          onHidden={setHidden}
        />
        <div className="grid-scroll">
          <Grid
            rows={rows}
            grouping={grouping}
            allocated={isFiltered(filters)}
            hidden={hidden}
            selected={selectedRow ? selected : null}
            onSelect={select}
          />
        </div>
      </main>
      <Inspector
        open={inspectorOpen}
        onToggle={toggleInspector}
        rows={rows}
        selection={selectedRow ? selected : null}
        weekLabel={weekLabel}
        labelOfWeek={labelOfWeek}
      />
      <StatusBar
        engineName={engine.name}
        calcMs={calcMs}
        siteWeeks={plan.sites.length * plan.weeks.length}
        sitesShown={rows.filter((r) => r.kind === 'site').length}
        units={unitCount}
        weekLabel={weekLabel}
      />
    </div>
  );
}
