/**
 * Shared engine result types.
 *
 * The session engine orchestrates every other engine after a stint is logged.
 * These types are the contract between them, so each engine can be written,
 * tested and re-balanced independently.
 *
 * Rule for every engine in this directory: they take a transaction client and
 * never open their own, so that one logged session is one atomic write.
 */

import type {
  ChallengeScope, HallOfFameCategory, MilestonePrecision, Rarity, RewardType, TrophyCategory,
} from '@/lib/domain/types';

// ---------------------------------------------------------------------------
// Unlocks — the things a session can produce
// ---------------------------------------------------------------------------

export interface AchievementUnlock {
  key: string;
  name: string;
  description: string;
  rarity: Rarity;
  iconKey: string;
  xpAwarded: number;
}

export interface MilestoneUnlock {
  metric: string;
  label: string;
  threshold: number;
  value: number;
  xpAwarded: number;
}

/**
 * A Career Milestone (0.4.0) as a stint summary shows it: a catalogue row
 * whose moment this stint was. Dates are ISO strings, because the summary
 * reaches the page through a JSON route.
 */
export interface CareerMilestoneUnlock {
  /** The catalogue id (`CAREER_MILESTONES`); every year's rung is `year-plan`. */
  id: string;
  /** The title, with the year filled in for a year's rung. */
  title: string;
  /** `MilestoneProgress.metric`, e.g. `realHours` or `realHoursYear:2027`. */
  metric: string;
  threshold: number;
  /** When it happened, when history can say; null for a RECOGNISED row. */
  achievedAt: string | null;
  precision: MilestonePrecision | null;
  /** When the app recorded it (`reachedAt`). */
  recordedAt: string | null;
  /** The race or event it happened in, by the name it had then. */
  subjectName: string | null;
  xpAwarded: number;
  celebration: 'none' | 'notable' | 'spectacular';
}

export interface MasteryUnlock {
  treeKey: string;
  treeName: string;
  nodeKey: string;
  nodeName: string;
  description: string;
  rarity: Rarity;
  xpAwarded: number;
  /** Tree completion after this unlock, 0-1. */
  treeProgress: number;
  /** True when this unlock completed the whole tree. */
  treeCompleted: boolean;
}

export interface ChallengeCompletion {
  id: string;
  scope: ChallengeScope;
  title: string;
  xpAwarded: number;
  seasonXpAwarded: number;
}

export interface SeasonPassTierUnlock {
  tier: number;
  rewardKey: string;
  rewardName: string;
  rewardType: RewardType;
  rarity: Rarity;
  isMilestone: boolean;
}

export interface CollectionOutcome {
  /** Collections whose every card is now filled. */
  completedCollections: {
    key: string;
    name: string;
    itemCount: number;
    storyCompleteCount: number;
    xpAwarded: number;
  }[];
  /** Cards filled by this session. */
  filledItems: { collectionKey: string; collectionName: string; itemName: string; storyComplete: boolean }[];
}

export interface TrophyAward {
  key: string;
  name: string;
  description: string;
  category: TrophyCategory;
  rarity: Rarity;
  iconKey: string;
}

export interface HallOfFameAward {
  key: string;
  title: string;
  subtitle: string | null;
  category: HallOfFameCategory;
  rarity: Rarity;
}

// ---------------------------------------------------------------------------
// Momentum
// ---------------------------------------------------------------------------

export interface MomentumState {
  points: number;
  tierKey: string;
  tierName: string;
  tierColor: string;
  tierBlurb: string;
  /** 0-1 progress towards the next tier; 1 at the top tier. */
  progressToNext: number;
  nextTierName: string | null;
  pointsToNext: number;
  /** Small Season XP bonus fraction (never applies to career XP). */
  seasonXpBonus: number;
}

export interface StreakState {
  currentDays: number;
  longestDays: number;
  lifetimeActiveDays: number;
  lifetimeActiveWeeks: number;
  lastActiveDate: Date | null;
  /** Days since the last activity. Used only for the welcome-back greeting. */
  daysSinceLastActive: number;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface WeekAllocation {
  isoYear: number;
  isoWeek: number;
  weekStart: Date;
  weekEnd: Date;
  recommendedHours: number;
  /** Human-readable factors behind the recommendation. */
  rationale: string[];
  isRestWeek: boolean;
  isCurrent: boolean;
  actualHours: number;
}

export interface BudgetSnapshot {
  year: number;
  annualBudgetHours: number;
  /** Real viewing hours used so far this year. */
  usedHours: number;
  remainingHours: number;
  percentConsumed: number;

  /** Hours per week implied by simply dividing what is left by what remains. */
  basePaceHours: number;
  /** What the adaptive engine suggests, blending base pace with demand. */
  recommendedPaceHours: number;

  /** Straight-line projection of where the year finishes at the current pace. */
  projectedYearEndHours: number;
  /** Neutral, never-scolding sentence about the projection. */
  projectionNote: string;

  /**
   * Hours ahead of (positive) or behind (negative) the adaptive target.
   * Presented as information, never as a deficit to repay.
   */
  hoursVersusTarget: number;

  // -- This week ----------------------------------------------------------
  weekRecommendedHours: number;
  weekActualHours: number;
  weekRemainingHours: number;
  weekRationale: string[];
  weekIsRest: boolean;
  weekStart: Date;
  weekEnd: Date;

  /** Forward-looking allocations, for the planning chart. */
  upcomingWeeks: WeekAllocation[];
  /** Completed weeks this year, for the history chart. */
  pastWeeks: WeekAllocation[];

  weeksRemaining: number;
}

// ---------------------------------------------------------------------------
// Race Strategist
// ---------------------------------------------------------------------------

export type RecommendationKind = 'CONTINUE' | 'BEST_FIT' | 'WILDCARD';

export interface Recommendation {
  kind: RecommendationKind;
  raceId: string;
  raceName: string;
  championshipName: string | null;
  championshipColor: string | null;
  circuit: string | null;
  runtimeSec: number;
  coverageSec: number;
  completionPercent: number;
  /** Real seconds needed to finish the story at the user's usual speed. */
  realSecondsToFinish: number;
  /** Real seconds of the next suggested stint (long races are divided up). */
  suggestedStintSeconds: number;
  isMajorEvent: boolean;
  /** One sentence the UI shows verbatim. Never phrased as an instruction. */
  headline: string;
  /** Supporting reasons, shown as chips. */
  reasons: string[];
  /** Internal score, exposed for debugging and for the tests. */
  score: number;
}

/**
 * Unfinished races the strategist left out because they have not been run yet
 * (0.3.2). The races themselves are not exposed: they are not shown until they
 * can be watched.
 */
export interface StillToCome {
  count: number;
  /** Local midnight on the first day one of them is on; null when count is 0. */
  nextRaceDay: Date | null;
}

/** Everything the Race Strategist panel shows. */
export interface StrategistView {
  recommendations: Recommendation[];
  stillToCome: StillToCome;
}

// ---------------------------------------------------------------------------
// Session removal — what deleting a stint took back
// ---------------------------------------------------------------------------

/**
 * The result of removing a logged stint.
 *
 * Everything here is reported so the UI can state it plainly. Removing a stint
 * is a correction, and a correction the user cannot see the effect of is
 * indistinguishable from a bug — which is exactly how the previous behaviour,
 * where the coverage fell but the XP silently stayed, read to the person using
 * it.
 */
export interface SessionRemoval {
  raceId: string;
  /** Career XP the stint is taking back with it. Never negative. */
  careerXpRemoved: number;
  seasonXpRemoved: number;
  /** True when the race stopped being Story Complete, so its bonus went too. */
  storyBonusRemoved: boolean;
  levelBefore: number;
  levelAfter: number;
  careerXpBefore: number;
  careerXpAfter: number;
  /** Stints still logged against this race afterwards. */
  remainingSessions: number;
}

/**
 * The result of removing a whole race from the library (0.4.0, owner decision
 * D4): the XP its viewing earned goes with it, exactly as if its stints had
 * been deleted one by one. Achievements, milestones and every other landmark
 * it helped reach stay.
 */
export interface RaceRemoval {
  raceName: string;
  sessionsRemoved: number;
  /** Career XP taken back: viewing, re-watch and the Story Complete bonus. Never negative. */
  careerXpRemoved: number;
  seasonXpRemoved: number;
  /** True when the race held its Story Complete bonus, which went with it. */
  storyBonusRemoved: boolean;
  levelBefore: number;
  levelAfter: number;
}

// ---------------------------------------------------------------------------
// Session result — what the stint summary screen renders
// ---------------------------------------------------------------------------

/**
 * The season closure (0.3.1) as a stint summary carries it: the quarter whose
 * pass opens next, and the instant it opens. The instant is an ISO string
 * because the summary reaches the page through a JSON route, where a `Date`
 * would arrive as a string anyway and a type saying otherwise would lie.
 */
export interface SeasonClosureNotice {
  /** "Q4 2026". */
  label: string;
  /** Local midnight at which the pass opens, as `Date.toISOString()`. */
  reopensAt: string;
}

export interface SessionOutcome {
  sessionId: string;
  raceId: string;
  raceName: string;

  realSeconds: number;
  timelineSeconds: number;
  newCoverageSeconds: number;
  playbackSpeed: number;

  coverageBeforePercent: number;
  coverageAfterPercent: number;
  /**
   * The same coverage in seconds, with the race's runtime, so a percentage can
   * be shown with `formatCoveragePercent`, which never rounds a gap up to 100%.
   */
  coverageBeforeSec: number;
  coverageAfterSec: number;
  runtimeSec: number;

  careerXpAwarded: number;
  seasonXpAwarded: number;
  xpBreakdown: { label: string; amount: number }[];
  /**
   * Set when the stint was logged while the season pass was closed, so it
   * earned no season XP; the summary says when the pass opens instead of
   * showing a season XP figure. Null for a stint logged while it was open.
   */
  seasonClosure: SeasonClosureNotice | null;

  levelBefore: number;
  levelAfter: number;
  levelsGained: number;
  newTitle: string | null;
  prestigeGained: number;

  storyCompleted: boolean;
  storyCompleteBonus: number;

  achievements: AchievementUnlock[];
  /**
   * Rungs of the lifetime ladders this stint reached, leaving out the rungs
   * that are Career Milestones: those are in `careerMilestones`, so nothing is
   * listed twice.
   */
  milestones: MilestoneUnlock[];
  /** The Career Milestones whose moment was this stint (0.4.0). */
  careerMilestones: CareerMilestoneUnlock[];
  mastery: MasteryUnlock[];
  challenges: ChallengeCompletion[];
  seasonPassTiers: SeasonPassTierUnlock[];
  collections: CollectionOutcome;
  trophies: TrophyAward[];
  hallOfFame: HallOfFameAward[];

  momentum: MomentumState;
  streak: StreakState;

  /** Weekly budget position after the session, for the summary footer. */
  weekActualHours: number;
  weekRecommendedHours: number;

  /** Championship mastery percentage after the session, if applicable. */
  championshipMastery: { name: string; percent: number } | null;

  /** Heading for the summary screen, chosen by session length. */
  heading: string;
  /**
   * Whether this deserves the full-screen treatment. Reserved for rare things
   * — a completed 24-hour race, a finished season, a major career milestone.
   * Ordinary stints get a quiet, satisfying panel instead.
   */
  celebrate: 'QUIET' | 'NOTABLE' | 'SPECTACULAR';
}
