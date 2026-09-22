/**
 * The adaptive viewing budget.
 *
 * The year holds 336 real viewing hours and a nominal weekly anchor of eight.
 * Those two figures deliberately do not multiply out — eight hours across
 * fifty-two weeks would be 416 — so the annual figure cannot simply be sliced
 * into equal weeks. A year of endurance racing has shapes in it: a 24-hour
 * race is a weekend-long expedition, and a fortnight in February may hold
 * nothing at all. This engine spends the annual budget the way the year is
 * actually shaped, letting a Le Mans week take twelve hours or more and a
 * quiet week take four, while keeping the whole year viable.
 *
 * Three things about this module are not negotiable:
 *
 *   * It is a PLANNING FRAMEWORK, never a restriction. Nothing here can tell
 *     the user they may not watch something, nothing expires, and exceeding
 *     the annual figure costs exactly nothing — no XP, no progression, not so
 *     much as a stern sentence. A projection above the plan is reported with
 *     `budgetProjectionNote`, in the same neutral voice as everything else,
 *     and `hoursVersusTarget` is a position, not a deficit to repay.
 *   * Real viewing time and race-timeline time are different quantities. The
 *     budget is denominated in REAL hours — `RaceViewingSession.realSeconds` —
 *     because real hours are what a person actually spends. The library
 *     backlog is measured in outstanding TIMELINE seconds, so it is converted
 *     through the playback speed each race is actually watched at before it
 *     is allowed anywhere near the budget arithmetic.
 *   * The interesting half is pure. `allocateWeeks` and `projectYearEndHours`
 *     take everything they need as arguments — no clock, no database — so
 *     year transitions, mid-week starts, empty libraries and rest weeks can
 *     be tested exhaustively without a fixture.
 *
 * A note on where a week is stored. `BudgetWeek` rows hang off a `BudgetYear`
 * so that each past year keeps the annual figure it was planned against, and
 * a recompute writes every week of its horizon under the budget year of the
 * moment it runs. Rest weeks are looked up by date range rather than by
 * budget year, so the one week that straddles New Year is honoured whichever
 * year's row happens to hold the flag.
 */

import { addDays, addWeeks, setISOWeek, setISOWeekYear, startOfISOWeek, startOfYear } from 'date-fns';

import type { BudgetYear } from '@/generated/prisma/client';
import { BUDGET_CONFIG, BUDGET_SHAPE, SEASON_PASS_CONFIG } from '@/lib/config';
import { budgetProjectionNote } from '@/lib/copy/tone';
import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import type { Period } from '@/lib/domain/periods';
import { isoWeekParts, startOfViewingWeek, viewingWeek, weeksRemainingInYear } from '@/lib/domain/periods';
import type { BudgetSnapshot, WeekAllocation } from '@/lib/engines/contracts';

// ===========================================================================
// The pure core
// ===========================================================================

/**
 * One week as the allocator sees it.
 *
 * Everything the allocator knows about a week arrives here, already counted
 * by the caller, which is what keeps the allocation itself free of the clock
 * and of the database.
 */
export interface WeekDemandInput {
  isoYear: number;
  isoWeek: number;
  weekStart: Date;
  /** Exclusive. */
  weekEnd: Date;
  /** True for the week containing `now`. */
  isCurrent: boolean;
  /** Marked by the user. A rest week is allocated exactly zero. */
  isRestWeek: boolean;
  /** Real hours already recorded in this week. Zero for future weeks. */
  actualHours: number;
  /** Races scheduled in this week that still have something left to watch. */
  scheduledRaces: number;
  /** Names of the tagged major events scheduled this week, for the rationale. */
  majorEventNames: string[];
  highPriorityRaces: number;
  mustWatchRaces: number;
  /** Challenges whose window overlaps this week and is still open. */
  activeChallenges: number;
  /** True when a season pass runs in this week with tiers still ahead. */
  seasonPassOpportunity: boolean;
}

/** Everything `allocateWeeks` needs. No clock, no database, no globals. */
export interface WeekAllocationInput {
  /** The annual figure for the year being planned, from its `BudgetYear`. */
  annualBudgetHours: number;
  /** The nominal weekly anchor, used only as the over-pace reference. */
  weeklyTargetHours: number;
  /** Real hours already recorded in the calendar year. */
  usedHours: number;
  /** Fractional weeks left in the year, from `weeksRemainingInYear`. */
  weeksRemaining: number;
  /** Outstanding REAL hours in the library (timeline converted by speed). */
  backlogHours: number;
  /** Races started but not finished — the continuity signal. */
  partiallyWatchedRaces: number;
  /**
   * Real hours for the completed weeks immediately before the horizon, oldest
   * first. Used to notice that the last week ran hot.
   */
  recentWeeklyHours: number[];
  /** The planning horizon, in order, starting with the current week. */
  weeks: WeekDemandInput[];
}

/**
 * A `WeekAllocation` with the allocator's working shown. The two extra fields
 * are for the tests and for the debug panel; nothing in the UI depends on them.
 */
export interface AllocatedWeek extends WeekAllocation {
  /** The clamped demand factor the base pace was multiplied by. */
  demandFactor: number;
  /** The ceiling in force for this week (major-event weeks get the higher one). */
  capHours: number;
}

/**
 * Spread what is left of the annual budget across the planning horizon.
 *
 * The shape of the algorithm is: divide what is left by what remains to get a
 * base pace, bend that pace up or down per week by everything the week has in
 * it, clamp each week between a floor and a ceiling, then normalise the whole
 * horizon back onto its share of the remaining budget and re-clamp. Two or
 * three passes settle it even when several weeks are pinned to their ceiling.
 *
 * Pure by design: year transitions, mid-week starts and rest weeks are all
 * expressible as an input object, so they are all directly testable.
 */
export function allocateWeeks(input: WeekAllocationInput): AllocatedWeek[] {
  const weights = BUDGET_CONFIG.demandWeights;

  // Step 2-4. `remaining` is allowed to go negative — the year is a plan, not
  // an allowance — but the pace it implies is floored at zero rather than
  // being turned into something the user owes back.
  const weeksRemaining = Math.max(BUDGET_SHAPE.minWeeksRemaining, input.weeksRemaining);
  const remaining = input.annualBudgetHours - input.usedHours;
  const basePace = Math.max(0, remaining) / weeksRemaining;

  // Library-wide signals. Both saturate, so a very large library nudges the
  // pace up without ever dictating it.
  const backlogPressure = saturate(input.backlogHours, BUDGET_SHAPE.backlogSaturationHours);
  const continuityRaces = Math.min(input.partiallyWatchedRaces, BUDGET_SHAPE.continuitySaturationRaces);

  const allocations: AllocatedWeek[] = input.weeks.map((week, index) => {
    const base = {
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      isRestWeek: week.isRestWeek,
      isCurrent: week.isCurrent,
      actualHours: round2(week.actualHours),
    };

    // A rest week the user asked for is exactly zero, not merely small: the
    // `restWeek` weight would only take the factor to the clamp floor, and a
    // rest week means rest. The hours it would have had are redistributed by
    // the normalisation below, because it takes no share of the horizon.
    if (week.isRestWeek) {
      return {
        ...base,
        recommendedHours: 0,
        rationale: ['Rest week — the plan stays clear'],
        demandFactor: 0,
        capHours: 0,
      };
    }

    // The week before this one: for the first week of the horizon that is the
    // last completed week, and after that it is the previous horizon week,
    // whose actual hours are zero until it happens. A week can therefore only
    // be eased off by viewing that has actually been recorded.
    const previousHours =
      index === 0
        ? input.recentWeeklyHours.length > 0
          ? input.recentWeeklyHours[input.recentWeeklyHours.length - 1]
          : null
        : input.weeks[index - 1].actualHours;

    const overPace =
      previousHours === null || input.weeklyTargetHours <= 0
        ? 0
        : clamp((previousHours - input.weeklyTargetHours) / input.weeklyTargetHours, 0, 1);

    const rationale: string[] = [];
    let demand = 0;

    // Step 5. Every weight comes from BUDGET_CONFIG.demandWeights; every
    // count it multiplies is saturated by BUDGET_SHAPE so no single week can
    // run away with the year.
    if (week.majorEventNames.length > 0) {
      demand += weights.majorEventInWeek;
      rationale.push(majorEventRationale(week.majorEventNames));
    }
    if (week.scheduledRaces > 0) {
      demand += weights.raceScheduledInWeek * Math.min(week.scheduledRaces, BUDGET_SHAPE.scheduledRaceSaturationCount);
      rationale.push(week.scheduledRaces === 1 ? 'One race on the schedule' : `${week.scheduledRaces} races on the schedule`);
    }
    if (week.mustWatchRaces > 0) {
      demand += weights.perMustWatchRace * Math.min(week.mustWatchRaces, BUDGET_SHAPE.priorityRaceSaturationCount);
      rationale.push('Must-watch racing this week');
    }
    if (week.highPriorityRaces > 0) {
      demand += weights.perHighPriorityRace * Math.min(week.highPriorityRaces, BUDGET_SHAPE.priorityRaceSaturationCount);
      rationale.push('High-priority racing this week');
    }
    if (backlogPressure > 0) {
      demand += weights.backlogPressure * backlogPressure;
      rationale.push('A library of future experiences waiting');
    }
    if (continuityRaces > 0) {
      demand += weights.partiallyWatchedRace * continuityRaces;
      rationale.push('Races part-way through — finishing beats starting');
    }
    if (week.activeChallenges > 0) {
      demand += weights.challengeOpportunity * Math.min(week.activeChallenges, BUDGET_SHAPE.challengeSaturationCount);
      rationale.push('Challenges open in this window');
    }
    if (week.seasonPassOpportunity) {
      demand += weights.seasonPassPush;
      rationale.push('Season pass tiers still ahead');
    }
    if (overPace > 0) {
      demand += weights.recentOverPace * overPace;
      rationale.push('A lighter week after a heavier one');
    }

    // Step 6.
    const demandFactor = clamp(1 + demand, BUDGET_CONFIG.minDemandFactor, BUDGET_CONFIG.maxDemandFactor);
    const capHours = week.majorEventNames.length > 0 ? BUDGET_CONFIG.maxMajorEventWeeklyHours : BUDGET_CONFIG.maxWeeklyHours;
    const recommendedHours = clamp(basePace * demandFactor, BUDGET_CONFIG.minWeeklyHours, capHours);

    if (demandFactor < 1 && rationale.length === 0) rationale.push('Quiet week ahead');
    if (rationale.length === 0) rationale.push('Steady week — the usual pace');

    return { ...base, recommendedHours, rationale, demandFactor, capHours };
  });

  // Step 7. Normalise the horizon onto its share of what is left of the year.
  // The share is one unit per planned week, or all of the remaining budget if
  // the year ends inside the horizon — which is what makes the last weeks of
  // December divide up what is left rather than a full eight weeks' worth.
  // Rest weeks take no share, which is how their hours find the weeks around
  // them.
  const flexible = allocations.filter((allocation) => !allocation.isRestWeek);
  const horizonShare = Math.min(input.weeks.length, weeksRemaining);
  const target = basePace * horizonShare;

  // The scaling is applied to the UNCLAMPED demand, not to the clamped
  // recommendation, and any shortfall left by a week pinned to its ceiling is
  // pushed onto the weeks that are still free to move. Scaling the clamped
  // figures instead would quietly flatten the year: once several weeks sit on
  // the ceiling they all scale together, and the Le Mans week stops looking
  // any different from the week after it.
  const idealTotal = flexible.reduce((sum, allocation) => sum + basePace * allocation.demandFactor, 0);
  if (idealTotal > 0 && target > 0) {
    let scale = target / idealTotal;
    for (let pass = 0; pass < BUDGET_SHAPE.normalisationPasses; pass += 1) {
      let placed = 0;
      let movable = 0;
      for (const allocation of flexible) {
        const ideal = basePace * allocation.demandFactor;
        allocation.recommendedHours = clamp(ideal * scale, BUDGET_CONFIG.minWeeklyHours, allocation.capHours);
        placed += allocation.recommendedHours;
        if (allocation.recommendedHours > BUDGET_CONFIG.minWeeklyHours && allocation.recommendedHours < allocation.capHours) {
          movable += ideal;
        }
      }
      const shortfall = target - placed;
      if (movable <= 0 || Math.abs(shortfall) < BUDGET_SHAPE.roundingStepHours / 2) break;
      scale += shortfall / movable;
    }
  }

  settleRounding(flexible, target);

  // Notes that can only be written once the numbers have settled.
  for (const allocation of flexible) {
    if (allocation.recommendedHours >= allocation.capHours) {
      rememberOnce(allocation.rationale, 'At the top of the weekly shape — there is always room for more');
    } else if (allocation.recommendedHours <= BUDGET_CONFIG.minWeeklyHours) {
      rememberOnce(allocation.rationale, 'A gentle week — the plan never drops to nothing');
    }
  }

  return allocations;
}

/** What `projectYearEndHours` needs. Again: no clock, no database. */
export interface PaceProjectionInput {
  /** Real hours recorded in the calendar year so far. */
  usedHours: number;
  /** Fractional weeks elapsed since 1 January. */
  weeksElapsed: number;
  /** Fractional weeks left in the year. */
  weeksRemaining: number;
  /** Real hours per COMPLETED viewing week this year, oldest first. */
  recentWeeklyHours: number[];
  /** The pace the plan itself implies, used when there is no history at all. */
  basePaceHours: number;
}

/**
 * Where the year finishes if the user carries on as they have been.
 *
 * Recent weeks say more about next week than January did, so the projection
 * leans on an EMA over the trailing weeks; but a handful of weeks is a small
 * sample, so it is blended with the season-to-date average in proportion to
 * how much history there actually is. Before a single week of the year has
 * elapsed there is nothing to extrapolate from at all — the season-to-date
 * average would divide by a fraction of a week and a quiet first Tuesday
 * would project a year of nothing — so the plan's own base pace stands in.
 * The result is a number to be reported, never a target to be enforced.
 */
export function projectYearEndHours(input: PaceProjectionInput): number {
  const history = input.recentWeeklyHours.slice(-BUDGET_CONFIG.paceEmaWeeks);
  const seasonToDate = input.weeksElapsed > 0 ? input.usedHours / input.weeksElapsed : 0;

  let pace: number;
  if (input.weeksElapsed < 1) {
    // The first days of January say nothing about the year: a completed week
    // is the smallest sample worth extrapolating from, so until there is one
    // the projection simply reports the plan back.
    pace = input.basePaceHours;
  } else if (history.length === 0) {
    pace = seasonToDate;
  } else {
    let ema = history[0];
    for (let i = 1; i < history.length; i += 1) {
      ema = BUDGET_CONFIG.paceEmaAlpha * history[i] + (1 - BUDGET_CONFIG.paceEmaAlpha) * ema;
    }
    const emaWeight = clamp(history.length / BUDGET_CONFIG.paceEmaWeeks, 0, 1);
    pace = emaWeight * ema + (1 - emaWeight) * seasonToDate;
  }

  return round1(input.usedHours + Math.max(0, pace) * Math.max(0, input.weeksRemaining));
}

// ===========================================================================
// Persistence and the snapshot
// ===========================================================================

/**
 * Fetch (or create) the budget year.
 *
 * The annual figure is copied out of `BUDGET_CONFIG` on creation and never
 * written again, so re-balancing next year's budget leaves every past year
 * standing exactly as it was planned. A year transition therefore needs no
 * migration and no ceremony: the first call in January makes the new row.
 *
 * `db` defaults to the global client. Callers already inside a transaction —
 * the session engine, above all — pass theirs so this joins their single
 * atomic write rather than racing it.
 */
export async function ensureBudgetYear(userId: string, year: number, db: Tx = prisma): Promise<BudgetYear> {
  return db.budgetYear.upsert({
    where: { userId_year: { userId, year } },
    create: {
      userId,
      year,
      annualBudgetHours: BUDGET_CONFIG.annualHours,
      weeklyTargetHours: BUDGET_CONFIG.weeklyTargetHours,
    },
    update: {},
  });
}

/**
 * Real viewing hours recorded in `[from, to)`.
 *
 * Real seconds, never timeline seconds: re-watching an hour of a race costs a
 * real hour and the budget must say so, while it adds nothing to coverage.
 */
export async function recordedHoursInRange(userId: string, from: Date, to: Date, db: Tx = prisma): Promise<number> {
  const aggregate = await db.raceViewingSession.aggregate({
    where: { userId, watchedAt: { gte: from, lt: to } },
    _sum: { realSeconds: true },
  });
  return round2((aggregate._sum.realSeconds ?? 0) / 3600);
}

/**
 * Recompute the planning horizon and persist it.
 *
 * Every week of the horizon is written, so the plan the user saw is on record
 * and this year's history builds itself one week at a time. Past weeks are
 * never rewritten — what was suggested in March stays what was suggested in
 * March.
 */
export async function recomputeWeekAllocations(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<WeekAllocation[]> {
  const context = await loadBudgetContext(userId, now, db);
  const allocations = allocateWeeks(context.input);
  await persistAllocations(db, context.budgetYear.id, allocations, now);
  return allocations;
}

/**
 * Mark (or unmark) a week as a rest week.
 *
 * The flag is the user's, so it survives every recompute: the allocator reads
 * it back, allocates the week zero and hands its share to the weeks around
 * it. The horizon is recomputed immediately afterwards so that redistribution
 * is visible the moment the switch is flipped.
 */
export async function setRestWeek(
  userId: string,
  isoYear: number,
  isoWeek: number,
  isRest: boolean,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<void> {
  const weekStartsOn = await loadWeekStart(userId, db);
  const bounds = viewingWeekForIsoParts(isoYear, isoWeek, weekStartsOn);

  // An existing row may sit under either adjacent budget year if the week
  // straddles New Year, so it is found by its ISO parts rather than assumed.
  const existing = await db.budgetWeek.findFirst({
    where: { budgetYear: { userId }, isoYear, isoWeek },
    select: { id: true },
  });

  if (existing) {
    await db.budgetWeek.update({ where: { id: existing.id }, data: { isRestWeek: isRest } });
  } else {
    const budgetYear = await ensureBudgetYear(userId, bounds.start.getFullYear(), db);
    await db.budgetWeek.create({
      data: {
        budgetYearId: budgetYear.id,
        isoYear,
        isoWeek,
        weekStart: bounds.start,
        weekEnd: bounds.end,
        recommendedHours: 0,
        rationale: [],
        isRestWeek: isRest,
        computedAt: now,
      },
    });
  }

  await recomputeWeekAllocations(userId, now, db);
}

/**
 * The whole budget picture, for the dashboard.
 *
 * This recomputes and persists the horizon on the way through, so what the
 * page renders and what the database holds can never disagree, and so the
 * current week always has a row to become history with.
 */
export async function getBudgetSnapshot(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<BudgetSnapshot> {
  const context = await loadBudgetContext(userId, now, db);
  const allocations = allocateWeeks(context.input);
  await persistAllocations(db, context.budgetYear.id, allocations, now);

  const annualBudgetHours = context.budgetYear.annualBudgetHours;
  const usedHours = context.usedHours;
  const remainingHours = annualBudgetHours - usedHours;
  const basePaceHours = Math.max(0, remainingHours) / Math.max(BUDGET_SHAPE.minWeeksRemaining, context.weeksRemaining);

  const current = allocations.find((allocation) => allocation.isCurrent) ?? allocations[0];
  const recommendedPaceHours =
    allocations.length > 0
      ? allocations.reduce((sum, allocation) => sum + allocation.recommendedHours, 0) / allocations.length
      : 0;

  const projectedYearEndHours = projectYearEndHours({
    usedHours,
    weeksElapsed: context.weeksElapsed,
    weeksRemaining: context.weeksRemaining,
    recentWeeklyHours: context.recentWeeklyHours,
    basePaceHours,
  });

  // Step 10. Positive means ahead of the adaptive plan. The negative case is
  // simply the other side of the same number: the user is earlier in the
  // year's viewing than the plan sketched. That is not something owed, and
  // it is never presented as though it were.
  const plannedToDate = plannedHoursToDate(context, current, now);
  const hoursVersusTarget = round2(usedHours - plannedToDate);

  const pastWeeks = context.weeksBeforeNow.map((row) => ({
    isoYear: row.isoYear,
    isoWeek: row.isoWeek,
    weekStart: row.weekStart,
    weekEnd: row.weekEnd,
    recommendedHours: row.recommendedHours,
    rationale: row.rationale,
    isRestWeek: row.isRestWeek,
    isCurrent: false,
    actualHours: round2(context.hoursByWeekKey.get(weekKey(row.isoYear, row.isoWeek)) ?? 0),
  }));

  return {
    year: context.year,
    annualBudgetHours,
    usedHours,
    remainingHours: round2(remainingHours),
    percentConsumed: annualBudgetHours > 0 ? round1((usedHours / annualBudgetHours) * 100) : 0,

    basePaceHours: round2(basePaceHours),
    recommendedPaceHours: round2(recommendedPaceHours),

    projectedYearEndHours,
    projectionNote: budgetProjectionNote(projectedYearEndHours, annualBudgetHours),

    hoursVersusTarget,

    weekRecommendedHours: current.recommendedHours,
    weekActualHours: current.actualHours,
    weekRemainingHours: round2(Math.max(0, current.recommendedHours - current.actualHours)),
    weekRationale: current.rationale,
    weekIsRest: current.isRestWeek,
    weekStart: current.weekStart,
    weekEnd: current.weekEnd,

    upcomingWeeks: allocations,
    pastWeeks,

    weeksRemaining: round2(context.weeksRemaining),
  };
}

// ===========================================================================
// Loading
// ===========================================================================

/** A `BudgetWeek` row reduced to what the engine actually reads back. */
interface StoredWeek {
  isoYear: number;
  isoWeek: number;
  weekStart: Date;
  weekEnd: Date;
  recommendedHours: number;
  rationale: string[];
  isRestWeek: boolean;
}

interface BudgetContext {
  year: number;
  budgetYear: BudgetYear;
  weekStartsOn: number;
  currentWeek: Period;
  usedHours: number;
  weeksRemaining: number;
  weeksElapsed: number;
  /** Real hours per viewing week this year, keyed by `isoYear-Www`. */
  hoursByWeekKey: Map<string, number>;
  /** Completed weeks of this year before the horizon, oldest first. */
  recentWeeklyHours: number[];
  /** Persisted weeks of this year that are already behind the user. */
  weeksBeforeNow: StoredWeek[];
  input: WeekAllocationInput;
}

/**
 * Gather everything both entry points need, in as few round trips as the
 * shape of the data allows.
 *
 * Kept separate from `allocateWeeks` on purpose: this half is all clock and
 * database, that half is all arithmetic, and the seam between them is the
 * input object.
 */
async function loadBudgetContext(userId: string, now: Date, db: Tx): Promise<BudgetContext> {
  const year = now.getFullYear();
  const yearStart = startOfYear(now);
  const nextYearStart = new Date(year + 1, 0, 1, 0, 0, 0, 0);

  const [weekStartsOn, budgetYear, usedHours] = await Promise.all([
    loadWeekStart(userId, db),
    ensureBudgetYear(userId, year, db),
    // Step 1: the calendar year, not the last 365 days. The budget is annual.
    recordedHoursInRange(userId, yearStart, nextYearStart, db),
  ]);

  const currentWeek = viewingWeek(now, weekStartsOn);
  const yearFirstWeekStart = startOfViewingWeek(yearStart, weekStartsOn);

  // The horizon stops at the year boundary, because the budget it is dividing
  // up is annual: January's weeks are planned from January's budget, which is
  // also why each `BudgetYear` keeps its own annual figure. The current week
  // is always included, even on 31 December.
  const horizon: Period[] = [];
  for (let index = 0; index < BUDGET_CONFIG.planningHorizonWeeks; index += 1) {
    const start = addWeeks(currentWeek.start, index);
    if (index > 0 && start.getTime() >= nextYearStart.getTime()) break;
    horizon.push(viewingWeek(start, weekStartsOn));
  }
  const horizonStart = horizon[0].start;
  const horizonEnd = horizon[horizon.length - 1].end;
  const historyStart = yearFirstWeekStart.getTime() < horizonStart.getTime() ? yearFirstWeekStart : horizonStart;

  const [sessions, races, challenges, passes, storedRows] = await Promise.all([
    db.raceViewingSession.findMany({
      where: { userId, watchedAt: { gte: historyStart, lt: horizonEnd } },
      select: { watchedAt: true, realSeconds: true },
    }),
    // Archived and abandoned races are out of the library's way, so they ask
    // nothing of the plan.
    db.race.findMany({
      where: { userId, status: { notIn: ['ARCHIVED', 'ABANDONED'] } },
      select: {
        name: true, raceDate: true, isMajorEvent: true, priority: true, status: true,
        runtimeSec: true, coverageSec: true, avgPlaybackSpeed: true, storyCompletedAt: true,
      },
    }),
    db.challenge.findMany({
      where: { userId, periodStart: { lt: horizonEnd }, periodEnd: { gt: horizonStart } },
      select: { periodStart: true, periodEnd: true, progress: { select: { state: true } } },
    }),
    db.seasonPass.findMany({
      where: { userId, isArchived: false, startsAt: { lt: horizonEnd }, endsAt: { gt: horizonStart } },
      select: { startsAt: true, endsAt: true, tier: true },
    }),
    // By date range rather than by budget year, so a rest week recorded under
    // the neighbouring year's row at a New Year transition is still honoured.
    db.budgetWeek.findMany({
      where: { budgetYear: { userId }, weekStart: { gte: historyStart, lt: horizonEnd } },
      orderBy: [{ weekStart: 'asc' }, { computedAt: 'asc' }],
      select: {
        isoYear: true, isoWeek: true, weekStart: true, weekEnd: true,
        recommendedHours: true, rationale: true, isRestWeek: true,
      },
    }),
  ]);

  const hoursByWeekKey = new Map<string, number>();
  for (const session of sessions) {
    const parts = isoWeekParts(session.watchedAt, weekStartsOn);
    const key = weekKey(parts.isoYear, parts.isoWeek);
    hoursByWeekKey.set(key, (hoursByWeekKey.get(key) ?? 0) + session.realSeconds / 3600);
  }

  // Later rows win, but a rest week is the user's instruction and survives a
  // duplicate that does not know about it.
  const storedByKey = new Map<string, StoredWeek>();
  for (const row of storedRows) {
    const key = weekKey(row.isoYear, row.isoWeek);
    const previous = storedByKey.get(key);
    storedByKey.set(key, {
      isoYear: row.isoYear,
      isoWeek: row.isoWeek,
      weekStart: row.weekStart,
      weekEnd: row.weekEnd,
      recommendedHours: row.recommendedHours,
      rationale: toRationale(row.rationale),
      isRestWeek: row.isRestWeek || (previous?.isRestWeek ?? false),
    });
  }

  // -- Library-wide signals ------------------------------------------------
  let backlogHours = 0;
  let partiallyWatchedRaces = 0;
  for (const race of races) {
    if (race.storyCompletedAt !== null || race.status === 'COMPLETED') continue;
    const outstandingTimelineSec = Math.max(0, race.runtimeSec - race.coverageSec);
    if (outstandingTimelineSec === 0) continue;
    // Timeline seconds become real hours through the speed this race is
    // actually watched at. The two quantities are never added together.
    const speed = race.avgPlaybackSpeed > 0 ? race.avgPlaybackSpeed : 1;
    backlogHours += outstandingTimelineSec / speed / 3600;
    if (race.coverageSec > 0) partiallyWatchedRaces += 1;
  }

  // -- Per-week signals ----------------------------------------------------
  const weeks: WeekDemandInput[] = horizon.map((week) => {
    const parts = isoWeekParts(week.start, weekStartsOn);
    const key = weekKey(parts.isoYear, parts.isoWeek);
    const stored = storedByKey.get(key);
    return {
      isoYear: parts.isoYear,
      isoWeek: parts.isoWeek,
      weekStart: week.start,
      weekEnd: week.end,
      isCurrent: week.start.getTime() === currentWeek.start.getTime(),
      isRestWeek: stored?.isRestWeek ?? false,
      actualHours: hoursByWeekKey.get(key) ?? 0,
      scheduledRaces: 0,
      majorEventNames: [],
      highPriorityRaces: 0,
      mustWatchRaces: 0,
      activeChallenges: challenges.filter(
        (challenge) =>
          (challenge.progress === null || challenge.progress.state === 'ACTIVE') &&
          overlaps(challenge.periodStart, challenge.periodEnd, week.start, week.end),
      ).length,
      seasonPassOpportunity: passes.some(
        (pass) => pass.tier < SEASON_PASS_CONFIG.tierCount && overlaps(pass.startsAt, pass.endsAt, week.start, week.end),
      ),
    };
  });

  const weekByKey = new Map(weeks.map((week) => [weekKey(week.isoYear, week.isoWeek), week]));
  for (const race of races) {
    if (race.raceDate === null) continue;
    // A race that is finished asks nothing of the week it was held in.
    if (race.storyCompletedAt !== null || race.status === 'COMPLETED') continue;
    const parts = isoWeekParts(race.raceDate, weekStartsOn);
    const week = weekByKey.get(weekKey(parts.isoYear, parts.isoWeek));
    if (!week) continue;
    week.scheduledRaces += 1;
    if (race.isMajorEvent) week.majorEventNames.push(race.name);
    if (race.priority === 'MUST_WATCH') week.mustWatchRaces += 1;
    if (race.priority === 'HIGH') week.highPriorityRaces += 1;
  }

  // Trailing completed weeks, oldest first. Weeks before 1 January belong to
  // last year's pace, so the history is naturally short in January and the
  // projection leans on the season-to-date average instead.
  const recentWeeklyHours: number[] = [];
  for (let back = BUDGET_CONFIG.paceEmaWeeks; back >= 1; back -= 1) {
    const start = addWeeks(currentWeek.start, -back);
    if (start.getTime() < yearFirstWeekStart.getTime()) continue;
    const parts = isoWeekParts(start, weekStartsOn);
    recentWeeklyHours.push(round2(hoursByWeekKey.get(weekKey(parts.isoYear, parts.isoWeek)) ?? 0));
  }

  const weeksElapsed = Math.max(0, (now.getTime() - yearStart.getTime()) / MS_PER_WEEK);

  return {
    year,
    budgetYear,
    weekStartsOn,
    currentWeek,
    usedHours,
    weeksRemaining: weeksRemainingInYear(now),
    weeksElapsed,
    hoursByWeekKey,
    recentWeeklyHours,
    weeksBeforeNow: [...storedByKey.values()]
      .filter((row) => row.weekStart.getTime() < currentWeek.start.getTime())
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime()),
    input: {
      annualBudgetHours: budgetYear.annualBudgetHours,
      weeklyTargetHours: budgetYear.weeklyTargetHours,
      usedHours,
      weeksRemaining: weeksRemainingInYear(now),
      backlogHours,
      partiallyWatchedRaces,
      recentWeeklyHours,
      weeks,
    },
  };
}

/**
 * Write the horizon.
 *
 * Sequential rather than batched so that a caller's transaction client is
 * used exactly as given: engines here never open a transaction of their own,
 * because one logged session must remain one atomic write.
 */
async function persistAllocations(
  db: Tx,
  budgetYearId: string,
  allocations: AllocatedWeek[],
  now: Date,
): Promise<void> {
  for (const allocation of allocations) {
    const data = {
      weekStart: allocation.weekStart,
      weekEnd: allocation.weekEnd,
      recommendedHours: allocation.recommendedHours,
      rationale: allocation.rationale,
      isRestWeek: allocation.isRestWeek,
      computedAt: now,
    };
    await db.budgetWeek.upsert({
      where: {
        budgetYearId_isoYear_isoWeek: {
          budgetYearId,
          isoYear: allocation.isoYear,
          isoWeek: allocation.isoWeek,
        },
      },
      create: { budgetYearId, isoYear: allocation.isoYear, isoWeek: allocation.isoWeek, ...data },
      update: data,
    });
  }
}

/**
 * Hours the plan had sketched out by this moment.
 *
 * Only weeks the planner actually saw are counted. A week from before the app
 * was first opened contributes nothing, because nothing was suggested for it:
 * adopting this in June should not greet someone with a hundred-hour hole
 * they never agreed to. The current week counts only for the part of it that
 * has actually elapsed, so a Tuesday is not measured against a whole week.
 */
function plannedHoursToDate(context: BudgetContext, current: AllocatedWeek, now: Date): number {
  const plannedByKey = new Map(context.weeksBeforeNow.map((row) => [weekKey(row.isoYear, row.isoWeek), row]));
  const yearFirstWeekStart = startOfViewingWeek(new Date(context.year, 0, 1, 0, 0, 0, 0), context.weekStartsOn);

  let planned = 0;
  let cursor = yearFirstWeekStart;
  // Bounded in the same spirit as `weeksBetween` in `domain/periods`: a year
  // cannot hold four hundred weeks, and a loop over dates should say so.
  let guard = 0;
  while (cursor.getTime() < context.currentWeek.start.getTime() && guard < 400) {
    const parts = isoWeekParts(cursor, context.weekStartsOn);
    const stored = plannedByKey.get(weekKey(parts.isoYear, parts.isoWeek));
    planned += stored?.recommendedHours ?? 0;
    cursor = addWeeks(cursor, 1);
    guard += 1;
  }

  // Only the part of this week that has actually happened is counted, so a
  // Tuesday is not compared against the whole week's suggestion.
  const weekMs = context.currentWeek.end.getTime() - context.currentWeek.start.getTime();
  const elapsed =
    weekMs > 0 ? clamp(now.getTime() - context.currentWeek.start.getTime(), 0, weekMs) / weekMs : 1;
  return planned + current.recommendedHours * elapsed;
}

// ===========================================================================
// Small helpers
// ===========================================================================

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

async function loadWeekStart(userId: string, db: Tx): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { weekStart: true } });
  return user?.weekStart ?? 1;
}

/** `isoWeekParts` in reverse, for a week the user named rather than a date. */
function viewingWeekForIsoParts(
  isoYear: number,
  isoWeek: number,
  weekStartsOn: number,
): { start: Date; end: Date } {
  // Anchored on the ISO week's own Monday, then found by walking the viewing
  // weeks around it: a viewing week that starts on, say, Sunday is offset
  // from the ISO week it is labelled with, and `isoWeekParts` is the
  // definition the rest of the engine agrees with.
  const anchor = startOfISOWeek(setISOWeek(setISOWeekYear(new Date(isoYear, 5, 1, 12, 0, 0, 0), isoYear), isoWeek));
  for (let offset = -7; offset <= 7; offset += 1) {
    const start = startOfViewingWeek(addDays(anchor, offset), weekStartsOn);
    const parts = isoWeekParts(start, weekStartsOn);
    if (parts.isoYear === isoYear && parts.isoWeek === isoWeek) {
      return { start, end: addWeeks(start, 1) };
    }
  }
  const fallback = startOfViewingWeek(anchor, weekStartsOn);
  return { start: fallback, end: addWeeks(fallback, 1) };
}

function weekKey(isoYear: number, isoWeek: number): string {
  return `${isoYear}-W${isoWeek.toString().padStart(2, '0')}`;
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

/**
 * Rounding must not quietly cost the year hours, nor invent them.
 *
 * Every allocation is moved onto the reporting grid and whatever residue that
 * leaves is handed out one step at a time, to the weeks with the most room.
 * The loop is bounded in the same spirit as `weeksBetween` in `domain/periods`:
 * a guard is cheaper than trusting the arithmetic to terminate.
 */
function settleRounding(flexible: AllocatedWeek[], target: number): void {
  const step = BUDGET_SHAPE.roundingStepHours;
  for (const allocation of flexible) {
    allocation.recommendedHours = roundTo(allocation.recommendedHours, step);
  }
  if (target <= 0 || flexible.length === 0 || step <= 0) return;

  const total = flexible.reduce((sum, allocation) => sum + allocation.recommendedHours, 0);
  let stepsOutstanding = Math.round((target - total) / step);
  let guard = 0;

  while (stepsOutstanding !== 0 && guard < 500) {
    guard += 1;
    const direction = stepsOutstanding > 0 ? 1 : -1;
    const candidate = pickDriftCandidate(flexible, direction, step);
    if (!candidate) break;
    candidate.recommendedHours = roundTo(candidate.recommendedHours + direction * step, step);
    stepsOutstanding -= direction;
  }
}

/** The week with the most headroom in `direction`, or none if all are pinned. */
function pickDriftCandidate(
  flexible: AllocatedWeek[],
  direction: number,
  step: number,
): AllocatedWeek | null {
  let best: AllocatedWeek | null = null;
  let bestRoom = 0;
  for (const allocation of flexible) {
    const room =
      direction > 0
        ? allocation.capHours - allocation.recommendedHours
        : allocation.recommendedHours - BUDGET_CONFIG.minWeeklyHours;
    if (room >= step && room > bestRoom) {
      best = allocation;
      bestRoom = room;
    }
  }
  return best;
}

function majorEventRationale(names: string[]): string {
  if (names.length === 1) return `${names[0]} week — extra allocation`;
  return 'Major event week — extra allocation';
}

function rememberOnce(rationale: string[], line: string): void {
  if (!rationale.includes(line)) rationale.push(line);
}

/** A `Json` column comes back as `unknown` shapes; only strings are rationale. */
function toRationale(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 0-1, saturating at `at`. Used to turn a count into a weightable fraction. */
function saturate(value: number, at: number): number {
  if (at <= 0) return value > 0 ? 1 : 0;
  return clamp(value / at, 0, 1);
}

function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return round2(Math.round(value / step) * step);
}

function round1(value: number): number { return Math.round(value * 10) / 10; }
function round2(value: number): number { return Math.round(value * 100) / 100; }
