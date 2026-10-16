/**
 * Public engine interface.
 *
 * The UI imports from here and nowhere else in this folder. This is a
 * textbook implementation; a replacement engine implements CapacityEngine and
 * is swapped in below without the UI changing.
 */
import { intervalStaffing, type IntervalInput, type IntervalResult } from './erlang.ts';
import { computePlan, type PlanInput, type PlanResult, type PlanningUnit, type SitePeriod } from './plan.ts';
import { siteWeek, type SiteWeekInput, type SiteWeekResult } from './siteweek.ts';
import { sliceSitePeriod, type SiteSlice } from './slice.ts';
import {
  effectiveChatAht,
  periodRequirement,
  rosteredFromProductive,
  type RequirementInput,
  type RequirementResult,
} from './requirement.ts';
import {
  hiringNeed,
  periodAttritionRate,
  rollForward,
  type AttritionRateResult,
  type HiringInput,
  type HiringResult,
  type RollForwardInput,
  type RollForwardResult,
} from './supply.ts';

export interface CapacityEngine {
  readonly name: string;
  periodRequirement(input: RequirementInput): RequirementResult;
  intervalStaffing(input: IntervalInput): IntervalResult;
  effectiveChatAht(aht: number, concurrency: number, efficiency?: number): number;
  rosteredFromProductive(productiveFte: number, shrinkage: number): number;
  periodAttritionRate(monthlyRate: number, periodsPerMonth?: number): AttritionRateResult;
  rollForward(input: RollForwardInput): RollForwardResult;
  hiringNeed(input: HiringInput): HiringResult;
  siteWeek(input: SiteWeekInput): SiteWeekResult;
  computePlan(input: PlanInput): PlanResult;
  sliceSitePeriod(period: SitePeriod, include: (unit: PlanningUnit) => boolean): SiteSlice | null;
}

export const textbookEngine: CapacityEngine = {
  name: 'Textbook capacity model v1',
  periodRequirement,
  intervalStaffing,
  effectiveChatAht,
  rosteredFromProductive,
  periodAttritionRate: (monthlyRate, periodsPerMonth) => periodAttritionRate(monthlyRate, periodsPerMonth),
  rollForward,
  hiringNeed,
  siteWeek,
  computePlan,
  sliceSitePeriod,
};

export const engine: CapacityEngine = textbookEngine;

export type { Ref, TracePart, TraceStep, Unit } from './trace.ts';
export { TraceBuilder } from './trace.ts';
export type { Channel, RequirementInput, RequirementResult } from './requirement.ts';
export type { IntervalInput, IntervalResult } from './erlang.ts';
export type { SiteWeekInput, SiteWeekResult } from './siteweek.ts';
export type { SiteSlice } from './slice.ts';
export type { AttritionRateResult, HiringInput, HiringResult, RollForwardInput, RollForwardResult } from './supply.ts';
export type {
  DemandCell,
  PlanConstants,
  PlanInput,
  PlanResult,
  PlanWeek,
  PlanningUnit,
  SiteInput,
  SitePeriod,
  SitePlan,
  UnitPeriod,
} from './plan.ts';
export { DEFAULT_CHAT_EFFICIENCY } from './requirement.ts';
export { WEEKS_PER_MONTH } from './supply.ts';
export { unitLabel } from './plan.ts';
export { periodLabel, periodStart, isoWeekLabel, toIsoDate } from './calendar.ts';
