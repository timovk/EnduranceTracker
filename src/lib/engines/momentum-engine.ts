/**
 * Momentum and streaks.
 *
 * Momentum is this application's answer to the daily-streak mechanic, and it
 * exists because a streak is the most efficient way ever devised to turn a
 * hobby into an obligation. A streak is brittle by design: it is worth a great
 * deal right up to the moment it breaks and nothing at all immediately
 * afterwards, and the application holding it then has to decide whether to
 * tell you. This one never has to, because momentum does not break. It rises
 * while you watch and SETTLES GENTLY while you do not — `dailyDecay` once per
 * elapsed day, towards a floor rather than towards nothing — so a fortnight
 * away costs a tier or two of a cosmetic bar and precisely nothing else. There
 * is no state momentum can reach from which watching again is discouraging.
 *
 * What momentum is worth is deliberately almost nothing: the tier's position
 * on the ladder multiplied by `seasonXpBonusPerTier`, applied to SEASON XP
 * ONLY. Season XP buys cosmetics inside a quarter that archives itself, so the
 * bonus expires with the quarter it flattered. Career XP, levels, prestige,
 * statistics and collections never see it. That separation is the whole point:
 * somebody who watches in long irregular bursts arrives at exactly the same
 * permanent career as somebody who watches every single evening, and momentum
 * can therefore never make long-term progression objectively easier.
 *
 * Streaks are still recorded, because a long one is genuinely nice to look at,
 * and they are recorded the way a trophy cabinet records things. `longestDays`
 * is kept for ever. `currentDays` simply begins again at one after a gap, in
 * silence — the gap is written down, never announced. There is no
 * "you lost your 14-day streak" in this application and there is nowhere for
 * one to live: the only thing a return produces is `welcomeBack()` from
 * `@/lib/copy/tone`, which greets the user and asks whether they fancy another
 * stint. `daysSinceLastActive` exists to choose which of those greetings to
 * use, and for nothing else.
 *
 * Two mechanical notes worth keeping in mind when reading the rest:
 *
 *   * Momentum is applied LAZILY. Nothing runs at midnight. The settle is
 *     computed from `momentumUpdatedAt` to whatever `now` the caller supplies,
 *     on every read and on every write. Decay is expressed continuously in
 *     fractional days, which makes it composable — d^a · d^b = d^(a+b) — so
 *     reading the panel a dozen times between stints yields exactly the figure
 *     one read would have given.
 *   * The gain is denominated in REAL viewing seconds and never in timeline
 *     seconds. Watching at 2x therefore earns momentum at half the rate per
 *     hour of race, which is correct: momentum is a picture of how much of the
 *     user's own time has recently gone in front of a race, not of how much
 *     race was covered. Re-watching an hour builds momentum exactly as much as
 *     watching a new one, because it costs the same hour of a life.
 *
 * The pure half — `decayMomentum`, `gainForRealSeconds`, `tierForPoints` and
 * `buildMomentumState` — takes no clock and no database, so the whole curve
 * can be tested exhaustively without a fixture.
 */

import { differenceInCalendarDays, startOfDay, subDays } from 'date-fns';

import { MOMENTUM_CONFIG, MOMENTUM_SHAPE } from '@/lib/config';
import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { isoWeekParts } from '@/lib/domain/periods';
import { toHours } from '@/lib/domain/time';
import type { MomentumState, StreakState } from '@/lib/engines/contracts';

const MILLISECONDS_PER_DAY = 86_400_000;

// ===========================================================================
// The pure core
// ===========================================================================

/**
 * One rung of the momentum ladder, resolved from configuration.
 *
 * The config tiers carry no index of their own, and the index is what the
 * Season XP bonus scales with, so it is attached here once — sorted by
 * threshold first, so the ladder is correct even if the configuration is later
 * re-balanced into a different order.
 */
export interface MomentumTier {
  key: string;
  name: string;
  /** Lowest point total that belongs to this tier. */
  min: number;
  /** Restrained accent colour for the momentum bar. */
  color: string;
  /** A line of flavour. Never about what happens if you stop. */
  blurb: string;
  /** Position on the ladder, counting from zero at Cold Tyres. */
  index: number;
}

/** The ladder: Cold Tyres through Ironman, ascending. */
export const MOMENTUM_TIERS: readonly MomentumTier[] = [...MOMENTUM_CONFIG.tiers]
  .sort((a, b) => a.min - b.min)
  .map((tier, index) => ({
    key: tier.key,
    name: tier.name,
    min: tier.min,
    color: tier.color,
    blurb: tier.blurb,
    index,
  }));

/**
 * Points are a Float in the database and the arithmetic is exponential, so
 * they are rounded to two decimals wherever they are handed out or stored.
 * Without it the bar accumulates floating-point noise that shows up in the
 * history chart as a tier flickering across its own threshold.
 */
function roundPoints(points: number): number {
  return Math.round(points * 100) / 100;
}

/** Keep a total inside the configured floor and ceiling. */
function clampPoints(points: number): number {
  const safe = Number.isFinite(points) ? points : MOMENTUM_CONFIG.floor;
  return Math.min(MOMENTUM_CONFIG.ceiling, Math.max(MOMENTUM_CONFIG.floor, safe));
}

/**
 * Settle a momentum total over an elapsed span.
 *
 * `points * dailyDecay^days`, held at the configured floor. `days` is
 * fractional on purpose — see the note on lazy application in the file header.
 * A total already at or below the floor is returned untouched, because decay
 * is a settling mechanism and must never be able to raise a figure.
 */
export function decayMomentum(points: number, days: number): number {
  const { dailyDecay, floor } = MOMENTUM_CONFIG;
  const safePoints = Number.isFinite(points) ? Math.max(0, points) : 0;
  const elapsed = Number.isFinite(days) ? Math.max(0, days) : 0;
  if (safePoints <= floor) return safePoints;
  return Math.max(floor, safePoints * dailyDecay ** elapsed);
}

/**
 * Momentum earned by a quantity of real viewing time.
 *
 * Capped at `maxDailyGain`, which is a cap on the DAY rather than on the
 * stint: callers pass the day's running total through this function and take
 * the difference, so a fourteen-hour Le Mans Saturday and four short evenings
 * that add up to the same figure contribute identically. The cap is also what
 * stops a single enormous session from parking the bar at Ironman for a week,
 * which would make the following days feel like maintenance.
 */
export function gainForRealSeconds(realSeconds: number): number {
  const seconds = Number.isFinite(realSeconds) ? Math.max(0, realSeconds) : 0;
  return Math.min(MOMENTUM_CONFIG.maxDailyGain, toHours(seconds) * MOMENTUM_CONFIG.pointsPerRealHour);
}

/** The highest tier whose threshold the total has reached. */
export function tierForPoints(points: number): MomentumTier {
  const safe = Number.isFinite(points) ? points : 0;
  let match: MomentumTier = MOMENTUM_TIERS[0];
  for (const tier of MOMENTUM_TIERS) {
    if (safe >= tier.min) match = tier;
  }
  return match;
}

/**
 * Everything the momentum panel renders, from a point total alone.
 *
 * `seasonXpBonus` is the tier index times `seasonXpBonusPerTier`, and the
 * session engine applies it to SEASON XP ONLY (see `session-engine.ts`, where
 * it multiplies `seasonXpAwarded` and nothing else). It is never applied to
 * career XP, so no amount of momentum can make permanent progression
 * objectively easier — it can only make a quarter's cosmetic track arrive a
 * little sooner, and that quarter archives itself regardless.
 */
export function buildMomentumState(points: number): MomentumState {
  const settled = roundPoints(clampPoints(points));
  const tier = tierForPoints(settled);
  const next: MomentumTier | undefined = MOMENTUM_TIERS[tier.index + 1];

  const span = next === undefined ? 0 : next.min - tier.min;
  const progressToNext = next === undefined || span <= 0
    ? 1
    : Math.min(1, Math.max(0, (settled - tier.min) / span));

  return {
    points: settled,
    tierKey: tier.key,
    tierName: tier.name,
    tierColor: tier.color,
    tierBlurb: tier.blurb,
    progressToNext,
    nextTierName: next === undefined ? null : next.name,
    pointsToNext: next === undefined ? 0 : Math.max(0, roundPoints(next.min - settled)),
    // Rounded because 3 * 0.015 is not exactly 0.045 in binary floating point,
    // and this fraction is multiplied into an XP figure a user can see.
    seasonXpBonus: Math.round(tier.index * MOMENTUM_CONFIG.seasonXpBonusPerTier * 10_000) / 10_000,
  };
}

/** Fractional days between two instants, never negative. */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);
}

// ===========================================================================
// Momentum — reads and writes
// ===========================================================================

/**
 * Settle momentum, add this stint's gain and persist the result.
 *
 * Runs inside the caller's transaction, so the stint, its XP and the momentum
 * it produced are one atomic write. Re-running it is safe in the sense that
 * matters here: it grants no XP, touches no one-shot award and writes only
 * derived state, and the day's `MomentumHistory` row is what bounds the gain,
 * so a second call for the same stint cannot push the day past `maxDailyGain`.
 */
export async function applyMomentumForSession(
  tx: Tx,
  userId: string,
  realSeconds: number,
  now: Date = new Date(),
): Promise<MomentumState> {
  const added = Number.isFinite(realSeconds) ? Math.max(0, Math.round(realSeconds)) : 0;

  const profile = await tx.careerProfile.findUniqueOrThrow({
    where: { userId },
    select: { momentumPoints: true, momentumUpdatedAt: true },
  });

  const day = startOfDay(now);
  const today = await tx.momentumHistory.findUnique({
    where: { userId_date: { userId, date: day } },
    select: { realSeconds: true },
  });
  const secondsBefore = today?.realSeconds ?? 0;

  // The day's cap is applied to the day, not to the stint: what this stint
  // earns is the day's gain after it minus the day's gain before it.
  const gain = gainForRealSeconds(secondsBefore + added) - gainForRealSeconds(secondsBefore);

  const settled = decayMomentum(profile.momentumPoints, daysBetween(profile.momentumUpdatedAt, now));
  const state = buildMomentumState(settled + gain);

  await tx.careerProfile.update({
    where: { userId },
    data: {
      momentumPoints: state.points,
      momentumTierKey: state.tierKey,
      // A stint may be logged for an earlier evening. The settle clock is
      // never moved backwards by one, because that would charge the user decay
      // twice for the same span the next time anything read the bar.
      momentumUpdatedAt: now.getTime() > profile.momentumUpdatedAt.getTime() ? now : profile.momentumUpdatedAt,
    },
  });

  // One row per local calendar day: the day's accumulated real seconds and the
  // total as it stands at the end of it, which is what the chart plots.
  await tx.momentumHistory.upsert({
    where: { userId_date: { userId, date: day } },
    create: { userId, date: day, points: state.points, tierKey: state.tierKey, realSeconds: added },
    update: { points: state.points, tierKey: state.tierKey, realSeconds: { increment: added } },
  });

  return state;
}

/**
 * Momentum as it stands right now, for display.
 *
 * Applies the settle for the span since the last write WITHOUT persisting it,
 * so opening a page is not an event: the figure on screen is always current,
 * and the stored figure only ever moves when the user actually watches
 * something. A profile that does not exist yet reads as the resting state
 * rather than throwing, because opening the application before the first stint
 * has been logged should simply show an empty bar.
 */
export async function getMomentum(userId: string, now: Date = new Date()): Promise<MomentumState> {
  const profile = await prisma.careerProfile.findUnique({
    where: { userId },
    select: { momentumPoints: true, momentumUpdatedAt: true },
  });
  if (!profile) return buildMomentumState(MOMENTUM_CONFIG.floor);

  return buildMomentumState(decayMomentum(profile.momentumPoints, daysBetween(profile.momentumUpdatedAt, now)));
}

/**
 * The momentum chart's series, oldest day first.
 *
 * Quiet days simply have no row. That is deliberate rather than an oversight:
 * the settle between two points is a smooth curve the chart can draw for
 * itself, and inventing rows for days the user did not watch would put
 * fabricated data in the history table purely to make a line continuous.
 */
export async function getMomentumHistory(
  userId: string,
  days: number = MOMENTUM_SHAPE.defaultChartDays,
): Promise<{ date: Date; points: number; tierKey: string; realSeconds: number }[]> {
  const requested = Number.isFinite(days) ? Math.round(days) : MOMENTUM_SHAPE.defaultChartDays;
  const window = Math.min(MOMENTUM_SHAPE.maxChartDays, Math.max(1, requested));
  const from = startOfDay(subDays(new Date(), window - 1));

  return prisma.momentumHistory.findMany({
    where: { userId, date: { gte: from } },
    orderBy: { date: 'asc' },
    select: { date: true, points: true, tierKey: true, realSeconds: true },
  });
}

// ===========================================================================
// Streaks — recorded, never punitive
// ===========================================================================

/**
 * Record today as an active day.
 *
 * A day is active when a session was watched on it, which is read from the
 * session rows themselves rather than assumed from the call, so this is safe
 * to run whenever and as often as anything likes. `lastActiveDate` is the
 * idempotence guard: a day already recorded changes nothing at all.
 *
 * The gap rule is the only interesting line in here, and it is one line. If
 * the previous active day was yesterday the count goes up; otherwise it starts
 * again at one. Nothing is deducted, nothing is flagged, and nothing anywhere
 * in the application tells the user that a streak ended — a return is greeted
 * with `welcomeBack()` from `@/lib/copy/tone` and that is the entire
 * consequence. `longestDays` is never lowered by anything, which is what makes
 * a broken streak a frozen record rather than a loss.
 */
export async function updateStreak(tx: Tx, userId: string, now: Date = new Date()): Promise<StreakState> {
  const profile = await tx.careerProfile.findUniqueOrThrow({
    where: { userId },
    select: {
      currentStreakDays: true,
      longestStreakDays: true,
      lifetimeActiveDays: true,
      lifetimeActiveWeeks: true,
      lastActiveDate: true,
    },
  });

  const day = startOfDay(now);
  const last = profile.lastActiveDate === null ? null : startOfDay(profile.lastActiveDate);

  // Already counted, or a stint logged for a day at or before the last one on
  // record. Backdated stints are welcome, but they do not rewrite the run of
  // days that has already been written down — and since nothing here can take
  // anything away, leaving the record alone is always the safe answer.
  if (last !== null && day.getTime() <= last.getTime()) {
    return describeStreak(profile, profile.lastActiveDate, now);
  }

  const sessionsToday = await tx.raceViewingSession.count({
    where: { userId, watchedAt: { gte: day, lt: new Date(day.getTime() + MILLISECONDS_PER_DAY) } },
  });
  if (sessionsToday === 0) {
    return describeStreak(profile, profile.lastActiveDate, now);
  }

  const consecutive = last !== null && differenceInCalendarDays(day, last) === 1;
  const currentStreakDays = consecutive ? profile.currentStreakDays + 1 : 1;
  const longestStreakDays = Math.max(profile.longestStreakDays, currentStreakDays);
  const lifetimeActiveDays = profile.lifetimeActiveDays + 1;

  // Distinct ISO weeks with any activity in them. Active days arrive in order,
  // so a week is new exactly when today's ISO week differs from the week the
  // last active day fell in — no scan of the session history required.
  const thisWeek = isoWeekParts(day);
  const lastWeek = last === null ? null : isoWeekParts(last);
  const newWeek = lastWeek === null || lastWeek.isoYear !== thisWeek.isoYear || lastWeek.isoWeek !== thisWeek.isoWeek;
  const lifetimeActiveWeeks = profile.lifetimeActiveWeeks + (newWeek ? 1 : 0);

  await tx.careerProfile.update({
    where: { userId },
    data: {
      currentStreakDays,
      longestStreakDays,
      lifetimeActiveDays,
      lifetimeActiveWeeks,
      // Stored as local midnight so that day arithmetic is exact and so that
      // "days since" never depends on what time of the evening someone watched.
      lastActiveDate: day,
    },
  });

  return describeStreak(
    { currentStreakDays, longestStreakDays, lifetimeActiveDays, lifetimeActiveWeeks },
    day,
    now,
  );
}

/**
 * The streak record as it stands. Read-only.
 *
 * Note what this does NOT do: it does not re-evaluate whether the current
 * streak is still running. A streak that has lapsed stays on screen at the
 * length it reached until the next stint quietly starts a new one, because
 * recalculating it downwards at read time would be precisely the moment of
 * loss this application refuses to manufacture. `daysSinceLastActive` carries
 * the honest figure, and its only consumer is `welcomeBack()`.
 */
export async function getStreak(userId: string, now: Date = new Date()): Promise<StreakState> {
  const profile = await prisma.careerProfile.findUnique({
    where: { userId },
    select: {
      currentStreakDays: true,
      longestStreakDays: true,
      lifetimeActiveDays: true,
      lifetimeActiveWeeks: true,
      lastActiveDate: true,
    },
  });
  if (!profile) {
    return {
      currentDays: 0,
      longestDays: 0,
      lifetimeActiveDays: 0,
      lifetimeActiveWeeks: 0,
      lastActiveDate: null,
      daysSinceLastActive: 0,
    };
  }

  return describeStreak(profile, profile.lastActiveDate, now);
}

/** Shape the stored counters into the contract type. */
function describeStreak(
  counts: {
    currentStreakDays: number;
    longestStreakDays: number;
    lifetimeActiveDays: number;
    lifetimeActiveWeeks: number;
  },
  lastActiveDate: Date | null,
  now: Date,
): StreakState {
  return {
    currentDays: counts.currentStreakDays,
    longestDays: counts.longestStreakDays,
    lifetimeActiveDays: counts.lifetimeActiveDays,
    lifetimeActiveWeeks: counts.lifetimeActiveWeeks,
    lastActiveDate,
    daysSinceLastActive:
      lastActiveDate === null ? 0 : Math.max(0, differenceInCalendarDays(startOfDay(now), startOfDay(lastActiveDate))),
  };
}
