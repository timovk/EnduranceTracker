/**
 * The season closure (0.3.1), resolved without a database.
 *
 * The season pass and seasonal challenges are closed until
 * `SEASON_CLOSURE_CONFIG.reopensOn`. Every closure decision in the engines goes
 * through `isSeasonClosed(now)` with the `now` the engine was handed, never
 * the clock, so both sides of the boundary can be tested.
 */

import { SEASON_CLOSURE_CONFIG } from '@/lib/config/economy';
import { quarterOf } from '@/lib/domain/periods';

/** The shape of `SEASON_CLOSURE_CONFIG`, so a test can pass a hypothetical date. */
export interface SeasonClosureConfig {
  reopensOn: { year: number; month: number; day: number };
}

/**
 * The instant the season reopens: local midnight at the start of the
 * configured day. Local, not UTC, because quarters are local (`quarterBounds`)
 * and the reopening is the start of one.
 */
export function seasonReopensAt(config: SeasonClosureConfig = SEASON_CLOSURE_CONFIG): Date {
  const { year, month, day } = config.reopensOn;
  return new Date(year, month - 1, day);
}

/** Whether the season pass and seasonal challenges are closed at `now`. */
export function isSeasonClosed(now: Date, config: SeasonClosureConfig = SEASON_CLOSURE_CONFIG): boolean {
  return now.getTime() < seasonReopensAt(config).getTime();
}

/** The quarter whose pass opens at the reopening — Q4 2026. */
export function reopeningSeason(config: SeasonClosureConfig = SEASON_CLOSURE_CONFIG): { year: number; quarter: number } {
  const at = seasonReopensAt(config);
  return { year: at.getFullYear(), quarter: quarterOf(at) };
}
