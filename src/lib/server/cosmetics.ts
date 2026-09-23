/**
 * What an account has unlocked, what it has chosen, and what is shown.
 *
 * Every cosmetic has one free default and is otherwise earned through the
 * season pass (or, for titles, the level ladder). The pass engine stamps what
 * has been earned; this module is the one place that turns those stamps into
 * the answer to "can I pick this?" — for the pickers in Settings, for the
 * server action that saves a choice, and for every page that draws one.
 *
 * Nothing here ever changes what is stored. A choice that is not currently
 * available simply is not shown, so if it becomes available again (a level
 * regained, say) it comes back on its own.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import {
  DEFAULT_RACE_CARD_KEY, DEFAULT_THEME_KEY, LEVEL_TITLES, MILESTONE_REWARDS, RACE_CARD_STYLES,
  STANDARD_REWARDS, THEMES, type RewardDef,
} from '@/lib/config';
import type { Rarity, RewardType } from '@/lib/domain/types';
import { levelFromXp, titleForLevel } from '@/lib/domain/progression';
import { quarterOf } from '@/lib/domain/periods';
import { isSeasonClosed, reopeningSeason } from '@/lib/domain/season-closure';
import {
  AUTOMATIC_TITLE, DISPLAY_TITLE_KEY, NO_SELECTION, PASS_TITLES, effectiveSelection, levelTitleChoice, passTitleChoice, passTitleName, resolveDisplayTitle,
} from '@/lib/domain/cosmetics';
import {
  nextPassAppearance, nextSeason, quarterLabel, selectionKeyFor, type PassSeason,
} from '@/lib/engines/season-pass-engine';

export { AUTOMATIC_TITLE, DISPLAY_TITLE_KEY, NO_SELECTION };


export type CosmeticKind = 'theme' | 'raceCard' | 'badge' | 'banner' | 'title';

export interface CosmeticOption {
  /** What is stored when this option is chosen. */
  value: string;
  name: string;
  description?: string;
  /** A swatch colour, where the option has one. */
  color?: string;
  rarity?: Rarity;
  unlocked: boolean;
  /** Where it came from, or where it can be earned — printed as written. */
  source: string;
}

export interface CosmeticSlot {
  /** What the account has chosen, as stored. */
  chosen: string | null;
  /** What is actually shown: the choice while it is available, otherwise the default. */
  effective: string | null;
  options: CosmeticOption[];
}

export interface CosmeticState {
  theme: CosmeticSlot;
  raceCard: CosmeticSlot;
  badge: CosmeticSlot;
  banner: CosmeticSlot;
  title: CosmeticSlot & {
    /** The title actually shown. */
    effectiveName: string;
    /** The title the level gives — what "Automatic" means right now. */
    automaticName: string;
  };
}

/** What a page needs to draw an account's look, without the pickers' detail. */
export interface EffectiveCosmetics {
  themeKey: string;
  raceCardKey: string;
  badgeKey: string | null;
  bannerKey: string | null;
  title: string;
}

const COSMETIC_TYPES: RewardType[] = ['THEME', 'RACE_CARD', 'BADGE', 'BANNER', 'TITLE'];

interface Unlock {
  rewardKey: string;
  selectionKey: string;
  type: RewardType;
  passLabel: string;
  tier: number;
}

/** Every cosmetic the account's passes have stamped, earliest first. */
async function unlocksOf(userId: string, db: Tx): Promise<Unlock[]> {
  const rows = await db.seasonPassProgress.findMany({
    where: { seasonPass: { userId }, unlockedAt: { not: null }, rewardType: { in: COSMETIC_TYPES } },
    orderBy: { unlockedAt: 'asc' },
    select: { tier: true, rewardKey: true, rewardType: true, seasonPass: { select: { year: true, quarter: true } } },
  });

  const seen = new Set<string>();
  const unlocks: Unlock[] = [];
  for (const row of rows) {
    if (seen.has(row.rewardKey)) continue;
    seen.add(row.rewardKey);
    unlocks.push({
      rewardKey: row.rewardKey,
      selectionKey: selectionKeyFor({ key: row.rewardKey, type: row.rewardType }),
      type: row.rewardType,
      passLabel: quarterLabel(row.seasonPass.year, row.seasonPass.quarter),
      tier: row.tier,
    });
  }
  return unlocks;
}

function selectionKeysOf(unlocks: Unlock[], type: RewardType): Set<string> {
  return new Set(unlocks.filter((unlock) => unlock.type === type).map((unlock) => unlock.selectionKey));
}

async function displayTitleChoice(userId: string, db: Tx): Promise<string | null> {
  const row = await db.configOverride.findUnique({
    where: { userId_key: { userId, key: DISPLAY_TITLE_KEY } },
    select: { value: true },
  });
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * The account's look, as shown.
 *
 * Cheap enough for the root layout, which needs the theme on every page: three
 * small reads and no pass-track arithmetic.
 */
export async function getEffectiveCosmetics(userId: string, db: Tx = prisma): Promise<EffectiveCosmetics> {
  const [profile, unlocks, titleChoice] = await Promise.all([
    db.careerProfile.findUnique({
      where: { userId },
      select: { careerXp: true, themeKey: true, raceCardKey: true, badgeKey: true, bannerKey: true },
    }),
    unlocksOf(userId, db),
    displayTitleChoice(userId, db),
  ]);

  const level = levelFromXp(Number(profile?.careerXp ?? 0)).level;
  const themes = selectionKeysOf(unlocks, 'THEME').add(DEFAULT_THEME_KEY);
  const cards = selectionKeysOf(unlocks, 'RACE_CARD').add(DEFAULT_RACE_CARD_KEY);

  return {
    themeKey: effectiveSelection(profile?.themeKey, themes, DEFAULT_THEME_KEY),
    raceCardKey: effectiveSelection(profile?.raceCardKey, cards, DEFAULT_RACE_CARD_KEY),
    badgeKey: effectiveSelection(profile?.badgeKey, selectionKeysOf(unlocks, 'BADGE'), null),
    bannerKey: effectiveSelection(profile?.bannerKey, selectionKeysOf(unlocks, 'BANNER'), null),
    title: resolveDisplayTitle(titleChoice, level),
  };
}

/** Every reward of a type across both pools, first occurrence only. */
function rewardsOfType(type: RewardType): RewardDef[] {
  const all = [...STANDARD_REWARDS, ...MILESTONE_REWARDS];
  return all.filter((reward, index) => reward.type === type && all.findIndex((r) => r.key === reward.key) === index);
}

/**
 * The account's look, with every option each picker can offer and where each
 * locked one can be earned.
 */
export async function getCosmeticState(
  userId: string,
  db: Tx = prisma,
  now: Date = new Date(),
): Promise<CosmeticState> {
  // While the season is closed (0.3.1) there is no pass this quarter, so the
  // search for where a cosmetic can be earned starts from the quarter that
  // reopens, and this quarter's rows — there should be none — are not read.
  const closed = isSeasonClosed(now);
  const season: PassSeason = closed ? reopeningSeason() : { year: now.getFullYear(), quarter: quarterOf(now) };
  const noRows: { tier: number; rewardKey: string; unlockedAt: Date | null }[] = [];

  const [profile, unlocks, titleChoice, currentRows] = await Promise.all([
    db.careerProfile.findUnique({
      where: { userId },
      select: { careerXp: true, themeKey: true, raceCardKey: true, badgeKey: true, bannerKey: true },
    }),
    unlocksOf(userId, db),
    displayTitleChoice(userId, db),
    closed
      ? noRows
      : db.seasonPassProgress.findMany({
          where: { seasonPass: { userId, year: season.year, quarter: season.quarter }, rewardType: { in: COSMETIC_TYPES } },
          select: { tier: true, rewardKey: true, unlockedAt: true },
          orderBy: { tier: 'asc' },
        }),
  ]);

  const level = levelFromXp(Number(profile?.careerXp ?? 0)).level;
  const unlockByKey = new Map(unlocks.map((unlock) => [unlock.rewardKey, unlock]));

  /**
   * Where a pass reward came from, or where it can next be earned. This
   * quarter's stored track is read first because it is what the Season Pass
   * page is showing; later quarters are worked out from the rotation.
   */
  function passSource(rewardKey: string): { unlocked: boolean; source: string } {
    const unlock = unlockByKey.get(rewardKey);
    if (unlock) return { unlocked: true, source: `Earned in the ${unlock.passLabel} pass, tier ${unlock.tier}` };

    const thisQuarter = currentRows.find((row) => row.rewardKey === rewardKey && row.unlockedAt === null);
    if (thisQuarter) return { unlocked: false, source: `This quarter's season pass, tier ${thisQuarter.tier}` };

    const later = nextPassAppearance(rewardKey, currentRows.length > 0 ? nextSeason(season) : season);
    if (later) {
      return {
        unlocked: false,
        source: `The ${quarterLabel(later.season.year, later.season.quarter)} season pass, tier ${later.tier}`,
      };
    }
    return { unlocked: false, source: 'Not in the season pass at the moment' };
  }

  const FREE = 'Every account has this';

  const themeOptions: CosmeticOption[] = THEMES.map((theme) => ({
    value: theme.key,
    name: theme.name,
    description: theme.description,
    color: theme.accent,
    ...(theme.key === DEFAULT_THEME_KEY ? { unlocked: true, source: FREE } : passSource(`theme_${theme.key}`)),
  }));

  const cardOptions: CosmeticOption[] = RACE_CARD_STYLES.map((card) => ({
    value: card.key,
    name: card.name,
    description: card.description,
    ...(card.key === DEFAULT_RACE_CARD_KEY ? { unlocked: true, source: FREE } : passSource(`card_${card.key}`)),
  }));

  function collectibleOptions(type: 'BADGE' | 'BANNER'): CosmeticOption[] {
    return rewardsOfType(type).map((reward) => ({
      value: selectionKeyFor(reward),
      name: reward.name,
      color: reward.color,
      rarity: reward.rarity,
      ...passSource(reward.key),
    }));
  }

  const titleOptions: CosmeticOption[] = [
    ...LEVEL_TITLES.map((title) => ({
      value: levelTitleChoice(title.title),
      name: title.title,
      unlocked: title.level <= level,
      source: `Career level ${title.level}`,
    })),
    ...PASS_TITLES.map((reward) => ({
      value: passTitleChoice(reward.key),
      name: passTitleName(reward),
      rarity: reward.rarity,
      ...passSource(reward.key),
    })),
  ];

  function slot(chosen: string | null | undefined, options: CosmeticOption[], fallback: string | null): CosmeticSlot {
    const available = new Set(options.filter((option) => option.unlocked).map((option) => option.value));
    return { chosen: chosen ?? null, effective: effectiveSelection(chosen, available, fallback), options };
  }

  const levelDefault = levelTitleChoice(titleForLevel(level).title);
  const title = slot(titleChoice, titleOptions, levelDefault);

  return {
    theme: slot(profile?.themeKey, themeOptions, DEFAULT_THEME_KEY),
    raceCard: slot(profile?.raceCardKey, cardOptions, DEFAULT_RACE_CARD_KEY),
    badge: slot(profile?.badgeKey, collectibleOptions('BADGE'), null),
    banner: slot(profile?.bannerKey, collectibleOptions('BANNER'), null),
    title: {
      ...title,
      effectiveName: titleOptions.find((option) => option.value === title.effective)?.name ?? titleForLevel(level).title,
      automaticName: titleForLevel(level).title,
    },
  };
}

/**
 * Whether a value may be saved into a slot.
 *
 * Badges and banners may also be cleared, and the title may be left to follow
 * the level. Everything else has to be an option
 * the account has unlocked — the pickers only offer those, but a server action
 * is reachable without the picker, so the rule lives here rather than there.
 */
export function isChoosable(state: CosmeticState, kind: CosmeticKind, value: string): boolean {
  if ((kind === 'badge' || kind === 'banner') && value === NO_SELECTION) return true;
  if (kind === 'title' && value === AUTOMATIC_TITLE) return true;
  return state[kind].options.some((option) => option.value === value && option.unlocked);
}
