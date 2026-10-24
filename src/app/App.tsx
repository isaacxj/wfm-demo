import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { demoDataset } from '../data/dataset.ts';
import { buildActuals } from '../data/actuals.ts';
import { engine, periodLabel, TraceBuilder, type PlanResult } from '../engine/index.ts';
import { applyScenario, describeEffect, describeEventScope, parseStoredScenarios, type BulkOverride, type EventOverride, type Scenario } from '../scenario/scenario.ts';
import { BulkEntry } from './components/BulkEntry.tsx';
import { buildCompare, COMPARE_METRICS, DEFAULT_COMPARE_HIDDEN, deltaOf, deltaTrace, horizonSummary } from './compare.ts';
import { CompareGrid, type CompareRef } from './components/CompareGrid.tsx';
import { HiringView, type HiringGrouping, type HiringKey, type HiringRef } from './components/HiringView.tsx';
import { Grid, type CellRef } from './components/Grid.tsx';
import { Inspector, periodTarget, planTarget, type InspectorTarget } from './components/Inspector.tsx';
import { Rail, type View } from './components/Rail.tsx';
import { ScenarioBar, type DraftOverride } from './components/ScenarioBar.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { PeriodsGrid, varianceRowId, type Density } from './components/PeriodsGrid.tsx';
import { Toolbar, type GridMode } from './components/Toolbar.tsx';
import { buildPeriodRows, DEFAULT_PERIOD_METRIC, isPeriodMetric } from './periods.ts';
import { TopBar } from './components/TopBar.tsx';
import { compareWorkbook, fileName, hiringWorkbook, periodsWorkbook, planWorkbook, type ExportContext } from '../export/xlsx.ts';
import { downloadWorkbook } from '../export/download.ts';
import { formatDelta, formatValue, type Formatted } from './format.ts';
import { buildHiringPlan, type HiringClass } from './hiring.ts';
import { contribution, eventImpact, eventsInRow, EVENT_TYPE_LABEL, withoutEvent } from './events.ts';
import { EventsView, type EventDraft } from './components/EventsView.tsx';
import {
  ALL_FILTERS,
  buildRows,
  filterValueLabel,
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
const actuals = engine.computeActuals(dataset.plan, buildActuals(dataset.plan, basePlan));
const labelOfWeek = (index: number) => periodLabel(dataset.plan.isoYear, index);
const HORIZON = dataset.plan.weeks.length;
const siteName = (id: string) => dataset.plan.sites.find((s) => s.id === id)?.name ?? id;
const PLAN_TITLE = `${PLAN.name} ${PLAN.version}`;
const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function filtersText(filters: Filters): string {
  if (!isFiltered(filters)) return 'all business units, languages, channels and staff types';
  return FILTER_DIMENSIONS.filter((d) => filters[d.key].length < d.values.length)
    .map((d) => `${d.label.toLowerCase()} ${filters[d.key].map((v) => filterValueLabel(d.key, v)).join(', ')}`)
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

const MODE_KEY = 'capacity-planner.grid-mode';
const VARIANCE_KEY = 'capacity-planner.variance-rows';
const VARIANCE_PREFIX = varianceRowId('');
const DENSITY_KEY = 'capacity-planner.density';

/** Per-session preference: survives reloads in this tab, not across sessions. */
function readSession<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.sessionStorage.getItem(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Preference only; ignore storage failures.
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

function newScenario(list: readonly Scenario[]): Scenario {
  const n = list.reduce((m, s) => Math.max(m, Number(s.code.replace(/\D/g, '')) || 0), 0) + 1;
  return { id: `s${n}`, code: `SC${n}`, name: `Scenario ${n}`, forkedFrom: `${PLAN.name} ${PLAN.version}`, overrides: [] };
}

/** Starters moved into a week, and the graduates they deliver, for a class made only of them. */
function movedClassTrace(c: HiringClass, trainingAttrition: number, code: string) {
  const t = new TraceBuilder();
  const starters = t.input('starters', 'Starters moved earlier', c.starters, 'heads');
  t.note('starters', c.moved.map((m) => `For ${labelOfWeek(m.forWeek).slice(5)}: ${m.reason}`).join('; '));
  const attr = t.input('trainingAttrition', 'Training attrition', trainingAttrition, 'ratio', code);
  t.calc('graduates', 'Graduates', c.starters * (1 - trainingAttrition), 'heads', 'starters × (1 − training attrition)', `${starters.expr}*(1-${attr.expr})`, [starters, attr]);
  return t.steps;
}

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
  const [gridMode, setGridMode] = useState<GridMode>(() => readSession<GridMode>(MODE_KEY, ['periods', 'metrics'], 'periods'));
  const [density, setDensity] = useState<Density>(() => readSession<Density>(DENSITY_KEY, ['comfortable', 'compact'], 'comfortable'));
  const [periodMetric, setPeriodMetric] = useState<NumericKey>(DEFAULT_PERIOD_METRIC);
  const [paused, setPaused] = useState(false);
  /** The scenario as last calculated, held while recalculation is paused. */
  const [calculated, setCalculated] = useState<Scenario | null>(null);
  const [runs, setRuns] = useState(1);
  /** Edits made while paused, each add or remove counted. */
  const [edits, setEdits] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  /** Event the planner opened from the register or an annotation: named first in the inspector. */
  const [focusEvent, setFocusEvent] = useState<string | null>(null);
  const [showVariance, setShowVariance] = useState<boolean>(() => readSession(VARIANCE_KEY, ['on', 'off'], 'on') === 'on');

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

  // Switching scenario is not an edit: a paused plan holds the newly opened scenario as calculated.
  useEffect(() => {
    if (paused) setCalculated(active);
  }, [active?.id]); // keyed on the scenario, not its edits

  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (!p) setCalculated(active);
      return !p;
    });
    setEdits(0);
  }, [active]);

  /** What the engine calculates: the live scenario, or the held one while paused. */
  const toCalculate = paused && calculated && active && calculated.id === active.id ? calculated : active;
  const staged = useMemo(() => {
    if (toCalculate === active || !toCalculate || !active) return null;
    const before = new Set(toCalculate.overrides.map((o) => o.code));
    const after = new Set(active.overrides.map((o) => o.code));
    return {
      added: new Set([...after].filter((c) => !before.has(c))),
      removed: toCalculate.overrides.filter((o) => !after.has(o.code)),
    };
  }, [toCalculate, active]);
  const pending = paused ? edits : 0;

  const fork = useCallback(() => {
    setScenarios((list) => {
      const sc = newScenario(list);
      setActiveId(sc.id);
      return [...list, sc];
    });
    setView('scenarios');
    setSelected(null);
  }, []);

  /** Adds overrides to the open scenario in one change, so one recalculation. On the locked plan it forks a scenario. */
  const addDrafts = useCallback(
    (drafts: (Omit<BulkOverride, 'code'> | Omit<EventOverride, 'code'>)[]) => {
      if (drafts.length === 0) return;
      if (paused) setEdits((n) => n + drafts.length);
      const withCodes = (s: Scenario): Scenario => {
        const first = s.overrides.reduce((m, o) => Math.max(m, Number(o.code.split('.OV')[1]) || 0), 0) + 1;
        return {
          ...s,
          overrides: [...s.overrides, ...drafts.map((d, i) => ({ ...d, code: `${s.code}.OV${first + i}` }) as Scenario['overrides'][number])],
        };
      };
      setScenarios((list) => {
        if (activeId && list.some((s) => s.id === activeId)) return list.map((s) => (s.id === activeId ? withCodes(s) : s));
        const sc = withCodes(newScenario(list));
        setActiveId(sc.id);
        return [...list, sc];
      });
    },
    [activeId, paused],
  );

  /** Bulk entry closes: one override per edited metric. */
  const applyBulk = useCallback(
    (drafts: Omit<BulkOverride, 'code'>[]) => {
      setBulkOpen(false);
      addDrafts(drafts);
    },
    [addDrafts],
  );

  const updateActive = useCallback(
    (fn: (s: Scenario) => Scenario) => setScenarios((list) => list.map((s) => (s.id === activeId ? fn(s) : s))),
    [activeId],
  );

  const addOverride = useCallback(
    (draft: DraftOverride) => {
      if (paused) setEdits((n) => n + 1);
      updateActive((s) => {
        const n = s.overrides.reduce((m, o) => Math.max(m, Number(o.code.split('.OV')[1]) || 0), 0) + 1;
        return { ...s, overrides: [...s.overrides, { ...draft, code: `${s.code}.OV${n}` } as Scenario['overrides'][number]] };
      });
    },
    [updateActive, paused],
  );

  const removeOverride = useCallback(
    (code: string) => {
      if (paused) setEdits((n) => n + 1);
      updateActive((s) => ({ ...s, overrides: s.overrides.filter((o) => o.code !== code) }));
    },
    [updateActive, paused],
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

  const changeMode = useCallback(
    (m: GridMode) => {
      writeSession(MODE_KEY, m);
      setGridMode(m);
      // Keep the selected number in view: Periods shows one metric, so show the selected one.
      if (m === 'periods' && selected && !selected.side && isPeriodMetric(selected.key)) setPeriodMetric(selected.key);
      // Metrics has no variance rows: keep the row the variance belongs to.
      if (m === 'metrics' && selected && !selected.side && selected.rowId.startsWith(VARIANCE_PREFIX)) {
        setSelected({ rowId: selected.rowId.slice(VARIANCE_PREFIX.length), key: selected.key });
      }
    },
    [selected],
  );

  /** Periods shows one metric: changing it keeps the selected row and week, on the new metric. */
  const changePeriodMetric = useCallback((m: NumericKey) => {
    setPeriodMetric(m);
    setSelected((sel) => (sel && !sel.side ? { rowId: sel.rowId, key: m } : sel));
  }, []);

  const toggleVariance = useCallback(() => {
    setShowVariance((on) => {
      writeSession(VARIANCE_KEY, on ? 'off' : 'on');
      return !on;
    });
    setSelected((sel) => (sel && !sel.side && sel.rowId.startsWith(VARIANCE_PREFIX) ? null : sel));
  }, []);

  const changeDensity = useCallback((d: Density) => {
    writeSession(DENSITY_KEY, d);
    setDensity(d);
  }, []);

  const selectPeriodCell = useCallback(
    (rowId: string, w: number) => {
      setWeek(w);
      setSelected({ rowId, key: periodMetric });
      setInspectorOpen(true);
    },
    [periodMetric],
  );

  const selectClass = useCallback((ref: HiringRef | null) => {
    setHiringSel(ref);
    if (ref) setInspectorOpen(true);
  }, []);

  // Computation -------------------------------------------------------------------

  /** The inputs the engine calculates: the open scenario's, or the locked plan's. */
  const calcInput = useMemo(() => (toCalculate ? applyScenario(dataset.plan, toCalculate) : dataset.plan), [toCalculate]);
  const scen = useMemo<{ plan: PlanResult; ms: number } | null>(() => {
    if (!toCalculate) return null;
    const start = performance.now();
    const plan = engine.computePlan(calcInput);
    return { plan, ms: performance.now() - start };
  }, [toCalculate, calcInput]);
  const events = useMemo(() => calcInput.events ?? [], [calcInput]);
  const shownPlan = scen?.plan ?? basePlan;

  // The plan with one event switched off, worked out when first asked for and kept until the inputs change.
  const withoutCache = useMemo(() => new Map<string, PlanResult>(), [calcInput]);
  const planWithout = useCallback(
    (code: string) => {
      let p = withoutCache.get(code);
      if (!p) {
        p = engine.computePlan(withoutEvent(calcInput, code));
        withoutCache.set(code, p);
      }
      return p;
    },
    [withoutCache, calcInput],
  );

  /**
   * Shows an event where it acts: the Periods grid, a week the event is in, and
   * the inspector naming it. From the register, the week it adds most to total
   * Required FTE, on that metric's grand total; from an annotation, the
   * selected row and metric, at the focus week if it is one of the event's.
   */
  const showEvent = useCallback(
    (code: string, fromRegister: boolean) => {
      const e = events.find((x) => x.code === code);
      if (!e) return;
      setView('plans');
      writeSession(MODE_KEY, 'periods');
      setGridMode('periods');
      setFocusEvent(code);
      setInspectorOpen(true);
      if (fromRegister) {
        setWeek(eventImpact(shownPlan, planWithout(code), e).peakWeek);
        setPeriodMetric('required');
        setSelected({ rowId: 'total', key: 'required' });
        return;
      }
      setWeek((w) => (w >= e.fromWeek && w <= e.toWeek ? w : e.fromWeek));
      setSelected((sel) => ({
        rowId: sel && !sel.side && !sel.rowId.startsWith(VARIANCE_PREFIX) ? sel.rowId : 'total',
        key: periodMetric,
      }));
    },
    [events, shownPlan, planWithout, periodMetric],
  );

  /** Switches a plan event off in the scenario, or back on by dropping the override that switched it off. */
  const switchEvent = useCallback(
    (code: string, on: boolean) => {
      if (!on) return addDrafts([{ kind: 'event', scope: { type: 'all' }, remove: code }]);
      const o = active?.overrides.find((x) => x.kind === 'event' && x.remove === code);
      if (o) removeOverride(o.code);
    },
    [addDrafts, active, removeOverride],
  );
  useEffect(() => {
    if (scen) setRuns((n) => n + 1);
  }, [scen]);

  const opts = useMemo(() => ({ week, filters, grouping }), [week, filters, grouping]);
  const rows = useMemo(() => buildRows(shownPlan, opts), [shownPlan, opts]);
  const periodModel = useMemo(
    () =>
      view === 'plans' && gridMode === 'periods'
        ? buildPeriodRows(basePlan, filters, grouping, { actuals, scenario: scen?.plan ?? null })
        : null,
    [view, gridMode, scen, filters, grouping],
  );
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
    const own = period.flow.hiresToStart > 0 && period.flow.startPeriod === c.startWeek;
    const sized = hiringSel.key === 'starters' || hiringSel.key === 'graduates' || hiringSel.key === 'deficit';
    // A class made only of starters moved here from a later week: its own short chain, starters to graduates.
    const movedTrace = !own && sized ? movedClassTrace(c, dataset.plan.constants.trainingAttrition, dataset.plan.constants.codes.trainingAttrition) : null;
    const focus = movedTrace
      ? (hiringSel.key === 'starters' ? 'starters' : 'graduates')
      : hiringSel.key === 'deficit' && !period.trace.some((x) => x.key === 'flow.hireable')
        ? 'flow.deficit'
        : HIRING_FOCUS[hiringSel.key];
    const classValue = hiringSel.key === 'starters' ? c.starters : hiringSel.key === 'graduates' ? c.graduates : hiringSel.key === 'deficit' ? c.deficit : null;
    const shown: Formatted =
      classValue !== null
        ? formatValue(classValue, hiringSel.key === 'starters' ? 'int' : 'one')
        : { text: labelOfWeek(focus === 'flow.startPeriod' ? c.startWeek : c.productiveWeek), tone: undefined };
    const extraNotes: InspectorTarget['extraNotes'] = [];
    if (c.classCount > 1) {
      extraNotes.push({
        tag: 'SPLIT',
        tone: 'info',
        text: `Class ${c.classIndex} of ${c.classCount} starting ${c.startLabel.slice(5)} at ${c.siteName}, at most ${hiringPlan.maxClassSize} a class. The chain below is for the site-week.`,
      });
    }
    for (const m of c.moved) {
      extraNotes.push({
        tag: 'MOVED',
        tone: 'warn',
        text: `${m.starters} starters for ${labelOfWeek(m.forWeek).slice(5)} start ${labelOfWeek(m.startWeek).slice(5)}: ${m.reason}.`,
      });
    }
    return {
      id: `${c.id}:${hiringSel.key}`,
      row,
      members: [],
      key: 'hireNeed',
      trace: { steps: movedTrace ?? period.trace, focus },
      shown,
      side: `Class ${c.startLabel.slice(5)}`,
      isInput: false,
      weekLabel: c.productiveLabel,
      extraNotes,
    };
  }, [view, hiringSel, hiringPlan, shownPlan]);

  const baseTarget = useMemo<InspectorTarget | null>(() => {
    if (view === 'hiring') return hiringTarget;
    if (!selected) return null;
    if (view === 'plans' && periodModel) {
      if (selected.side) return null;
      return periodTarget(periodModel, selected, week, { scenario: active?.name ?? null, weekLabel }, VARIANCE_PREFIX);
    }
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
  }, [selected, view, compare, active, rows, hiringTarget, periodModel, week, weekLabel]);

  const target = useMemo<InspectorTarget | null>(() => {
    const t = baseTarget;
    if (!t || view !== 'plans' || t.side === 'Variance' || t.side === 'Actual' || t.key === 'site' || t.key === 'classStart') return t;
    // Name every registered event in effect for this row and week, and what it adds to this number.
    const key = t.key as NumericKey;
    const spec = columnSpec(key);
    const fmt = (v: number) => formatValue(v, spec.format === 'int' ? 'int' : 'one').text;
    const delta = (v: number) => formatDelta(v, spec.format ?? 'one', false).text;
    const named = eventsInRow(shownPlan, events, t.row, t.members, week, filters).sort((a, b) =>
      a.code === focusEvent ? -1 : b.code === focusEvent ? 1 : a.code.localeCompare(b.code),
    );
    if (named.length === 0) return t;
    const notes = named.map((e) => {
      const c = contribution(shownPlan, planWithout(e.code), t.row.id, key, opts);
      const effect = c
        ? ` Contributes ${delta(c.with - c.without)} to this ${spec.header} (${fmt(c.without)} without it).`
        : '';
      return {
        tag: 'EVENT',
        tone: 'info' as const,
        text: `${e.code} ${e.name} · ${EVENT_TYPE_LABEL[e.type]} · ${describeEventScope(e.scope, siteName)} · W${String(e.fromWeek).padStart(2, '0')}–W${String(e.toWeek).padStart(2, '0')} · ${describeEffect(e)}.${effect}`,
      };
    });
    return { ...t, id: `${t.id}:ev`, extraNotes: [...notes, ...(t.extraNotes ?? [])] };
  }, [baseTarget, view, events, shownPlan, week, filters, focusEvent, planWithout, opts]);


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
              events,
              siteName,
            }),
          fileName([PLAN_TITLE, scenarioPart, 'compare', wk?.label ?? '']),
        );
      } else if (view === 'plans' && periodModel) {
        const hp = buildHiringPlan(shownPlan, dataset.plan.constants, dataset.plan.isoYear);
        const metricName = columnSpec(periodMetric).header;
        await downloadWorkbook(
          (lib) =>
            periodsWorkbook(
              lib,
              periodModel,
              basePlan.weeks,
              periodMetric,
              { ...ctx, context: ctx.context.replace(/^Week [^·]*· /, `${metricName} by week · `) },
              `${metricName.replace('/', '-')} by week`,
              { hiring: hp, assumptions: dataset.assumptions, scenario: active, siteName, events },
            ),
          fileName([PLAN_TITLE, scenarioPart, metricName.replace('/', '-'), 'by-week']),
        );
      } else if (view === 'plans') {
        const hp = buildHiringPlan(shownPlan, dataset.plan.constants, dataset.plan.isoYear);
        await downloadWorkbook(
          (lib) =>
            planWorkbook(lib, rows, hidden, ctx, `Plan ${wk?.label ?? ''}`, {
              hiring: hp,
              assumptions: dataset.assumptions,
              events,
              scenario: active,
              siteName,
            }),
          fileName([PLAN_TITLE, scenarioPart, wk?.label ?? '']),
        );
      }
    } finally {
      setExporting(false);
    }
  }, [week, active, grouping, filters, view, hiringPlan, scen, summary, opts, metrics, shownPlan, rows, hidden, periodModel, periodMetric, events]);

  const canExport = view === 'plans' || view === 'hiring' || (view === 'scenarios' && active !== null);

  const toolbar = (
    choices: readonly ColumnKey[] | undefined,
    hiddenSet: ReadonlySet<ColumnKey>,
    onHidden: (h: ReadonlySet<ColumnKey>) => void,
    extra?: ReactNode,
    withMode = false,
    note?: string,
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
      mode={withMode ? gridMode : undefined}
      onMode={withMode ? changeMode : undefined}
      density={density}
      onDensity={changeDensity}
      metric={periodMetric}
      onMetric={changePeriodMetric}
      note={note}
      paused={paused}
      pending={pending}
      onPause={togglePause}
      onBulk={() => setBulkOpen(true)}
    >
      {extra}
    </Toolbar>
  );

  let main: ReactNode;
  if (view === 'events') {
    const scenarioEvents = active?.overrides.filter((o): o is EventOverride => o.kind === 'event') ?? [];
    main = (
      <EventsView
        planEvents={dataset.plan.events ?? []}
        added={scenarioEvents.filter((o) => o.add).map((o) => ({ ...o.add!, code: o.code }))}
        off={new Set(scenarioEvents.flatMap((o) => (o.remove ? [o.remove] : [])))}
        impact={(code) => (events.some((e) => e.code === code) ? eventImpact(shownPlan, planWithout(code), events.find((e) => e.code === code)!) : null)}
        scenarioName={active?.name ?? null}
        sites={dataset.plan.sites}
        outsourcers={dataset.outsourcers}
        businessUnits={FILTER_DIMENSIONS[0].values}
        horizon={HORIZON}
        onShow={(code) => showEvent(code, true)}
        onSwitch={switchEvent}
        onAdd={(draft: EventDraft) => addDrafts([{ kind: 'event', scope: { type: 'all' }, add: draft }])}
        onRemoveAdded={removeOverride}
      />
    );
  } else if (view === 'hiring' && hiringPlan) {
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
  } else if (view === 'plans' && periodModel) {
    main = (
      <>
        {toolbar(
          undefined,
          hidden,
          setHidden,
          <div className="tl-seg">
            <span className="seg-group" role="group" aria-label="Variance">
              <button aria-pressed={showVariance} onClick={toggleVariance} title="A row under each row: actual − plan in elapsed weeks, scenario − plan after">
                Variance rows
              </button>
            </span>
          </div>,
          true,
        )}
        <div className="grid-scroll">
          <PeriodsGrid
            model={periodModel}
            weeks={basePlan.weeks}
            metric={periodMetric}
            grouping={grouping}
            density={density}
            focusWeek={week}
            selected={selected && !selected.side ? selected : null}
            onSelect={selectPeriodCell}
            showVariance={showVariance}
            planName={PLAN_TITLE}
            scenarioName={active?.name ?? null}
            events={events}
            onEvent={(code) => showEvent(code, false)}
          />
        </div>
      </>
    );
  } else if (view === 'plans') {
    main = (
      <>
        {toolbar(
          undefined,
          hidden,
          setHidden,
          undefined,
          true,
          week <= actuals.throughWeek ? `${weekLabel.slice(5)} has elapsed: plan figures shown, actuals in Periods` : undefined,
        )}
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
          staged={staged ?? undefined}
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
    <div className={`shell ${inspectorOpen ? '' : 'inspector-collapsed'}`} data-density={density}>
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
      <main className="main" data-stale={pending > 0 ? '' : undefined}>
        {main}
      </main>
      {bulkOpen && (
        <BulkEntry
          input={active ? applyScenario(dataset.plan, active) : dataset.plan}
          week={week}
          firstPlannedWeek={actuals.throughWeek + 1}
          scenarioName={active?.name ?? null}
          onApply={applyBulk}
          onCancel={() => setBulkOpen(false)}
        />
      )}
      <Inspector open={inspectorOpen} onToggle={toggleInspector} target={target} weekLabel={weekLabel} labelOfWeek={labelOfWeek} />
      <StatusBar
        engineName={engine.name}
        calcMs={scen ? scen.ms : baseMs}
        siteWeeks={basePlan.sites.length * basePlan.weeks.length}
        sitesShown={rows.filter((r) => r.kind === 'site').length}
        units={unitCount}
        weekLabel={weekLabel}
        scenario={active?.name ?? null}
        paused={paused}
        pending={pending}
        runs={runs}
      />
    </div>
  );
}
