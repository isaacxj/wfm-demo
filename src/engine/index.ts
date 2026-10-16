/**
 * Public engine interface.
 *
 * The UI imports from here and nowhere else in this folder. This is a
 * textbook implementation; a replacement engine implements CapacityEngine and
 * is swapped in below without the UI changing.
 */
import { intervalStaffing, type IntervalInput, type IntervalResult } from './erlang.ts';
import { computePlan, type PlanInput, type PlanResult } from './plan.ts';
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
  computePlan(input: PlanInput): PlanResult;
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
  computePlan,
};

export const engine: CapacityEngine = textbookEngine;

export type { TraceStep, Unit } from './trace.ts';
export type { Channel, RequirementInput, RequirementResult } from './requirement.ts';
export type { IntervalInput, IntervalResult } from './erlang.ts';
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
export { periodLabel, periodStart, isoWeekLabel, toIsoDate } from './calendar.ts';
