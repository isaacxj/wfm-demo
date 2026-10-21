import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoDataset } from '../data/dataset.ts';
import { engine, periodLabel, type PlanResult } from '../engine/index.ts';
import { applyScenario, parseStoredScenarios, type Scenario } from '../scenario/scenario.ts';
import { buildCompare, COMPARE_METRICS, DEFAULT_COMPARE_HIDDEN, deltaOf, deltaTrace, horizonSummary } from './compare.ts';
import { CompareGrid, type CompareRef } from './components/CompareGrid.tsx';
import { HiringView, type HiringGrouping, type HiringKey, type HiringRef } from './components/HiringView.tsx';
import { Grid, type CellRef } from './components/Grid.tsx';
import { Inspector, planTarget, type InspectorTarget } from './components/Inspector.tsx';
import { Rail, type View } from './components/Rail.tsx';
import { ScenarioBar, type DraftOverride } from './components/ScenarioBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { compareWorkbook, fileName, hiringWorkbook, planWorkbook, type ExportContext } from '../export/xlsx.ts';
import { downloadWorkbook } from '../export/download.ts';
import { formatDelta, formatValue, type Formatted } from './format.ts';
import { buildHiringPlan } from './hiring.ts';
import {
  ALL_FILTERS,
  buildRows,
  CHANNEL_LABEL,
  columnSpec,
  FILTER_DIMENSIONS,
  GROUPINGS,
  isFiltered,
  unitPredicate,
  type ColumnKey,
  type Filters,
  type Grouping,
  type NumericKey,
} from './model.ts';
import { PLAN } from './plan.ts';

const dataset = demoDataset();
const t0 = performance.now();
const basePlan = engine.computePlan(dataset.plan);
const baseMs = performance.now() - t0;
const labelOfWeek = (index: number) => periodLabel(dataset.plan.isoYear, index);
const HORIZON = dataset.plan.weeks.length;
const siteName = (id: string) => dataset.plan.sites.find((s) => s.id === id)?.name ?? id;
const PLAN_TITLE = `${PLAN.name} ${PLAN.version}`;
const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function filtersText(filters: Filters): string {
  if (!isFiltered(filters)) return 'all business units, languages and channels';
  return FILTER_DIMENSIONS.filter((d) => filters[d.key].length < d.values.length)
    .map((d) => `${d.label.toLowerCase()} ${filters[d.key].map((v) => (d.key === 'channel' ? (CHANNEL_LABEL[v] ?? v) : v)).join(', ')}`)
    .join('; ');
}

const INSPECTOR_KEY = 'capacity-planner.inspector-open';
const SCENARIOS_KEY = 'capacity-planner.scenarios';

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Per-browser convenience only; ignore storage failures.
  }
}

type AnyRef = (CellRef & { side?: undefined }) | CompareRef;

/** Step in a site-week trace behind each hiring plan column. */
const HIRING_FOCUS: Readonly<Record<HiringKey, string>> = {
  starters: 'flow.hiresToStart',
  graduates: 'flow.classGraduates',
  deficit: 'flow.hireable',
  start: 'flow.startPeriod',
  training: 'flow.startPeriod',
  nesting: 'flow.startPeriod',
  productive: 'flow.startPeriod',
};

export function App() {
  const [view, setView] = useState<View>('plans');
  const [week, setWeek] = useState<number>(PLAN.landingWeek);
  const [grouping, setGrouping] = useState<Grouping>('outsourcer');
  const [filters, setFilters] = useState<Filters>(ALL_FILTERS);
  const [hidden, setHidden] = useState<ReadonlySet<ColumnKey>>(new Set());
  const [compareHidden, setCompareHidden] = useState<ReadonlySet<ColumnKey>>(DEFAULT_COMPARE_HIDDEN);
  const [changedOnly, setChangedOnly] = useState(true);
  const [selected, setSelected] = useState<AnyRef | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() => readStored(INSPECTOR_KEY, true, (r) => r !== 'false'));
  const [scenarios, setScenarios] = useState<Scenario[]>(() => readStored(SCENARIOS_KEY, [], parseStoredScenarios));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hiringGrouping, setHiringGrouping] = useState<HiringGrouping>('week');
  const [outsourcerFilter, setOutsourcerFilter] = useState<ReadonlySet<string>>(() => new Set(dataset.outsourcers));
  const [hiringSel, setHiringSel] = useState<HiringRef | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => writeStored(SCENARIOS_KEY, JSON.stringify(scenarios)), [scenarios]);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((open) => {
      writeStored(INSPECTOR_KEY, String(!open));
      return !open;
    });
  }, []);

  const select = useCallback((ref: AnyRef | null) => {
    setSelected(ref);
    if (ref) setInspectorOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setSelected(null);
        setHiringSel(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Scenario lifecycle -----------------------------------------------------------

  const active = scenarios.find((s) => s.id === activeId) ?? null;

  const fork = useCallback(() => {
    setScenarios((list) => {
      const n = list.reduce((m, s) => Math.max(m, Number(s.code.replace(/\D/g, '')) || 0), 0) + 1;
      const sc: Scenario = { id: `s${n}`, code: `SC${n}`, name: `Scenario ${n}`, forkedFrom: `${PLAN.name} ${PLAN.version}`, overrides: [] };
      setActiveId(sc.id);
      return [...list, sc];
    });
    setView('scenarios');
    setSelected(null);
  }, []);

  const updateActive = useCallback(
    (fn: (s: Scenario) => Scenario) => setScenarios((list) => list.map((s) => (s.id === activeId ? fn(s) : s))),
    [activeId],
  );

  const addOverride = useCallback(
    (draft: DraftOverride) =>
      updateActive((s) => {
        const n = s.overrides.reduce((m, o) => Math.max(m, Number(o.code.split('.OV')[1]) || 0), 0) + 1;
        return { ...s, overrides: [...s.overrides, { ...draft, code: `${s.code}.OV${n}` } as Scenario['overrides'][number]] };
      }),
    [updateActive],
  );

  const removeOverride = useCallback(
    (code: string) => updateActive((s) => ({ ...s, overrides: s.overrides.filter((o) => o.code !== code) })),
    [updateActive],
  );

  const discard = useCallback(() => {
    setScenarios((list) => list.filter((s) => s.id !== activeId));
    setActiveId(null);
    setSelected(null);
  }, [activeId]);

  const activate = useCallback((id: string | null) => {
    setActiveId(id);
    setSelected(null);
  }, []);

  const changeView = useCallback((v: View) => {
    setView(v);
    setSelected(null);
    setHiringSel(null);
  }, []);

  const selectClass = useCallback((ref: HiringRef | null) => {
    setHiringSel(ref);
    if (ref) setInspectorOpen(true);
  }, []);

  // Computation -------------------------------------------------------------------

  const scen = useMemo<{ plan: PlanResult; ms: number } | null>(() => {
    if (!active) return null;
    const start = performance.now();
    const plan = engine.computePlan(applyScenario(dataset.plan, active));
    return { plan, ms: performance.now() - start };
  }, [active]);

  const shownPlan = scen?.plan ?? basePlan;
  const opts = useMemo(() => ({ week, filters, grouping }), [week, filters, grouping]);
  const rows = useMemo(() => buildRows(shownPlan, opts), [shownPlan, opts]);
  const compare = useMemo(
    () => (view === 'scenarios' && scen ? buildCompare(basePlan, scen.plan, opts, changedOnly) : null),
    [view, scen, opts, changedOnly],
  );
  const summary = useMemo(() => (scen ? horizonSummary(basePlan, scen.plan) : null), [scen]);
  const metrics = useMemo(() => COMPARE_METRICS.filter((k) => !compareHidden.has(k)), [compareHidden]);

  const hiringPlan = useMemo(
    () => (view === 'hiring' ? buildHiringPlan(shownPlan, dataset.plan.constants, dataset.plan.isoYear, outsourcerFilter) : null),
    [view, shownPlan, outsourcerFilter],
  );

  const unitCount = useMemo(() => dataset.units.filter(unitPredicate(filters)).length, [filters]);
  const weekLabel = basePlan.weeks[week - 1]?.label ?? '';

  const hiringTarget = useMemo<InspectorTarget | null>(() => {
    if (view !== 'hiring' || !hiringSel || !hiringPlan) return null;
    const c = hiringPlan.classes.find((x) => x.id === hiringSel.classId);
    if (!c) return null;
    const period = shownPlan.sites.find((sp) => sp.site.id === c.siteId)?.periods[c.productiveWeek - 1];
    const siteRows = buildRows(shownPlan, { week: c.productiveWeek, filters: ALL_FILTERS, grouping: 'none' });
    const row = siteRows.find((r) => r.siteId === c.siteId);
    if (!period || !row) return null;
    const focus = hiringSel.key === 'deficit' && !period.trace.some((x) => x.key === 'flow.hireable') ? 'flow.deficit' : HIRING_FOCUS[hiringSel.key];
    const value = period.trace.find((x) => x.key === focus)?.value ?? null;
    const shown: Formatted =
      focus === 'flow.startPeriod'
        ? { text: labelOfWeek(c.startWeek), tone: undefined }
        : formatValue(value, hiringSel.key === 'starters' ? 'int' : 'one');
    return {
      id: `${c.id}:${hiringSel.key}`,
      row,
      members: [],
      key: 'hireNeed',
      trace: { steps: period.trace, focus },
      shown,
      side: `Class ${c.startLabel.slice(5)}`,
      isInput: false,
      weekLabel: c.productiveLabel,
    };
  }, [view, hiringSel, hiringPlan, shownPlan]);

  const target = useMemo<InspectorTarget | null>(() => {
    if (view === 'hiring') return hiringTarget;
    if (!selected) return null;
    if (view === 'plans' || !compare || !active) return planTarget(rows, selected.side ? null : selected);
    const ref = selected as CompareRef;
    if (!ref.side) return null;
    if (ref.side === 'base') return planTarget(compare.baseRows, ref, 'Baseline');
    if (ref.side === 'scen') return planTarget(compare.scenRows, ref, active.name);
    const row = compare.rows.find((r) => r.id === ref.rowId);
    if (!row || ref.key === 'site' || ref.key === 'classStart') return null;
    const key = ref.key as NumericKey;
    const spec = columnSpec(key);
    const scenTarget = planTarget(compare.scenRows, ref, 'Change');
    if (!scenTarget) return null;
    return {
      ...scenTarget,
      id: `${row.id}:${key}:delta`,
      trace: deltaTrace(row, key, compare, active.name),
      shown: formatDelta(deltaOf(row, key), spec.format ?? 'one', key === 'overUnder'),
      isInput: false,
    };
  }, [selected, view, compare, active, rows, hiringTarget]);

  const exportView = useCallback(async () => {
    const wk = basePlan.weeks[week - 1];
    const ctx: ExportContext = {
      planName: PLAN_TITLE,
      scenarioName: active?.name ?? null,
      context: `Week ${wk?.label ?? ''} (from ${wk ? longDate.format(new Date(`${wk.start}T00:00:00Z`)) : ''}) · grouped by ${
        GROUPINGS.find((g) => g.id === grouping)?.label.toLowerCase() ?? 'outsourcer'
      } · ${filtersText(filters)}${isFiltered(filters) ? ' · supply split by share of required FTE' : ''}`,
      exportedOn: new Date().toISOString().slice(0, 10),
    };
    const scenarioPart = active?.name ?? 'Baseline';
    setExporting(true);
    try {
      if (view === 'hiring' && hiringPlan) {
        await downloadWorkbook(
          (lib) => hiringWorkbook(lib, hiringPlan, { ...ctx, context: 'Hiring plan for the full horizon' }, dataset.assumptions),
          fileName([PLAN_TITLE, scenarioPart, 'hiring-plan']),
        );
      } else if (view === 'scenarios' && active && scen && summary) {
        const all = buildCompare(basePlan, scen.plan, opts, false);
        await downloadWorkbook(
          (lib) =>
            compareWorkbook(lib, all, metrics, ctx, `Compare ${wk?.label ?? ''}`, {
              scenario: active,
              summary,
              assumptions: dataset.assumptions,
              siteName,
            }),
          fileName([PLAN_TITLE, scenarioPart, 'compare', wk?.label ?? '']),
        );
      } else if (view === 'plans') {
        const hp = buildHiringPlan(shownPlan, dataset.plan.constants, dataset.plan.isoYear);
        await downloadWorkbook(
          (lib) =>
            planWorkbook(lib, rows, hidden, ctx, `Plan ${wk?.label ?? ''}`, {
              hiring: hp,
              assumptions: dataset.assumptions,
              scenario: active,
              siteName,
            }),
          fileName([PLAN_TITLE, scenarioPart, wk?.label ?? '']),
        );
      }
    } finally {
      setExporting(false);
    }
  }, [week, active, grouping, filters, view, hiringPlan, scen, summary, opts, metrics, shownPlan, rows, hidden]);

  const canExport = view === 'plans' || view === 'hiring' || (view === 'scenarios' && active !== null);

  const toolbar = (
    choices: readonly ColumnKey[] | undefined,
    hiddenSet: ReadonlySet<ColumnKey>,
    onHidden: (h: ReadonlySet<ColumnKey>) => void,
    extra?: ReactNode,
  ) => (
    <Toolbar
      weeks={basePlan.weeks}
      week={week}
      onWeek={setWeek}
      grouping={grouping}
      onGrouping={setGrouping}
      filters={filters}
      onFilters={setFilters}
      hidden={hiddenSet}
      onHidden={onHidden}
      columnChoices={choices}
    >
      {extra}
    </Toolbar>
  );

  let main: ReactNode;
  if (view === 'hiring' && hiringPlan) {
    main = (
      <HiringView
        hp={hiringPlan}
        scenarioName={active?.name ?? null}
        trainingAttrition={dataset.plan.constants.trainingAttrition}
        outsourcers={dataset.outsourcers}
        outsourcerFilter={outsourcerFilter}
        onOutsourcerFilter={setOutsourcerFilter}
        grouping={hiringGrouping}
        onGrouping={setHiringGrouping}
        selected={hiringSel}
        onSelect={selectClass}
      />
    );
  } else if (view === 'plans') {
    main = (
      <>
        {toolbar(undefined, hidden, setHidden)}
        <div className="grid-scroll">
          <Grid
            rows={rows}
            grouping={grouping}
            allocated={isFiltered(filters)}
            hidden={hidden}
            selected={selected && !selected.side ? selected : null}
            onSelect={select}
          />
        </div>
      </>
    );
  } else if (!active || !scen || !compare || !summary) {
    main = (
      <div className="empty-view">
        <h2>Compare a scenario with the locked plan</h2>
        <p>
          A scenario forks from {PLAN.name} {PLAN.version}. Override volume, AHT, shrinkage, attrition or a site's headcount cap;
          the baseline stays locked, and every change shows beside it as baseline, scenario and delta.
        </p>
        <button className="primary-button" onClick={fork}>
          Fork scenario from {PLAN.version}
        </button>
        {scenarios.length > 0 && (
          <div className="scenario-list">
            {scenarios.map((s) => (
              <button key={s.id} onClick={() => activate(s.id)}>
                <span>{s.name}</span>
                <span className="tl-key">
                  {s.overrides.length} override{s.overrides.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    main = (
      <>
        <ScenarioBar
          scenario={active}
          sites={dataset.plan.sites}
          outsourcers={dataset.outsourcers}
          horizon={HORIZON}
          summary={summary}
          calcMs={scen.ms}
          onAdd={addOverride}
          onRemove={removeOverride}
          onDiscard={discard}
        />
        {toolbar(
          COMPARE_METRICS,
          compareHidden,
          setCompareHidden,
          <div className="tl-seg compare-note">
            <span className="ov-seg" role="group" aria-label="Rows">
              <button aria-pressed={changedOnly} onClick={() => setChangedOnly(true)}>
                Changed rows
              </button>
              <button aria-pressed={!changedOnly} onClick={() => setChangedOnly(false)}>
                All rows
              </button>
            </span>
            <span className="tl-key">
              <span className="tl-num">{compare.changedSites}</span> of <span className="tl-num">{compare.totalSites}</span> sites changed
            </span>
          </div>,
        )}
        <div className="grid-scroll">
          {compare.rows.length > 0 ? (
            <CompareGrid
              rows={compare.rows}
              metrics={metrics}
              grouping={grouping}
              scenarioName={active.name}
              selected={selected && selected.side ? (selected as CompareRef) : null}
              onSelect={select}
            />
          ) : (
            <div className="grid-empty">
              No site differs from the baseline in {weekLabel}.{' '}
              {active.overrides.length === 0 ? 'Add an override above.' : 'Try another week, or show all rows.'}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className={`shell ${inspectorOpen ? '' : 'inspector-collapsed'}`}>
      <TopBar
        weeks={basePlan.weeks}
        scenarios={scenarios}
        activeId={activeId}
        onActivate={activate}
        onFork={fork}
        onExport={canExport ? () => void exportView() : undefined}
        exporting={exporting}
      />
      <Rail view={view} onView={changeView} locked={!active} sites={dataset.plan.sites.length} units={dataset.units.length} />
      <main className="main">{main}</main>
      <Inspector open={inspectorOpen} onToggle={toggleInspector} target={target} weekLabel={weekLabel} labelOfWeek={labelOfWeek} />
      <StatusBar
        engineName={engine.name}
        calcMs={scen ? scen.ms : baseMs}
        siteWeeks={basePlan.sites.length * basePlan.weeks.length}
        sitesShown={rows.filter((r) => r.kind === 'site').length}
        units={unitCount}
        weekLabel={weekLabel}
        scenario={active?.name ?? null}
      />
    </div>
  );
}
