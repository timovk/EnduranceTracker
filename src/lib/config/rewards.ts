/**
 * Season-pass reward pool.
 *
 * Every reward here is cosmetic, statistical or collectible. None of them make
 * future progression objectively easier, which is what allows a quarter to
 * expire on a real deadline without damaging the permanent career.
 *
 * `XP_BONUS` rewards are one-off career XP grants, not multipliers — they pay
 * out once and change nothing afterwards.
 */

import type { Rarity, RewardType } from '@/lib/domain/types';

export interface RewardDef {
  key: string;
  name: string;
  type: RewardType;
  rarity: Rarity;
  /** For XP_BONUS rewards. */
  amount?: number;
  /** Accent colour for badges, banners and emblems. */
  color?: string;
}

/** Rewards for ordinary tiers, cycled through deterministically. */
export const STANDARD_REWARDS: readonly RewardDef[] = [
  { key: 'patch_apex', name: 'Apex Patch', type: 'PATCH', rarity: 'COMMON', color: '#8b98a5' },
  { key: 'badge_greenflag', name: 'Green Flag Badge', type: 'BADGE', rarity: 'COMMON', color: '#3fa06b' },
  { key: 'xp_small', name: 'XP Bonus', type: 'XP_BONUS', rarity: 'COMMON', amount: 1_500 },
  { key: 'patch_stint', name: 'Stint Patch', type: 'PATCH', rarity: 'COMMON', color: '#5b6b7a' },
  { key: 'card_timing', name: 'Timing Screen Race Card', type: 'RACE_CARD', rarity: 'UNCOMMON' },
  { key: 'badge_pitlane', name: 'Pit Lane Badge', type: 'BADGE', rarity: 'COMMON', color: '#c8a45c' },
  { key: 'xp_medium', name: 'XP Bonus', type: 'XP_BONUS', rarity: 'UNCOMMON', amount: 3_000 },
  { key: 'patch_nightrun', name: 'Night Run Patch', type: 'PATCH', rarity: 'UNCOMMON', color: '#3f5f8f' },
  { key: 'emblem_sector', name: 'Sector Emblem', type: 'EMBLEM', rarity: 'COMMON', color: '#8b98a5' },
  { key: 'poster_sunrise', name: 'Sunrise Commemorative Poster', type: 'POSTER', rarity: 'UNCOMMON' },
  { key: 'badge_doublestint', name: 'Double Stint Badge', type: 'BADGE', rarity: 'UNCOMMON', color: '#c8a45c' },
  { key: 'xp_large', name: 'XP Bonus', type: 'XP_BONUS', rarity: 'RARE', amount: 6_000 },
  { key: 'card_telemetry', name: 'Telemetry Race Card', type: 'RACE_CARD', rarity: 'RARE' },
  { key: 'patch_safetycar', name: 'Safety Car Patch', type: 'PATCH', rarity: 'UNCOMMON', color: '#d9a13a' },
  { key: 'emblem_chicane', name: 'Chicane Emblem', type: 'EMBLEM', rarity: 'UNCOMMON', color: '#3fa06b' },
  { key: 'banner_paddock', name: 'Paddock Banner', type: 'BANNER', rarity: 'UNCOMMON' },
  { key: 'poster_rain', name: 'Wet Race Poster', type: 'POSTER', rarity: 'RARE' },
  { key: 'badge_hyperpole', name: 'Hyperpole Badge', type: 'BADGE', rarity: 'RARE', color: '#c0504d' },
];

/**
 * The themes the pass can award.
 *
 * Graphite is not among them: it is what every account starts with, and a
 * reward that grants something you already have is not a reward. Declared
 * before the milestone pool because the pool and the rotation below share
 * these exact objects.
 */
export const THEME_REWARDS = {
  midnight: { key: 'theme_midnight', name: 'Midnight Dashboard Theme', type: 'THEME', rarity: 'EPIC' },
  sarthe: { key: 'theme_sarthe', name: 'Sarthe Dashboard Theme', type: 'THEME', rarity: 'RARE' },
  daytona: { key: 'theme_daytona', name: 'Daytona Dashboard Theme', type: 'THEME', rarity: 'RARE' },
  nordschleife: { key: 'theme_nordschleife', name: 'Nordschleife Dashboard Theme', type: 'THEME', rarity: 'EPIC' },
} as const satisfies Record<string, RewardDef>;

/** Bigger rewards for milestone tiers (every 10th by default). */
export const MILESTONE_REWARDS: readonly RewardDef[] = [
  { key: 'title_quarter_starter', name: 'Title: Quarter Starter', type: 'TITLE', rarity: 'UNCOMMON' },
  // A THEME entry here marks a rotating slot — see THEME_ROTATION. The theme
  // named is only what a track built without a quarter shows.
  THEME_REWARDS.sarthe,
  { key: 'trophy_q_bronze', name: 'Quarterly Bronze Trophy', type: 'TROPHY_ITEM', rarity: 'RARE' },
  { key: 'card_hyperpole', name: 'Hyperpole Race Card', type: 'RACE_CARD', rarity: 'RARE' },
  { key: 'title_halfway', name: 'Title: Halfway Marker', type: 'TITLE', rarity: 'RARE' },
  THEME_REWARDS.midnight,
  { key: 'trophy_q_silver', name: 'Quarterly Silver Trophy', type: 'TROPHY_ITEM', rarity: 'EPIC' },
  { key: 'banner_sarthe', name: 'Long Straight Banner', type: 'BANNER', rarity: 'EPIC' },
  { key: 'hof_quarter', name: 'Hall of Fame Collectible: Quarter Plate', type: 'HALL_OF_FAME_COLLECTIBLE', rarity: 'LEGENDARY' },
  { key: 'trophy_q_gold', name: 'Quarterly Gold Trophy', type: 'TROPHY_ITEM', rarity: 'LEGENDARY' },
];

/**
 * Which themes a quarter's pass offers in its theme slots.
 *
 * The milestone track has two theme slots and there are four themes to earn,
 * so they alternate by quarter: any two consecutive quarters offer all four,
 * and nothing else on the milestone track had to be given up to make room.
 * Indexed by `year * 4 + (quarter - 1)`, modulo the length.
 */
export const THEME_ROTATION: readonly (readonly [RewardDef, RewardDef])[] = [
  [THEME_REWARDS.nordschleife, THEME_REWARDS.midnight],
  [THEME_REWARDS.sarthe, THEME_REWARDS.daytona],
];

/**
 * The theme every account has from the start. The rest are earned through
 * the season pass.
 */
export const DEFAULT_THEME_KEY = 'graphite';

/** The race card every account has from the start. */
export const DEFAULT_RACE_CARD_KEY = 'classic';

/** Dashboard themes. Graphite is free; the others come from the pass. Purely visual. */
export const THEMES = [
  { key: 'graphite', name: 'Graphite', description: 'The default broadcast look.', accent: '#c8a45c' },
  { key: 'midnight', name: 'Midnight', description: 'Deep blue, for the small hours.', accent: '#4f8fd0' },
  { key: 'sarthe', name: 'Sarthe', description: 'Green and gold, long straights.', accent: '#3fa06b' },
  { key: 'daytona', name: 'Daytona', description: 'High-banked amber.', accent: '#d97a3a' },
  { key: 'nordschleife', name: 'Nordschleife', description: 'Grey skies, green hell.', accent: '#7f9f4f' },
] as const;

/** Race-card designs. Classic is free; the others come from the pass. Purely visual. */
export const RACE_CARD_STYLES = [
  { key: 'classic', name: 'Classic', description: 'Clean panel with a coverage bar.' },
  { key: 'timing', name: 'Timing Screen', description: 'Monospaced, sector-striped.' },
  { key: 'telemetry', name: 'Telemetry', description: 'Trace lines behind the numbers.' },
  { key: 'hyperpole', name: 'Hyperpole', description: 'High-contrast, single accent.' },
] as const;
