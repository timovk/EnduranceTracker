/**
 * Career levels, prestige and XP awards — all pure functions.
 *
 * The level curve is unbounded by design: there is no maximum career level.
 * Every parameter comes from configuration, so the economy can be re-balanced
 * without touching this file.
 */

import { LEVEL_CONFIG, LEVEL_TITLES, PRESTIGE_CONFIG, XP_CONFIG } from '@/lib/config/economy';

export interface LevelCurveConfig {
  base: number;
  exponent: number;
  maxSolvableLevel: number;
}

/**
 * XP required to advance FROM `level` TO `level + 1`.
 *
 *     cost(level) = round(base * level ^ exponent)
 */
export function xpForNextLevel(level: number, config: LevelCurveConfig = LEVEL_CONFIG): number {
  const safe = Math.max(1, Math.floor(level));
  return Math.round(config.base * Math.pow(safe, config.exponent));
}

/** Cumulative XP needed to have reached `level` from level 1. */
export function totalXpForLevel(level: number, config: LevelCurveConfig = LEVEL_CONFIG): number {
  const target = Math.max(1, Math.floor(level));
  let total = 0;
  for (let n = 1; n < target; n += 1) total += xpForNextLevel(n, config);
  return total;
}

export interface LevelState {
  level: number;
  /** XP accumulated inside the current level. */
  xpIntoLevel: number;
  /** XP needed to finish the current level. */
  xpForLevel: number;
  /** 0-1 progress through the current level. */
  progress: number;
  /** Cumulative XP at which the current level began. */
  levelStartXp: number;
  /** Cumulative XP at which the next level begins. */
  nextLevelXp: number;
}

/**
 * Resolve total career XP into a level.
 *
 * Iterative rather than closed-form: the curve is configurable, so the solver
 * must not assume a particular exponent. Iteration is cheap because the cost
 * grows superlinearly — reaching level 100_000 would take more XP than can be
 * earned, and `maxSolvableLevel` bounds it regardless.
 */
export function levelFromXp(totalXp: number, config: LevelCurveConfig = LEVEL_CONFIG): LevelState {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let consumed = 0;

  for (;;) {
    const cost = xpForNextLevel(level, config);
    if (consumed + cost > xp || level >= config.maxSolvableLevel) break;
    consumed += cost;
    level += 1;
  }

  const xpForLevel = xpForNextLevel(level, config);
  const xpIntoLevel = xp - consumed;

  return {
    level,
    xpIntoLevel,
    xpForLevel,
    progress: xpForLevel === 0 ? 1 : Math.min(1, xpIntoLevel / xpForLevel),
    levelStartXp: consumed,
    nextLevelXp: consumed + xpForLevel,
  };
}

/** The cosmetic title for a level: the highest threshold at or below it. */
export function titleForLevel(level: number): { level: number; title: string } {
  let best = LEVEL_TITLES[0]!;
  for (const entry of LEVEL_TITLES) {
    if (entry.level <= level) best = entry;
    else break;
  }
  return best;
}

/** The next title ahead, if there is one. */
export function nextTitleAfter(level: number): { level: number; title: string } | null {
  return LEVEL_TITLES.find((entry) => entry.level > level) ?? null;
}

// ---------------------------------------------------------------------------
// Prestige — additive only
// ---------------------------------------------------------------------------

/**
 * Prestige rank for a career level.
 *
 * Prestige NEVER resets XP, races, achievements, collections or statistics.
 * It is a status layer on top of a career that only ever grows.
 */
export function prestigeForLevel(level: number): number {
  const { thresholds, repeatEveryLevels } = PRESTIGE_CONFIG;
  let rank = 0;
  for (const threshold of thresholds) {
    if (level >= threshold) rank += 1;
  }
  const last = thresholds[thresholds.length - 1] ?? 0;
  if (level > last && repeatEveryLevels > 0) {
    rank += Math.floor((level - last) / repeatEveryLevels);
  }
  return rank;
}

/** Career level at which the given prestige rank unlocks. */
export function levelForPrestige(rank: number): number {
  const { thresholds, repeatEveryLevels } = PRESTIGE_CONFIG;
  if (rank <= 0) return 0;
  if (rank <= thresholds.length) return thresholds[rank - 1]!;
  const last = thresholds[thresholds.length - 1] ?? 0;
  return last + (rank - thresholds.length) * repeatEveryLevels;
}

const ROMAN: readonly [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function prestigeLabel(rank: number): string {
  if (rank <= 0) return '';
  if (!PRESTIGE_CONFIG.romanNumerals) return `Prestige ${rank}`;
  let remaining = rank;
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (remaining >= value) {
      out += numeral;
      remaining -= value;
    }
  }
  return `Prestige ${out}`;
}

// ---------------------------------------------------------------------------
// XP for a viewing session
// ---------------------------------------------------------------------------

export interface SessionXpInput {
  /** Timeline seconds played during the stint. */
  timelineSeconds: number;
  /** Of those, how many had never been watched before. */
  newCoverageSeconds: number;
  /** Playback speed used. */
  playbackSpeed: number;
}

export interface SessionXpResult {
  careerXp: number;
  seasonXp: number;
  /** Real seconds attributable to newly covered timeline. */
  newRealSeconds: number;
  /** Real seconds attributable to re-watched timeline. */
  rewatchRealSeconds: number;
  /** True when the slow-speed guard reduced the credited real time. */
  speedGuardApplied: boolean;
}

/**
 * XP for one viewing session.
 *
 * Three properties this must hold, all asserted in
 * `tests/domain/progression.test.ts`:
 *
 *   1. XP is never negative. There is no negative XP anywhere in the app.
 *   2. Playback speed cannot be used to farm XP. Faster playback means less
 *      real time and therefore less XP; the opposite exploit (claiming an
 *      implausibly slow speed) is capped by `xpMinSpeed`.
 *   3. Re-watching timeline you have already seen pays a fraction, so logging
 *      the same interval repeatedly is not a strategy.
 */
export function xpForSession(
  input: SessionXpInput,
  config: typeof XP_CONFIG = XP_CONFIG,
): SessionXpResult {
  const timeline = Math.max(0, Math.round(input.timelineSeconds));
  const newTimeline = Math.min(Math.max(0, Math.round(input.newCoverageSeconds)), timeline);
  const rewatchTimeline = timeline - newTimeline;

  const speed = input.playbackSpeed > 0 ? input.playbackSpeed : 1;
  // XP follows real time, so faster playback can only ever earn LESS. The
  // inverse — logging an implausibly slow speed to manufacture real hours — is
  // bounded here: credited speed is never below `xpMinSpeed`, so the most a
  // mis-stated speed can inflate an award is 1/xpMinSpeed (1.33x at the
  // default 0.75). That ceiling is deliberate rather than absolute: this is a
  // single-user log, and 0.75x is a speed somebody might genuinely use.
  const creditedSpeed = Math.max(speed, config.xpMinSpeed);
  const speedGuardApplied = creditedSpeed > speed;

  const newRealSeconds = newTimeline / creditedSpeed;
  const rewatchRealSeconds = rewatchTimeline / creditedSpeed;

  const perSecond = config.xpPerRealMinute / 60;
  const seasonPerSecond = config.seasonXpPerRealMinute / 60;

  const careerXp = Math.round(
    newRealSeconds * perSecond + rewatchRealSeconds * perSecond * config.rewatchXpMultiplier,
  );
  const seasonXp = Math.round(
    newRealSeconds * seasonPerSecond +
      rewatchRealSeconds * seasonPerSecond * config.seasonRewatchMultiplier,
  );

  return {
    careerXp: Math.max(0, careerXp),
    seasonXp: Math.max(0, seasonXp),
    newRealSeconds: Math.round(newRealSeconds),
    rewatchRealSeconds: Math.round(rewatchRealSeconds),
    speedGuardApplied,
  };
}

/** Story Complete bonus for a race of the given runtime. */
export function storyCompleteBonus(
  runtimeSec: number,
  isMajorEvent = false,
  config: typeof XP_CONFIG = XP_CONFIG,
): { careerXp: number; seasonXp: number; label: string } {
  const hours = runtimeSec / 3600;
  const band =
    config.storyCompleteBonuses.find((b) => hours <= b.maxHours) ??
    config.storyCompleteBonuses[config.storyCompleteBonuses.length - 1]!;

  const multiplier = isMajorEvent ? config.majorEventStoryMultiplier : 1;
  return {
    careerXp: Math.round(band.careerXp * multiplier),
    seasonXp: Math.round(band.seasonXp * multiplier),
    label: band.label,
  };
}
