/**
 * The single import point for game-balance configuration.
 *
 * Engines and UI import from here; nothing imports a balance constant from
 * anywhere else, and nothing defines one inline.
 */

export * from './economy';
export * from './achievements';
export * from './milestones';
export * from './rewards';
export * from './championships';

import {
  ACHIEVEMENT_BOARD_CONFIG, AWARDS_CONFIG, BUDGET_CONFIG, BUDGET_SHAPE, CHALLENGE_CONFIG, CHALLENGE_SHAPE,
  LEVEL_CONFIG, MASTERY_CONFIG, MASTERY_SHAPE, MILESTONE_CONFIG, MOMENTUM_CONFIG, MOMENTUM_SHAPE,
  PRESTIGE_CONFIG, SEASON_CLOSURE_CONFIG, SEASON_PASS_CONFIG, SEASON_PASS_SHAPE, STATS_CONFIG, STORY_CONFIG, STRATEGIST_CONFIG,
  STRATEGIST_SHAPE, TWENTY_FOUR_HOUR_CONFIG, XP_CONFIG,
} from './economy';

/**
 * The full, resolved configuration object. `ConfigOverride` rows are merged
 * over this at runtime (see `src/lib/config/runtime.ts`), so the economy can be
 * re-balanced without a redeploy.
 */
export const DEFAULT_CONFIG = {
  xp: XP_CONFIG,
  level: LEVEL_CONFIG,
  budget: BUDGET_CONFIG,
  story: STORY_CONFIG,
  momentum: MOMENTUM_CONFIG,
  seasonPass: SEASON_PASS_CONFIG,
  seasonClosure: SEASON_CLOSURE_CONFIG,
  challenge: CHALLENGE_CONFIG,
  strategist: STRATEGIST_CONFIG,
  prestige: PRESTIGE_CONFIG,
  longHaul: TWENTY_FOUR_HOUR_CONFIG,
  mastery: MASTERY_CONFIG,
  milestone: MILESTONE_CONFIG,
  achievementBoard: ACHIEVEMENT_BOARD_CONFIG,
  awards: AWARDS_CONFIG,
  stats: STATS_CONFIG,

  /**
   * The `*_SHAPE` blocks.
   *
   * A `*_CONFIG` block says how much a signal is worth at full strength; the
   * matching `*_SHAPE` block says what full strength is — the saturation
   * points, curve shapes and affinities the weights are multiplied by. They
   * are as much a part of the economy as the weights, so a re-balance has to
   * be able to reach them too.
   */
  budgetShape: BUDGET_SHAPE,
  strategistShape: STRATEGIST_SHAPE,
  challengeShape: CHALLENGE_SHAPE,
  masteryShape: MASTERY_SHAPE,
  seasonPassShape: SEASON_PASS_SHAPE,
  momentumShape: MOMENTUM_SHAPE,
} as const;

export type AppConfig = typeof DEFAULT_CONFIG;
