/**
 * Achievement definitions.
 *
 * Achievements are discrete accomplishments with a rarity. Every one of them
 * is measured against a named metric from `CareerMetrics` (see
 * `src/lib/engines/metrics.ts`), which is what lets the UI show progress
 * towards an achievement before it unlocks.
 *
 * There is no negative achievement, no expiry and no way to lose one.
 */

import type { Rarity } from '@/lib/domain/types';

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  category: 'firsts' | 'endurance' | 'collection' | 'dedication' | 'variety' | 'mastery' | 'career';
  rarity: Rarity;
  /** Key into `CareerMetrics`. */
  metric: string;
  threshold: number;
  xpReward: number;
  iconKey: string;
  isSecret?: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // -- Firsts ---------------------------------------------------------------
  { key: 'lights_out', name: 'Lights Out', description: 'Complete your first race.', category: 'firsts', rarity: 'COMMON', metric: 'racesCompleted', threshold: 1, xpReward: 500, iconKey: 'flag' },
  { key: 'first_story', name: 'The Whole Story', description: 'Story Complete your first race — every minute of it.', category: 'firsts', rarity: 'COMMON', metric: 'storyCompletes', threshold: 1, xpReward: 1_000, iconKey: 'book' },
  { key: 'first_session', name: 'Green Flag', description: 'Log your first viewing session.', category: 'firsts', rarity: 'COMMON', metric: 'sessions', threshold: 1, xpReward: 200, iconKey: 'play' },
  { key: 'first_major', name: 'The Main Event', description: 'Story Complete a race tagged as a major event.', category: 'firsts', rarity: 'UNCOMMON', metric: 'majorEventStories', threshold: 1, xpReward: 2_000, iconKey: 'star' },
  { key: 'first_season', name: 'Set Complete', description: 'Complete every race of a championship season.', category: 'firsts', rarity: 'RARE', metric: 'seasonsCompleted', threshold: 1, xpReward: 5_000, iconKey: 'layers' },

  // -- Endurance ------------------------------------------------------------
  { key: 'double_stint', name: 'Double Stint', description: 'Watch two hours in a single session.', category: 'endurance', rarity: 'COMMON', metric: 'longestSessionHours', threshold: 2, xpReward: 600, iconKey: 'timer' },
  { key: 'triple_stint', name: 'Triple Stint', description: 'Watch four hours in a single session.', category: 'endurance', rarity: 'UNCOMMON', metric: 'longestSessionHours', threshold: 4, xpReward: 1_500, iconKey: 'timer' },
  { key: 'the_long_game', name: 'The Long Game', description: 'Story Complete a race of at least eight hours.', category: 'endurance', rarity: 'UNCOMMON', metric: 'stories8h', threshold: 1, xpReward: 2_500, iconKey: 'hourglass' },
  { key: 'half_a_day', name: 'Half a Day', description: 'Story Complete a 12-hour race.', category: 'endurance', rarity: 'RARE', metric: 'stories12h', threshold: 1, xpReward: 4_000, iconKey: 'clock' },
  { key: 'twice_around_the_clock', name: 'Twice Around the Clock', description: 'Story Complete a 24-hour race.', category: 'endurance', rarity: 'EPIC', metric: 'stories24h', threshold: 1, xpReward: 10_000, iconKey: 'clock' },
  // The key stays, so its dedupe key is unchanged; the name gives "Expedition" to Race Expeditions (0.4.0).
  { key: 'expedition', name: 'Around the Clock, Three Times', description: 'Story Complete three 24-hour races.', category: 'endurance', rarity: 'LEGENDARY', metric: 'stories24h', threshold: 3, xpReward: 30_000, iconKey: 'mountain' },
  { key: 'night_shift', name: 'Night Shift', description: 'Story Complete five races of 10 hours or more.', category: 'endurance', rarity: 'EPIC', metric: 'stories10h', threshold: 5, xpReward: 15_000, iconKey: 'moon' },

  // -- Dedication -----------------------------------------------------------
  { key: 'first_ten_hours', name: 'Warming Up', description: 'Accumulate ten real viewing hours.', category: 'dedication', rarity: 'COMMON', metric: 'realHours', threshold: 10, xpReward: 500, iconKey: 'gauge' },
  { key: 'century_hours', name: 'One Hundred Hours', description: 'Accumulate 100 real viewing hours.', category: 'dedication', rarity: 'UNCOMMON', metric: 'realHours', threshold: 100, xpReward: 3_000, iconKey: 'gauge' },
  { key: 'five_hundred_hours', name: 'Five Hundred Hours', description: 'Accumulate 500 real viewing hours.', category: 'dedication', rarity: 'EPIC', metric: 'realHours', threshold: 500, xpReward: 15_000, iconKey: 'gauge' },
  { key: 'ironman', name: 'Ironman', description: 'Accumulate 1,000 real viewing hours.', category: 'dedication', rarity: 'LEGENDARY', metric: 'realHours', threshold: 1_000, xpReward: 40_000, iconKey: 'medal' },
  { key: 'the_archive', name: 'The Archive', description: 'Accumulate 2,500 real viewing hours.', category: 'dedication', rarity: 'MYTHIC', metric: 'realHours', threshold: 2_500, xpReward: 120_000, iconKey: 'archive' },
  { key: 'hundred_sessions', name: 'Creature of Habit', description: 'Log 100 viewing sessions.', category: 'dedication', rarity: 'UNCOMMON', metric: 'sessions', threshold: 100, xpReward: 2_000, iconKey: 'list' },
  { key: 'thousand_sessions', name: 'A Thousand Stints', description: 'Log 1,000 viewing sessions.', category: 'dedication', rarity: 'EPIC', metric: 'sessions', threshold: 1_000, xpReward: 20_000, iconKey: 'list' },
  { key: 'active_year', name: 'A Full Season of Life', description: 'Be active on 200 separate days.', category: 'dedication', rarity: 'RARE', metric: 'lifetimeActiveDays', threshold: 200, xpReward: 8_000, iconKey: 'calendar' },

  // -- Variety --------------------------------------------------------------
  { key: 'multiclass_addict', name: 'Multiclass Addict', description: 'Complete races from five different championships.', category: 'variety', rarity: 'RARE', metric: 'championshipsCompleted', threshold: 5, xpReward: 5_000, iconKey: 'grid' },
  { key: 'globe_trotter', name: 'Globe Trotter', description: 'Complete races at 25 different circuits.', category: 'variety', rarity: 'EPIC', metric: 'circuits', threshold: 25, xpReward: 12_000, iconKey: 'globe' },
  { key: 'passport', name: 'Passport', description: 'Complete races in 12 different countries.', category: 'variety', rarity: 'RARE', metric: 'countries', threshold: 12, xpReward: 6_000, iconKey: 'map' },
  { key: 'grand_tour', name: 'Grand Tour', description: 'Complete races at 50 different circuits.', category: 'variety', rarity: 'LEGENDARY', metric: 'circuits', threshold: 50, xpReward: 35_000, iconKey: 'globe' },
  { key: 'every_length', name: 'Every Length', description: 'Story Complete a race of each standard duration.', category: 'variety', rarity: 'EPIC', metric: 'distinctRaceTypesStoried', threshold: 6, xpReward: 14_000, iconKey: 'ruler' },

  // -- Collection -----------------------------------------------------------
  { key: 'season_sweep', name: 'Season Sweep', description: 'Story Complete every race in one championship season.', category: 'collection', rarity: 'EPIC', metric: 'seasonsStoryComplete', threshold: 1, xpReward: 12_000, iconKey: 'trophy' },
  { key: 'collector', name: 'Collector', description: 'Complete three championship seasons.', category: 'collection', rarity: 'RARE', metric: 'seasonsCompleted', threshold: 3, xpReward: 9_000, iconKey: 'layers' },
  { key: 'the_cabinet', name: 'The Cabinet', description: 'Complete ten championship seasons.', category: 'collection', rarity: 'LEGENDARY', metric: 'seasonsCompleted', threshold: 10, xpReward: 45_000, iconKey: 'layers' },
  { key: 'centurion', name: 'Centurion', description: 'Complete 100 race stories.', category: 'collection', rarity: 'LEGENDARY', metric: 'storyCompletes', threshold: 100, xpReward: 50_000, iconKey: 'shield' },
  { key: 'half_century', name: 'Half Century', description: 'Complete 50 race stories.', category: 'collection', rarity: 'EPIC', metric: 'storyCompletes', threshold: 50, xpReward: 18_000, iconKey: 'shield' },
  { key: 'first_dozen', name: 'The First Dozen', description: 'Complete 12 race stories.', category: 'collection', rarity: 'UNCOMMON', metric: 'storyCompletes', threshold: 12, xpReward: 2_500, iconKey: 'shield' },
  { key: 'five_hundred_stories', name: 'The Great Library', description: 'Complete 500 race stories.', category: 'collection', rarity: 'MYTHIC', metric: 'storyCompletes', threshold: 500, xpReward: 200_000, iconKey: 'library' },

  // -- Mastery / career -----------------------------------------------------
  { key: 'level_10', name: 'Rookie Season', description: 'Reach career level 10.', category: 'career', rarity: 'COMMON', metric: 'level', threshold: 10, xpReward: 500, iconKey: 'chevron' },
  { key: 'level_25', name: 'Stint Specialist', description: 'Reach career level 25.', category: 'career', rarity: 'UNCOMMON', metric: 'level', threshold: 25, xpReward: 2_000, iconKey: 'chevron' },
  { key: 'level_50', name: 'Strategy Engineer', description: 'Reach career level 50.', category: 'career', rarity: 'RARE', metric: 'level', threshold: 50, xpReward: 7_500, iconKey: 'chevron' },
  { key: 'level_100', name: 'Endurance Veteran', description: 'Reach career level 100.', category: 'career', rarity: 'EPIC', metric: 'level', threshold: 100, xpReward: 25_000, iconKey: 'chevron' },
  { key: 'level_250', name: 'Long-Haul Specialist', description: 'Reach career level 250.', category: 'career', rarity: 'LEGENDARY', metric: 'level', threshold: 250, xpReward: 100_000, iconKey: 'chevron' },
  { key: 'level_500', name: 'Endurance Master', description: 'Reach career level 500.', category: 'career', rarity: 'MYTHIC', metric: 'level', threshold: 500, xpReward: 250_000, iconKey: 'crown' },
  { key: 'mastery_first', name: 'Specialist', description: 'Complete an entire championship mastery tree.', category: 'mastery', rarity: 'EPIC', metric: 'masteryTreesCompleted', threshold: 1, xpReward: 20_000, iconKey: 'tree' },
  { key: 'mastery_three', name: 'Polymath', description: 'Complete three mastery trees.', category: 'mastery', rarity: 'LEGENDARY', metric: 'masteryTreesCompleted', threshold: 3, xpReward: 60_000, iconKey: 'tree' },
  { key: 'first_pass', name: 'Full Pass', description: 'Reach tier 100 of a quarterly season pass.', category: 'mastery', rarity: 'EPIC', metric: 'seasonPassesCompleted', threshold: 1, xpReward: 15_000, iconKey: 'ticket' },
  { key: 'pass_collector', name: 'Four Quarters', description: 'Complete four quarterly season passes.', category: 'mastery', rarity: 'LEGENDARY', metric: 'seasonPassesCompleted', threshold: 4, xpReward: 50_000, iconKey: 'ticket' },
  { key: 'prestige_one', name: 'Prestige', description: 'Reach your first prestige rank.', category: 'career', rarity: 'LEGENDARY', metric: 'prestige', threshold: 1, xpReward: 30_000, iconKey: 'crown' },

  // -- Repeat events --------------------------------------------------------
  { key: 'annual_pilgrimage', name: 'Annual Pilgrimage', description: 'Story Complete three consecutive editions of the same event.', category: 'mastery', rarity: 'EPIC', metric: 'longestConsecutiveEditions', threshold: 3, xpReward: 10_000, iconKey: 'repeat' },
  { key: 'decade_of_devotion', name: 'A Decade of Devotion', description: 'Story Complete ten editions of the same event.', category: 'mastery', rarity: 'MYTHIC', metric: 'maxEditionsOfOneEvent', threshold: 10, xpReward: 80_000, iconKey: 'repeat' },

  // -- Quiet, kind secrets --------------------------------------------------
  { key: 'the_return', name: 'Welcome Back', description: 'Pick a race back up after a long break. The library waits.', category: 'firsts', rarity: 'UNCOMMON', metric: 'longBreakReturns', threshold: 1, xpReward: 1_200, iconKey: 'heart', isSecret: true },
  { key: 'patient_viewer', name: 'Patient Viewer', description: 'Story Complete a race across ten or more separate sessions.', category: 'endurance', rarity: 'RARE', metric: 'maxSessionsForOneStory', threshold: 10, xpReward: 4_000, iconKey: 'puzzle', isSecret: true },
  { key: 'the_purist', name: 'The Purist', description: 'Story Complete a race entirely at 1.0x playback speed.', category: 'endurance', rarity: 'RARE', metric: 'puristStories', threshold: 1, xpReward: 3_500, iconKey: 'feather', isSecret: true },
] as const;

export const ACHIEVEMENTS_BY_KEY: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map((a) => [a.key, a]),
);
