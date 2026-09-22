/**
 * Domain types shared by the pure logic, the engines and the UI.
 *
 * These mirror the Prisma enums but are declared independently so that pure
 * domain modules (and their tests) never need to import the generated client.
 */

export type RaceType = 'SPRINT_ENDURANCE' | 'H4' | 'H6' | 'H8' | 'H10' | 'H12' | 'H24' | 'CUSTOM';
export type RaceStatus = 'UNWATCHED' | 'QUEUED' | 'WATCHING' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'ARCHIVED';
export type RacePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'MUST_WATCH';
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';
export type ChallengeScope = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'SEASONAL';
export type ChallengeState = 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
export type MasteryKind = 'CHAMPIONSHIP' | 'RACE_EVENT' | 'GLOBAL';
export type CollectionKind = 'SEASON' | 'MAJOR_EVENT' | 'CIRCUIT' | 'CUSTOM';
export type TrophyCategory = 'SEASON' | 'MAJOR_EVENT' | 'MASTERY' | 'PRESTIGE' | 'ACHIEVEMENT' | 'SEASON_PASS' | 'MILESTONE';
export type HallOfFameCategory = 'FIRST' | 'MILESTONE' | 'SEASON' | 'MAJOR_EVENT' | 'CAREER' | 'MASTERY' | 'SEASON_PASS' | 'PRESTIGE';
export type RewardType =
  | 'BADGE' | 'TITLE' | 'THEME' | 'RACE_CARD' | 'TROPHY_ITEM' | 'PATCH'
  | 'EMBLEM' | 'BANNER' | 'POSTER' | 'XP_BONUS' | 'HALL_OF_FAME_COLLECTIBLE';
export type XPSource =
  | 'VIEWING' | 'REWATCH' | 'STORY_COMPLETE' | 'RACE_COMPLETE' | 'ACHIEVEMENT'
  | 'CHALLENGE' | 'MASTERY_NODE' | 'SEASON_COMPLETE' | 'MAJOR_EVENT' | 'MILESTONE'
  | 'SEASON_PASS_TIER' | 'PRESTIGE' | 'HALL_OF_FAME' | 'MANUAL_ADJUSTMENT';

export const RARITY_ORDER: readonly Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];

/** A half-open span of the race timeline, in seconds: [start, end). */
export interface Interval {
  start: number;
  end: number;
}
