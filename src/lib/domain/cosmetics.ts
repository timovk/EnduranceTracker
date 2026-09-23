/**
 * Cosmetic selections, resolved without a database.
 *
 * What someone has CHOSEN and what is actually SHOWN are different things, and
 * the gap between them is the whole of this module. A choice can outlive the
 * thing that made it valid — a level title chosen at level 20 when deleting
 * stints has since brought the career back to level 18 — and the display has
 * to fall back quietly rather than show something that is no longer true or
 * crash on something it no longer recognises.
 */

import { LEVEL_TITLES, MILESTONE_REWARDS, STANDARD_REWARDS, type RewardDef } from '@/lib/config';
import { titleForLevel } from '@/lib/domain/progression';

/**
 * The `ConfigOverride` key a chosen display title is stored under.
 *
 * Not `careerProfile.titleKey`: that one is the level ladder's, and it is
 * rewritten on every XP award.
 */
export const DISPLAY_TITLE_KEY = 'displayTitle';

/**
 * How a displayed-title choice is stored.
 *
 * Titles come from two places — the level ladder and the season pass — and the
 * two could one day share a name, so the stored value says which it came from.
 */
export const LEVEL_TITLE_PREFIX = 'level:';
export const PASS_TITLE_PREFIX = 'pass:';

/**
 * The displayed-title choice that means "whatever my level gives me".
 *
 * The default, and not the same as choosing the current level title: that one
 * would stay put while the career moved on past it.
 */
export const AUTOMATIC_TITLE = 'auto';

/**
 * Stored for a badge or banner the account has deliberately cleared.
 *
 * Distinct from null on purpose: the pass fills an EMPTY slot with the first
 * badge or banner earned, so "never had one" and "chose to show none" must not
 * look the same, or clearing it would be undone by the next unlock.
 */
export const NO_SELECTION = 'none';

/** Every title the season pass can award, in pool order. */
export const PASS_TITLES: readonly RewardDef[] = [...STANDARD_REWARDS, ...MILESTONE_REWARDS]
  .filter((reward, index, all) => reward.type === 'TITLE' && all.findIndex((r) => r.key === reward.key) === index);

/** "Title: Quarter Starter" is the reward's name; "Quarter Starter" is the title. */
export function passTitleName(reward: Pick<RewardDef, 'name'>): string {
  return reward.name.replace(/^Title:\s*/, '');
}

export function levelTitleChoice(title: string): string {
  return `${LEVEL_TITLE_PREFIX}${title}`;
}

export function passTitleChoice(rewardKey: string): string {
  return `${PASS_TITLE_PREFIX}${rewardKey}`;
}

/**
 * The title to display for a career.
 *
 * A level title is honoured only while the career is at or above its level. A
 * season-pass title is honoured whenever it names a real reward: pass unlocks
 * are stamped and never revoked, and the choice was checked against them when
 * it was saved. Anything else — no choice, a stale one, an unrecognised one —
 * shows the title the level ladder gives, which is what the career page showed
 * before a choice existed.
 */
export function resolveDisplayTitle(choice: unknown, level: number): string {
  const fallback = titleForLevel(level).title;
  if (typeof choice !== 'string') return fallback;

  if (choice.startsWith(LEVEL_TITLE_PREFIX)) {
    const name = choice.slice(LEVEL_TITLE_PREFIX.length);
    const entry = LEVEL_TITLES.find((title) => title.title === name);
    return entry !== undefined && entry.level <= level ? entry.title : fallback;
  }

  if (choice.startsWith(PASS_TITLE_PREFIX)) {
    const key = choice.slice(PASS_TITLE_PREFIX.length);
    const reward = PASS_TITLES.find((title) => title.key === key);
    return reward !== undefined ? passTitleName(reward) : fallback;
  }

  return fallback;
}

/** The selection to show: the chosen one while it is available, otherwise the fallback. */
export function effectiveSelection<T extends string | null>(
  chosen: string | null | undefined,
  available: ReadonlySet<string>,
  fallback: T,
): string | T {
  return chosen !== null && chosen !== undefined && available.has(chosen) ? chosen : fallback;
}
