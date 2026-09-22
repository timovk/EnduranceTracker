/**
 * The adaptive budget allocator.
 *
 * Exercises the PURE core (`allocateWeeks`, `projectYearEndHours`), so year
 * transitions, rest weeks and mid-week starts are covered exhaustively without
 * a database or a clock.
 */

import { describe, expect, it } from 'vitest';
import {
  allocateWeeks, projectYearEndHours,
  type WeekAllocationInput, type WeekDemandInput,
} from '@/lib/engines/budget-engine';
import { BUDGET_CONFIG } from '@/lib/config';

const DAY = 86_400_000;

function demandWeek(index: number, overrides: Partial<WeekDemandInput> = {}): WeekDemandInput {
  const weekStart = new Date(2026, 0, 5 + index * 7);
  return {
    isoYear: 2026,
    isoWeek: index + 2,
    weekStart,
    weekEnd: new Date(weekStart.getTime() + 7 * DAY),
    isCurrent: index === 0,
    isRestWeek: false,
    actualHours: 0,
    scheduledRaces: 0,
    majorEventNames: [],
    highPriorityRaces: 0,
    mustWatchRaces: 0,
    activeChallenges: 0,
    seasonPassOpportunity: false,
    ...overrides,
  };
}

function plan(count: number, overrides: Record<number, Partial<WeekDemandInput>> = {}): WeekDemandInput[] {
  return Array.from({ length: count }, (_, i) => demandWeek(i, overrides[i] ?? {}));
}

function input(overrides: Partial<WeekAllocationInput> = {}): WeekAllocationInput {
  return {
    annualBudgetHours: 336,
    weeklyTargetHours: 8,
    usedHours: 0,
    weeksRemaining: 40,
    backlogHours: 0,
    partiallyWatchedRaces: 0,
    recentWeeklyHours: [],
    weeks: plan(8),
    ...overrides,
  };
}

describe('allocateWeeks — the budget is allocated, not divided', () => {
  it('does not give every week the same number of hours', () => {
    const result = allocateWeeks(input({
      weeks: plan(8, {
        2: { majorEventNames: ['24 Hours of Le Mans'], scheduledRaces: 1 },
      }),
    }));

    const distinct = new Set(result.map((w) => w.recommendedHours.toFixed(2)));
    expect(distinct.size).toBeGreaterThan(1);
    // Specifically: the Le Mans week gets more than a quiet one.
    expect(result[2]!.recommendedHours).toBeGreaterThan(result[6]!.recommendedHours);
  });

  it('may recommend more than eight hours for a major event week', () => {
    const result = allocateWeeks(input({
      backlogHours: 60,
      weeks: plan(6, {
        0: {
          majorEventNames: ['24 Hours of Le Mans'],
          scheduledRaces: 2,
          mustWatchRaces: 1,
          highPriorityRaces: 1,
        },
      }),
    }));

    expect(result[0]!.recommendedHours).toBeGreaterThan(BUDGET_CONFIG.weeklyTargetHours);
    expect(result[0]!.recommendedHours).toBeLessThanOrEqual(BUDGET_CONFIG.maxMajorEventWeeklyHours);
    expect(result[0]!.capHours).toBe(BUDGET_CONFIG.maxMajorEventWeeklyHours);
  });

  it('keeps an ordinary week under the ordinary ceiling', () => {
    // Even with an absurdly generous budget, a quiet week stays sensible.
    const result = allocateWeeks(input({ annualBudgetHours: 5000, weeksRemaining: 4, weeks: plan(4) }));
    for (const week of result) {
      expect(week.recommendedHours).toBeLessThanOrEqual(BUDGET_CONFIG.maxWeeklyHours);
      expect(week.capHours).toBe(BUDGET_CONFIG.maxWeeklyHours);
    }
  });

  it('allocates a rest week exactly zero', () => {
    const result = allocateWeeks(input({ weeks: plan(6, { 1: { isRestWeek: true } }) }));
    expect(result[1]!.recommendedHours).toBe(0);
    expect(result[1]!.isRestWeek).toBe(true);
    expect(result[1]!.rationale.join(' ').toLowerCase()).toContain('rest');
  });

  it('redistributes a rest week across the weeks around it', () => {
    const withRest = allocateWeeks(input({ weeks: plan(6, { 1: { isRestWeek: true } }) }));
    const without = allocateWeeks(input({ weeks: plan(6) }));

    // The hours are not simply lost: the remaining weeks come up.
    const restOthers = withRest.filter((_, i) => i !== 1).reduce((s, w) => s + w.recommendedHours, 0);
    const plainOthers = without.filter((_, i) => i !== 1).reduce((s, w) => s + w.recommendedHours, 0);
    expect(restOthers).toBeGreaterThan(plainOthers);
  });

  it('never recommends a negative number of hours', () => {
    const result = allocateWeeks(input({ usedHours: 400, annualBudgetHours: 336 }));
    for (const week of result) {
      expect(week.recommendedHours).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps suggesting a week even once the annual budget is spent', () => {
    // Going over is allowed and neutral. The plan never becomes a stop sign.
    const spent = allocateWeeks(input({ usedHours: 336 }));
    expect(spent.some((w) => w.recommendedHours > 0)).toBe(true);
  });

  it('responds to backlog pressure', () => {
    const light = allocateWeeks(input({ backlogHours: 0 }));
    const heavy = allocateWeeks(input({ backlogHours: 200, partiallyWatchedRaces: 6 }));
    expect(heavy[0]!.demandFactor).toBeGreaterThan(light[0]!.demandFactor);
  });

  it('suggests a lighter week after a heavy run', () => {
    const afterHeavy = allocateWeeks(input({ recentWeeklyHours: [14, 15, 13, 16] }));
    const afterCalm = allocateWeeks(input({ recentWeeklyHours: [3, 2, 4, 3] }));
    expect(afterHeavy[0]!.demandFactor).toBeLessThan(afterCalm[0]!.demandFactor);
  });

  it('clamps the demand factor within its configured bounds', () => {
    const extreme = allocateWeeks(input({
      backlogHours: 5000,
      partiallyWatchedRaces: 50,
      weeks: plan(4, {
        0: {
          majorEventNames: ['A', 'B', 'C'],
          scheduledRaces: 12,
          mustWatchRaces: 9,
          highPriorityRaces: 9,
          activeChallenges: 20,
          seasonPassOpportunity: true,
        },
      }),
    }));
    for (const week of extreme) {
      expect(week.demandFactor).toBeLessThanOrEqual(BUDGET_CONFIG.maxDemandFactor);
      expect(week.demandFactor).toBeGreaterThanOrEqual(BUDGET_CONFIG.minDemandFactor);
    }
  });

  it('explains every week it allocates', () => {
    const result = allocateWeeks(input({
      weeks: plan(4, {
        0: { majorEventNames: ['Le Mans'] },
        1: { isRestWeek: true },
      }),
    }));
    for (const week of result) {
      expect(Array.isArray(week.rationale)).toBe(true);
    }
    expect(result[0]!.rationale.join(' ')).toContain('Le Mans');
  });

  it('handles the final week of the year without dividing by zero', () => {
    const result = allocateWeeks(input({
      weeksRemaining: 0.14,
      usedHours: 330,
      weeks: [demandWeek(0, { isCurrent: true })],
    }));
    expect(Number.isFinite(result[0]!.recommendedHours)).toBe(true);
    expect(result[0]!.recommendedHours).toBeGreaterThanOrEqual(0);
  });

  it('handles the first week of a new year', () => {
    const result = allocateWeeks(input({ usedHours: 0, weeksRemaining: 52.1, weeks: plan(8) }));
    expect(result).toHaveLength(8);
    expect(result.every((w) => Number.isFinite(w.recommendedHours))).toBe(true);
  });

  it('handles an empty horizon', () => {
    expect(allocateWeeks(input({ weeks: [] }))).toEqual([]);
  });

  it('handles every week being a rest week', () => {
    const result = allocateWeeks(input({
      weeks: plan(4).map((w) => ({ ...w, isRestWeek: true })),
    }));
    expect(result.every((w) => w.recommendedHours === 0)).toBe(true);
  });

  it('is deterministic', () => {
    const config = input({ weeks: plan(6, { 3: { majorEventNames: ['Spa 24'] } }) });
    const a = allocateWeeks(config);
    const b = allocateWeeks(config);
    expect(a.map((w) => w.recommendedHours)).toEqual(b.map((w) => w.recommendedHours));
  });

  it('carries the week identity through untouched', () => {
    const result = allocateWeeks(input({ weeks: plan(3) }));
    expect(result.map((w) => w.isoWeek)).toEqual([2, 3, 4]);
    expect(result[0]!.isCurrent).toBe(true);
  });
});

describe('projectYearEndHours', () => {
  const base = {
    usedHours: 100,
    weeksElapsed: 12,
    weeksRemaining: 40,
    recentWeeklyHours: [8, 8, 8, 8],
    basePaceHours: 6,
  };

  it('projects forward from the recent pace', () => {
    const projected = projectYearEndHours(base);
    expect(projected).toBeGreaterThan(base.usedHours);
    expect(projected).toBeLessThan(base.usedHours + 40 * 12);
  });

  it('never projects below what has already been watched', () => {
    const projected = projectYearEndHours({ ...base, recentWeeklyHours: [0, 0, 0, 0], usedHours: 250 });
    expect(projected).toBeGreaterThanOrEqual(250);
  });

  it('returns what has been used once the year is over', () => {
    expect(projectYearEndHours({ ...base, weeksRemaining: 0 })).toBeCloseTo(100, 0);
  });

  it('falls back to the plan before a week of the year has elapsed', () => {
    // A quiet first Tuesday must not project a year of nothing.
    const projected = projectYearEndHours({
      usedHours: 0, weeksElapsed: 0.3, weeksRemaining: 52, recentWeeklyHours: [], basePaceHours: 6.46,
    });
    expect(Number.isFinite(projected)).toBe(true);
    expect(projected).toBeGreaterThan(300);
  });

  it('uses the season-to-date average when there is no recent history', () => {
    const projected = projectYearEndHours({
      usedHours: 120, weeksElapsed: 20, weeksRemaining: 32, recentWeeklyHours: [], basePaceHours: 6,
    });
    // 6 h/week season-to-date, 32 weeks left.
    expect(projected).toBeCloseTo(120 + 6 * 32, 0);
  });

  it('leans on recent weeks over the whole-year average', () => {
    const sameHistory = { usedHours: 100, weeksElapsed: 20, weeksRemaining: 30, basePaceHours: 5 };
    const speedingUp = projectYearEndHours({ ...sameHistory, recentWeeklyHours: [10, 11, 12, 13] });
    const slowingDown = projectYearEndHours({ ...sameHistory, recentWeeklyHours: [2, 1, 1, 0] });
    expect(speedingUp).toBeGreaterThan(slowingDown);
  });

  it('is always a finite number', () => {
    const cases = [
      { usedHours: 0, weeksElapsed: 0, weeksRemaining: 52, recentWeeklyHours: [], basePaceHours: 0 },
      { usedHours: -5, weeksElapsed: 5, weeksRemaining: 5, recentWeeklyHours: [-2], basePaceHours: -1 },
      { usedHours: 1e6, weeksElapsed: 52, weeksRemaining: 0, recentWeeklyHours: [1e6], basePaceHours: 1e6 },
    ];
    for (const testCase of cases) {
      expect(Number.isFinite(projectYearEndHours(testCase))).toBe(true);
    }
  });
});
