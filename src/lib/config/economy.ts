/**
 * Central game-balance configuration.
 *
 * Every tunable number in the progression economy lives here (or in a sibling
 * module re-exported from `./index`). Nothing in `engines/`, `domain/` or the
 * UI is allowed to hard-code a balance constant — that is what makes the whole
 * economy re-balanceable later, and what makes the tests meaningful.
 *
 * Values can additionally be overridden at runtime via the `ConfigOverride`
 * table (see `loadConfig` in `./runtime.ts`).
 */

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

export const XP_CONFIG = {
  /** Ordinary watching is the main source of XP. 30 XP per real-world minute. */
  xpPerRealMinute: 30,

  /**
   * Re-watching a section you have already seen still counts as real viewing
   * time, but awards a fraction of the XP. This is the anti-exploit that stops
   * "log the same interval ten times" from being a strategy, while keeping a
   * genuine re-watch worthwhile.
   */
  rewatchXpMultiplier: 0.25,

  /**
   * Playback speed cannot inflate XP: XP follows *real* time, and faster
   * playback means less real time. The opposite exploit — claiming an
   * implausibly slow speed to manufacture real hours — is capped here. Real
   * time credited for XP is never more than `timelineSeconds / xpMinSpeed`.
   */
  xpMinSpeed: 0.75,

  /** Hard ceiling on a single logged stint, to catch typos, not to punish. */
  maxSessionRealHours: 24,

  /** Season XP earned per real-world minute (separate currency from career XP). */
  seasonXpPerRealMinute: 10,
  seasonRewatchMultiplier: 0.25,

  /**
   * Story Complete bonus, chosen by race runtime. First entry whose
   * `maxHours` is >= the race runtime wins; the last entry is the fallback.
   */
  storyCompleteBonuses: [
    { maxHours: 2.5, careerXp: 500, seasonXp: 150, label: 'Sprint' },
    { maxHours: 4.5, careerXp: 1_000, seasonXp: 300, label: '4 Hours' },
    { maxHours: 6.5, careerXp: 1_500, seasonXp: 450, label: '6 Hours' },
    { maxHours: 8.5, careerXp: 2_000, seasonXp: 600, label: '8 Hours' },
    { maxHours: 12.5, careerXp: 3_000, seasonXp: 900, label: '12 Hours' },
    { maxHours: 18.5, careerXp: 4_500, seasonXp: 1_350, label: '18 Hours' },
    { maxHours: Infinity, careerXp: 7_500, seasonXp: 2_250, label: '24 Hours' },
  ],

  /** Extra on top of the Story Complete bonus for a tagged major event. */
  majorEventStoryMultiplier: 1.25,

  /** Marking a race Completed without full coverage still counts for something. */
  raceCompleteBonus: 250,

  /** Finishing every race of a season the user defined. */
  seasonCompleteBonus: 5_000,
  seasonCompleteSeasonXp: 1_500,

  /** Awarded when a prestige rank is reached. Purely a status marker. */
  prestigeBonus: 10_000,
} as const;

// ---------------------------------------------------------------------------
// Career levels — effectively endless
// ---------------------------------------------------------------------------

export const LEVEL_CONFIG = {
  /**
   * XP required to advance FROM `level` to `level + 1`:
   *
   *     cost(level) = round(base * level ^ exponent)
   *
   * base 250 / exponent 1.35 gives: level 10 at ~16k XP (about nine hours of
   * watching), level 25 at ~187k, level 50 at ~1.0M, level 100 at ~5.2M.
   * Early levels arrive quickly; the long haul stays long.
   */
  base: 250,
  exponent: 1.35,

  /** Levels are unbounded; this only bounds iteration in the solver. */
  maxSolvableLevel: 100_000,
} as const;

/**
 * Cosmetic, configurable titles. The highest threshold at or below the current
 * level is displayed. Nothing here affects progression.
 */
export const LEVEL_TITLES: ReadonlyArray<{ level: number; title: string }> = [
  { level: 1, title: 'Paddock Newcomer' },
  { level: 5, title: 'Grandstand Regular' },
  { level: 10, title: 'Rookie Endurance Fan' },
  { level: 15, title: 'Night Session Watcher' },
  { level: 20, title: 'Pit Wall Observer' },
  { level: 25, title: 'Stint Specialist' },
  { level: 30, title: 'Full Course Yellow Analyst' },
  { level: 40, title: 'Tyre Whisperer' },
  { level: 50, title: 'Strategy Engineer' },
  { level: 60, title: 'Double Stint Devotee' },
  { level: 70, title: 'Dawn Patrol' },
  { level: 80, title: 'Multiclass Traffic Reader' },
  { level: 90, title: 'Race Control' },
  { level: 100, title: 'Endurance Veteran' },
  { level: 125, title: 'Hyperpole Historian' },
  { level: 150, title: 'Triple Crown Chaser' },
  { level: 175, title: 'Sunrise Specialist' },
  { level: 200, title: 'Marathon Archivist' },
  { level: 250, title: 'Long-Haul Specialist' },
  { level: 300, title: 'Keeper of the Clock' },
  { level: 400, title: 'Circuit Cartographer' },
  { level: 500, title: 'Endurance Master' },
  { level: 650, title: 'Chronicler of the Night' },
  { level: 800, title: 'Grand Marshal' },
  { level: 1000, title: 'Living Timing Screen' },
  { level: 1500, title: 'Eternal Stint' },
  { level: 2000, title: 'The Twenty-Four Hour Mind' },
];

// ---------------------------------------------------------------------------
// Prestige — additive only, never resets anything
// ---------------------------------------------------------------------------

export const PRESTIGE_CONFIG = {
  /**
   * Career level at which each prestige rank unlocks. Prestige never resets
   * XP, races, achievements, collections or statistics — it is purely a
   * long-term status symbol layered on top of the permanent career.
   */
  thresholds: [100, 150, 200, 250, 300, 400, 500, 650, 800, 1000],
  /** Beyond the explicit list, one more rank every N levels. */
  repeatEveryLevels: 250,
  romanNumerals: true,
} as const;

// ---------------------------------------------------------------------------
// Story Complete
// ---------------------------------------------------------------------------

export const STORY_CONFIG = {
  /**
   * Fraction of the race timeline that must be covered. Deliberately not 1.0 —
   * a replay's final seconds of podium footage should not block the unlock.
   */
  coverageRatio: 0.995,
  /**
   * ...but no matter how long the race, this much timeline may never be
   * missing. Prevents "watched 99.5% of a 24h race" hiding a 7-minute skip on
   * a technicality, and is the reason coverage is tracked as intervals rather
   * than a furthest-timestamp high-water mark.
   */
  maxUncoveredSeconds: 120,
  /** Gaps smaller than this are treated as covered (ad breaks, seek jitter). */
  gapToleranceSeconds: 20,
} as const;

// ---------------------------------------------------------------------------
// Viewing budget
// ---------------------------------------------------------------------------

export const BUDGET_CONFIG = {
  /** The annual viewing budget, in hours. */
  annualHours: 336,
  /** Nominal weekly anchor. Not a cap — see `maxWeeklyHours`. */
  weeklyTargetHours: 8,

  /** A quiet week can drop this low before the engine stops trimming. */
  minWeeklyHours: 2,
  /** An ordinary week is never pushed above this. */
  maxWeeklyHours: 10,
  /** A week containing a tagged major event may go this high. */
  maxMajorEventWeeklyHours: 16,

  /** How far ahead the allocator plans when normalising recommendations. */
  planningHorizonWeeks: 8,

  /** Weight multipliers applied to the baseline pace for a week. */
  demandWeights: {
    majorEventInWeek: 0.75,
    raceScheduledInWeek: 0.18,
    perHighPriorityRace: 0.12,
    perMustWatchRace: 0.2,
    backlogPressure: 0.25,
    partiallyWatchedRace: 0.08,
    challengeOpportunity: 0.1,
    seasonPassPush: 0.08,
    /** Applied when the previous weeks ran hot, to suggest a lighter week. */
    recentOverPace: -0.3,
    restWeek: -1,
  },

  /** Clamp on the total demand weight so no single week runs away. */
  minDemandFactor: 0.45,
  maxDemandFactor: 2.2,

  /** Trailing weeks used for the pace EMA in projections. */
  paceEmaWeeks: 4,
  paceEmaAlpha: 0.45,
} as const;

// ---------------------------------------------------------------------------
// Momentum — the gentle alternative to streaks
// ---------------------------------------------------------------------------

export const MOMENTUM_CONFIG = {
  /** Points gained per real hour watched. */
  pointsPerRealHour: 12,
  /** Ceiling on what a single day can contribute. */
  maxDailyGain: 30,
  /**
   * Multiplied in once per elapsed day. Momentum settles gently; it never
   * resets to zero and there is never a message about losing it.
   */
  dailyDecay: 0.88,
  /** Floor — momentum drifts down to here, not to nothing. */
  floor: 0,
  /** Hard ceiling so the bar stays meaningful. */
  ceiling: 160,

  tiers: [
    { key: 'cold_tyres', name: 'Cold Tyres', min: 0, color: '#5b6b7a', blurb: 'Out of the pits. No pressure.' },
    { key: 'building_temperature', name: 'Building Temperature', min: 12, color: '#3f7fb5', blurb: 'Coming up to temp.' },
    { key: 'in_the_window', name: 'In the Window', min: 30, color: '#3fa06b', blurb: 'Working temperature.' },
    { key: 'double_stint', name: 'Double Stint', min: 58, color: '#c8a45c', blurb: 'Staying out on these.' },
    { key: 'flat_out', name: 'Flat Out', min: 92, color: '#d97a3a', blurb: 'Full attack mode.' },
    { key: 'ironman', name: 'Ironman', min: 130, color: '#c0504d', blurb: 'Driving the whole race yourself.' },
  ],

  /**
   * Small, cosmetic-tier Season XP bonus. Deliberately applied to the
   * quarterly currency only, never to the permanent career, so momentum can
   * never make long-term progression objectively easier.
   */
  seasonXpBonusPerTier: 0.015,
} as const;

// ---------------------------------------------------------------------------
// Season pass
// ---------------------------------------------------------------------------

export const SEASON_PASS_CONFIG = {
  tierCount: 100,
  /** Season XP required to go from tier 0 to tier 1. */
  baseTierCost: 550,
  /** Each subsequent tier costs `baseTierCost * (1 + growth * (tier - 1))`. */
  tierCostGrowth: 0.022,
  /** Every Nth tier gets the larger reward presentation. */
  milestoneEvery: 10,
} as const;

/**
 * The season pass and seasonal challenges are closed until this date (0.3.1).
 *
 * Until then no pass is created, no season XP is paid from any source and no
 * SEASONAL challenge is generated; career XP is untouched. From the first
 * instant of this day, in LOCAL time, everything behaves as it did in 0.3.0.
 *
 * Stored as calendar parts rather than a `Date` because a `Date` constant
 * would have to pick a timezone when the module loads, and quarters in this
 * application are local-time quarters (`quarterBounds`). `month` is 1-based, as
 * a person would write it; `seasonReopensAt` in `@/lib/domain/season-closure`
 * is the one place it becomes an instant. It should be the first day of a
 * quarter, so the pass that opens is a whole quarter long.
 */
export const SEASON_CLOSURE_CONFIG = {
  reopensOn: { year: 2026, month: 10, day: 1 },
} as const;

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export const CHALLENGE_CONFIG = {
  /** How many challenges to offer per scope. */
  counts: { DAILY: 3, WEEKLY: 4, MONTHLY: 4, SEASONAL: 5 },

  /** Base rewards; individual templates scale these by difficulty. */
  rewards: {
    DAILY: { careerXp: 300, seasonXp: 200 },
    WEEKLY: { careerXp: 1_500, seasonXp: 900 },
    MONTHLY: { careerXp: 5_000, seasonXp: 2_800 },
    SEASONAL: { careerXp: 15_000, seasonXp: 7_500 },
  },

  /**
   * Challenge targets are always derived from what is actually in the library.
   * These are safety rails so a generated target can never be impossible.
   */
  feasibility: {
    /** A daily target may not exceed this many real minutes. */
    maxDailyMinutes: 180,
    maxWeeklyMinutes: 12 * 60,
    maxMonthlyMinutes: 40 * 60,
    maxSeasonalMinutes: 110 * 60,
    /** Never ask for more story completions than the user could plausibly do. */
    storyCompleteSafetyMargin: 0.6,
  },
} as const;

// ---------------------------------------------------------------------------
// Race Strategist
// ---------------------------------------------------------------------------

export const STRATEGIST_CONFIG = {
  /**
   * Scoring weights. There is deliberately NO xp-per-hour term: the strategist
   * optimises enjoyment, narrative continuity and completion, never XP rate.
   * `tests/engines/strategist.test.ts` asserts this stays true.
   */
  weights: {
    /** Finishing an existing story beats starting a new one. */
    continuity: 46,
    /** Peaks in the middle of a race — the "you're deep in this one" bonus. */
    progressDepth: 18,
    /** Gentle nudge for something started a while ago. Capped, never nagging. */
    staleness: 14,
    priority: 16,
    excitement: 12,
    /** How well the remaining real time fits the available window. */
    windowFit: 26,
    /** Nearly-complete season or championship. */
    completionProximity: 20,
    /** Contributes to an active challenge or season-pass objective. */
    objectiveSupport: 12,
    majorEvent: 14,
    /** Negative: discourages three picks from the same championship. */
    varietyPenalty: -16,
    /** Negative: a race already watched today is unlikely to be the answer. */
    freshnessPenalty: -8,
  },

  /** Days after which the staleness nudge is at full strength. */
  stalenessFullDays: 21,
  /** A race is "a good fit" if it needs between these fractions of the window. */
  windowFitIdeal: { min: 0.35, max: 1.0 },
  /** Default available window when the user has not specified one. */
  defaultWindowMinutes: 120,
  /** Number of recommendations surfaced. */
  recommendationCount: 3,
} as const;

// ---------------------------------------------------------------------------
// Mastery
// ---------------------------------------------------------------------------

export const MASTERY_CONFIG = {
  /**
   * Node templates instantiated for every championship, including custom ones
   * created by the user. Metrics are evaluated by the mastery engine.
   */
  championshipNodes: [
    { key: 'first_race', name: 'Lights Out', description: 'Story Complete your first race in this championship.', metric: 'storyCompletes', threshold: 1, xpReward: 500, tier: 1, rarity: 'COMMON' },
    { key: 'stories_5', name: 'Five Stories', description: 'Story Complete five races.', metric: 'storyCompletes', threshold: 5, xpReward: 1_500, tier: 2, rarity: 'UNCOMMON' },
    { key: 'stories_10', name: 'Ten Stories', description: 'Story Complete ten races.', metric: 'storyCompletes', threshold: 10, xpReward: 3_000, tier: 3, rarity: 'UNCOMMON' },
    { key: 'stories_25', name: 'Twenty-Five Stories', description: 'Story Complete twenty-five races.', metric: 'storyCompletes', threshold: 25, xpReward: 8_000, tier: 5, rarity: 'RARE' },
    { key: 'stories_50', name: 'Fifty Stories', description: 'Story Complete fifty races.', metric: 'storyCompletes', threshold: 50, xpReward: 20_000, tier: 7, rarity: 'EPIC' },
    { key: 'hours_25', name: '25 Hours Watched', description: 'Accumulate 25 real viewing hours.', metric: 'realHours', threshold: 25, xpReward: 1_200, tier: 2, rarity: 'COMMON' },
    { key: 'hours_50', name: '50 Hours Watched', description: 'Accumulate 50 real viewing hours.', metric: 'realHours', threshold: 50, xpReward: 2_500, tier: 3, rarity: 'UNCOMMON' },
    { key: 'hours_100', name: '100 Hours Watched', description: 'Accumulate 100 real viewing hours.', metric: 'realHours', threshold: 100, xpReward: 6_000, tier: 4, rarity: 'RARE' },
    { key: 'hours_250', name: '250 Hours Watched', description: 'Accumulate 250 real viewing hours.', metric: 'realHours', threshold: 250, xpReward: 18_000, tier: 6, rarity: 'EPIC' },
    { key: 'hours_500', name: '500 Hours Watched', description: 'Accumulate 500 real viewing hours.', metric: 'realHours', threshold: 500, xpReward: 40_000, tier: 8, rarity: 'LEGENDARY' },
    { key: 'season_1', name: 'Complete a Season', description: 'Finish every race of one season.', metric: 'seasonsComplete', threshold: 1, xpReward: 4_000, tier: 4, rarity: 'RARE' },
    { key: 'season_3', name: 'Three Seasons', description: 'Finish three full seasons.', metric: 'seasonsComplete', threshold: 3, xpReward: 12_000, tier: 6, rarity: 'EPIC' },
    { key: 'season_5', name: 'Five Seasons', description: 'Finish five full seasons.', metric: 'seasonsComplete', threshold: 5, xpReward: 30_000, tier: 8, rarity: 'LEGENDARY' },
    { key: 'major_1', name: 'A Major Occasion', description: 'Story Complete a major event.', metric: 'majorEventStories', threshold: 1, xpReward: 2_500, tier: 3, rarity: 'RARE' },
    { key: 'major_3', name: 'The Big Ones', description: 'Story Complete three major events.', metric: 'majorEventStories', threshold: 3, xpReward: 8_000, tier: 5, rarity: 'EPIC' },
    { key: 'race_12h', name: 'Half a Day', description: 'Story Complete a race of 12 hours or more.', metric: 'stories12h', threshold: 1, xpReward: 4_000, tier: 4, rarity: 'RARE' },
    { key: 'race_24h', name: 'Around the Clock', description: 'Story Complete a 24-hour race.', metric: 'stories24h', threshold: 1, xpReward: 10_000, tier: 6, rarity: 'LEGENDARY' },
    { key: 'circuits_10', name: 'Ten Circuits', description: 'Complete races at ten different circuits.', metric: 'circuits', threshold: 10, xpReward: 5_000, tier: 5, rarity: 'RARE' },
  ],

  /** Nodes instantiated for a recurring event (Race Mastery). */
  raceEventNodes: [
    { key: 'edition_1', name: 'First Edition', description: 'Story Complete one edition.', metric: 'editionsStoryComplete', threshold: 1, xpReward: 1_000, tier: 1, rarity: 'UNCOMMON' },
    { key: 'edition_3', name: 'Three Editions', description: 'Story Complete three editions.', metric: 'editionsStoryComplete', threshold: 3, xpReward: 4_000, tier: 2, rarity: 'RARE' },
    { key: 'edition_5', name: 'Five Editions', description: 'Story Complete five editions.', metric: 'editionsStoryComplete', threshold: 5, xpReward: 9_000, tier: 3, rarity: 'EPIC' },
    { key: 'edition_10', name: 'A Decade of Editions', description: 'Story Complete ten editions.', metric: 'editionsStoryComplete', threshold: 10, xpReward: 25_000, tier: 4, rarity: 'LEGENDARY' },
    { key: 'consecutive_3', name: 'Three in a Row', description: 'Story Complete three consecutive editions.', metric: 'consecutiveEditions', threshold: 3, xpReward: 6_000, tier: 3, rarity: 'EPIC' },
    { key: 'consecutive_5', name: 'Five in a Row', description: 'Story Complete five consecutive editions.', metric: 'consecutiveEditions', threshold: 5, xpReward: 15_000, tier: 5, rarity: 'LEGENDARY' },
    { key: 'event_hours_50', name: '50 Hours Here', description: 'Spend 50 real hours on this event.', metric: 'realHours', threshold: 50, xpReward: 5_000, tier: 4, rarity: 'RARE' },
    { key: 'event_hours_150', name: '150 Hours Here', description: 'Spend 150 real hours on this event.', metric: 'realHours', threshold: 150, xpReward: 20_000, tier: 6, rarity: 'MYTHIC' },
  ],

  /** The single cross-championship tree. */
  globalNodes: [
    { key: 'global_stories_10', name: 'Ten Complete Stories', description: 'Story Complete ten races.', metric: 'storyCompletes', threshold: 10, xpReward: 2_500, tier: 1, rarity: 'UNCOMMON' },
    { key: 'global_stories_50', name: 'Fifty Complete Stories', description: 'Story Complete fifty races.', metric: 'storyCompletes', threshold: 50, xpReward: 15_000, tier: 3, rarity: 'EPIC' },
    { key: 'global_stories_100', name: 'One Hundred Stories', description: 'Story Complete one hundred races.', metric: 'storyCompletes', threshold: 100, xpReward: 40_000, tier: 5, rarity: 'LEGENDARY' },
    { key: 'global_hours_100', name: '100 Hours', description: 'Accumulate 100 real viewing hours.', metric: 'realHours', threshold: 100, xpReward: 4_000, tier: 1, rarity: 'UNCOMMON' },
    { key: 'global_hours_500', name: '500 Hours', description: 'Accumulate 500 real viewing hours.', metric: 'realHours', threshold: 500, xpReward: 20_000, tier: 3, rarity: 'EPIC' },
    { key: 'global_hours_1000', name: '1,000 Hours', description: 'Accumulate 1,000 real viewing hours.', metric: 'realHours', threshold: 1_000, xpReward: 60_000, tier: 5, rarity: 'MYTHIC' },
    { key: 'global_champs_3', name: 'Three Championships', description: 'Story Complete races in three championships.', metric: 'championships', threshold: 3, xpReward: 3_000, tier: 2, rarity: 'UNCOMMON' },
    { key: 'global_champs_6', name: 'Six Championships', description: 'Story Complete races in six championships.', metric: 'championships', threshold: 6, xpReward: 12_000, tier: 4, rarity: 'RARE' },
    { key: 'global_circuits_25', name: 'Globe Trotter', description: 'Complete races at twenty-five circuits.', metric: 'circuits', threshold: 25, xpReward: 12_000, tier: 4, rarity: 'EPIC' },
    { key: 'global_seasons_5', name: 'Five Seasons', description: 'Complete five full championship seasons.', metric: 'seasonsComplete', threshold: 5, xpReward: 25_000, tier: 5, rarity: 'LEGENDARY' },
  ],
} as const;

// ---------------------------------------------------------------------------
// 24-hour races
// ---------------------------------------------------------------------------

export const TWENTY_FOUR_HOUR_CONFIG = {
  /** Segment markers shown around the 24-hour clock. */
  segmentHours: [6, 12, 18, 24],
  segmentLabels: ['6H', '12H', '18H', '24H'],
  /**
   * Suggested stint length when the planner divides a long race up. A 24-hour
   * race is an expedition; it is never presented as a single sitting.
   */
  suggestedStintMinutes: 150,
  /** Minimum runtime (seconds) before a race is treated as a long-haul event. */
  longHaulThresholdSec: 12 * 3600,
} as const;

export type StoryCompleteBonus = (typeof XP_CONFIG.storyCompleteBonuses)[number];

// ---------------------------------------------------------------------------
// Race Strategist — curve shapes
//
// `STRATEGIST_CONFIG.weights` decides how much each consideration is worth.
// The values below are the shapes of the curves that produce the 0-1 term each
// weight is multiplied by. They are kept apart from the weights so that a
// re-balance can change how much continuity matters without also changing what
// "deep into a race" means.
//
// As with the weights, there is deliberately nothing here derived from XP. The
// strategist optimises enjoyment, continuity and completion, never XP rate.
// ---------------------------------------------------------------------------

export const STRATEGIST_SHAPE = {
  /**
   * Fraction of the timeline that must be covered before a race counts as
   * started. Thirty stray seconds from a mis-click is not a story in progress.
   */
  startedThreshold: 0.005,

  /**
   * Share of the continuity term granted the moment a race is started at all,
   * before progress scales the remainder. Finishing an existing story is the
   * strategist's strongest preference, so this floor is high on purpose.
   */
  continuityBase: 0.55,

  /** Where the "you are deep in this one" curve peaks, as a coverage fraction. */
  progressDepthPeak: 0.55,

  /** How much each priority level contributes, 0-1. */
  priorityAffinity: { LOW: 0, NORMAL: 0.35, HIGH: 0.75, MUST_WATCH: 1 },

  /** Bounds of the personal excitement rating, used to normalise it to 0-1. */
  excitementScale: { min: 1, max: 5 },

  /**
   * Share of the window-fit term reserved for "and it can be finished in the
   * time available". The remainder comes from how close the fit is.
   */
  windowFitFinishShare: 0.35,

  /**
   * Floor under the season-completion curve, so the last race of a very short
   * season still reads as a completion opportunity.
   */
  completionProximityFloor: 0.5,

  /** How strongly each kind of objective match counts, 0-1. */
  objectiveMatch: {
    namedRace: 1,
    season: 0.85,
    championship: 0.8,
    majorEvent: 0.7,
    runtime: 0.6,
    storyCompletion: 0.5,
    generic: 0.25,
  },

  /**
   * Wildcard selection. Deliberately different, deliberately deterministic:
   * the shares below are blended into one affinity and the largest wins.
   */
  wildcard: {
    scoreShare: 0.3,
    differentChampionship: 0.25,
    unstarted: 0.2,
    excitement: 0.2,
    jitter: 0.25,
  },

  /** Points a term must contribute before it earns a chip in `reasons`. */
  reasonThreshold: 3.5,
} as const;

// ---------------------------------------------------------------------------
// Viewing budget — signal shapes
//
// `BUDGET_CONFIG.demandWeights` decides how much each consideration is worth
// at full strength. The values below decide what "full strength" means, so a
// library holding eighty outstanding hours does not weigh eighty times as much
// as one holding a single outstanding hour, and so a week with nine races
// scheduled does not run away with the whole year.
//
// They are kept apart from the weights for the same reason the strategist's
// shapes are: a re-balance should be able to change how much the backlog
// matters without also changing what a full backlog is.
//
// Nothing here can reduce an allocation to zero except a rest week the user
// asked for. The budget is a planning framework, never a restriction.
// ---------------------------------------------------------------------------

export const BUDGET_SHAPE = {
  /**
   * Outstanding real hours in the library at which backlog pressure is at
   * full strength — roughly a month of nominal weeks' worth of racing waiting.
   */
  backlogSaturationHours: 48,

  /** Scheduled races in one week beyond which the week stops getting busier. */
  scheduledRaceSaturationCount: 4,
  /** Same, for HIGH and MUST_WATCH races counted individually. */
  priorityRaceSaturationCount: 3,
  /** Races part-way through beyond which the continuity nudge stops growing. */
  continuitySaturationRaces: 4,
  /** Open challenges in a week beyond which the opportunity signal levels off. */
  challengeSaturationCount: 3,

  /**
   * Passes of the scale-then-re-clamp normalisation. Each pass moves the
   * horizon closer to its share of the remaining budget; three is enough to
   * settle even when several weeks are pinned to their ceiling.
   */
  normalisationPasses: 3,

  /** Allocations are reported on this grid, in hours (six minutes). */
  roundingStepHours: 0.1,

  /**
   * Floor under "weeks remaining", mirroring `weeksRemainingInYear` in
   * `domain/periods`. A guard against dividing by zero on the last day of the
   * year, not a balance figure.
   */
  minWeeksRemaining: 0.1,
} as const;

// ---------------------------------------------------------------------------
// Achievements and milestones
//
// The reward each achievement carries lives next to its definition in
// `config/achievements.ts`, and each milestone ladder's base reward next to
// its definition in `config/milestones.ts`. What belongs here is what those
// definitions do not carry themselves: the shape of the milestone reward
// curve, and the sizes of the lists the achievement board puts on the shelf.
//
// Nothing here can take anything away. Both systems are strictly additive:
// a milestone is reached and an achievement is found, and neither can then be
// un-reached or un-found by any later number.
// ---------------------------------------------------------------------------

export const MILESTONE_CONFIG = {
  /**
   * Later rungs of a milestone ladder are worth more than earlier ones. The
   * reward for the threshold at zero-based index `i` is
   *
   *     round(xpPerThreshold * min(1 + indexScaling * i, maxIndexMultiplier))
   *
   * Linear rather than exponential, deliberately. The ladders are long — the
   * viewing-hours ladder has twenty rungs — and an exponential curve would
   * make the final rung worth more than the entire career leading up to it,
   * which would quietly turn every earlier one into a rounding error. Linear
   * keeps the thousandth hour a clearly larger occasion than the tenth
   * without making the tenth feel like nothing at all.
   */
  indexScaling: 0.6,

  /**
   * Where that ramp starts.
   *
   * There are fourteen milestone ladders, and the first rungs of all of them
   * fall within the opening weeks of a career. At a multiplier of 1.0 that
   * opening lump briefly outweighs the watching that earned it, which gets the
   * emphasis of the whole economy the wrong way round — ordinary watching is
   * meant to be the main source of XP, always. Starting the ramp below one
   * makes a first rung a nod rather than a windfall; the ladder reaches full
   * value by its third rung and the long run is unchanged in shape.
   */
  baseMultiplier: 0.4,

  /**
   * Ceiling on that multiplier, so the far end of a very long ladder stays in
   * proportion with the rest of the economy no matter how many rungs a future
   * re-balance adds.
   */
  maxIndexMultiplier: 12,
} as const;

export const ACHIEVEMENT_BOARD_CONFIG = {
  /** How many recent unlocks the board keeps on the shelf. */
  recentlyUnlockedCount: 6,

  /** How many within-reach achievements the board surfaces. */
  nearlyThereCount: 6,

  /**
   * How much progress an achievement needs before it can appear in that
   * within-reach list. Something sitting at zero is not nearly there; it is
   * simply somewhere the user has not been yet, and listing it would turn a
   * shelf of pleasant near-misses into a list of chores.
   */
  nearlyThereMinProgress: 0.25,
} as const;

// ---------------------------------------------------------------------------
// Challenges — generation shapes
//
// `CHALLENGE_CONFIG` decides how many challenges a scope offers, what a scope's
// baseline reward is, and how much real time a period of that length may ever
// be asked for. The values below decide what the generator asks for INSIDE
// those rails: how much of a period's capacity a time-based template claims,
// how much of the library a counting template claims, and how far a reward may
// travel from its baseline once the derived target turns out larger or smaller
// than the nominal one.
//
// They are kept apart from `CHALLENGE_CONFIG` for the same reason the
// strategist's and the budget's shapes are kept apart from their weights: a
// re-balance should be able to change how generous a scope is without also
// changing what "a gentle ask" means.
//
// Nothing here can produce an impossible challenge. Every figure is a SHARE of
// something the library really contains, and `CHALLENGE_CONFIG.feasibility` is
// applied on top of the result regardless.
// ---------------------------------------------------------------------------

export const CHALLENGE_SHAPE = {
  /**
   * Nominal ask of a time-based template, as a share of its scope's ceiling in
   * `CHALLENGE_CONFIG.feasibility`. A share rather than a literal so a ceiling
   * and the challenges beneath it can never drift apart: 0.17 of a 180-minute
   * day is the half-hour daily, 0.33 of a twelve-hour week the four-hour
   * weekly, 0.5 of a forty-hour month the twenty-hour monthly, and 0.5455 of a
   * 110-hour quarter the sixty-hour seasonal.
   */
  timeShare: { gentle: 0.17, standard: 0.33, committed: 0.5, expedition: 0.5455 },

  /**
   * When someone's own recent pace is already higher than the nominal ask, the
   * target follows them up — but only to this share of what they typically do
   * in a period of that length. Below 1 on purpose: a challenge should sit just
   * inside a comfortable week, never just beyond it.
   */
  paceStretch: 0.9,

  /** Trailing days the pace anchor is read from. */
  paceWindowDays: 28,

  /**
   * Share of the library's outstanding time that a single period's challenge
   * may ask for. This is the rail that stops "watch sixty hours" ever being
   * generated for a library holding twenty hours of unwatched racing.
   */
  maxLibraryShare: { DAILY: 0.5, WEEKLY: 0.6, MONTHLY: 0.7, SEASONAL: 0.8 },

  /**
   * A library with nothing unwatched left in it is still perfectly watchable —
   * re-watching is a legitimate way to meet a time challenge. This share of the
   * whole library's runtime is therefore always treated as available, so the
   * application never runs out of things to offer someone who has finished
   * everything.
   */
  rewatchAvailabilityShare: 0.25,

  /** Time targets are reported on this grid, in minutes. */
  timeRoundingMinutes: 5,

  /** Floor under any time target. A short stint is still a stint. */
  minTimeMinutes: 10,

  /**
   * Counting templates scale with the library: where far more is feasible than
   * the nominal ask, the target rises towards this share of what is feasible.
   */
  countShare: { gentle: 0.35, standard: 0.6, committed: 0.85 },

  /** Whatever the library holds, a counting target never exceeds this. */
  maxCountTarget: { DAILY: 3, WEEKLY: 6, MONTHLY: 12, SEASONAL: 30 },

  /**
   * Distinct-days targets, as a share of the days in the period. Deliberately
   * well below 1: nothing in this application may imply that the user owes it a
   * daily appearance.
   */
  activeDaysShare: { WEEKLY: 0.45, MONTHLY: 0.35, SEASONAL: 0.3 },

  /**
   * Minimum runtimes, in hours, for the long-race templates. These describe a
   * shape of race rather than a reward, and the template is simply not offered
   * when the library holds no such race that could still be finished inside the
   * period.
   */
  longRaceHours: { monthly: 6, seasonal: 12 },

  /** Single-race progress asks, as a percentage of one race's runtime. */
  progressPercent: { weekly: 50, monthly: 75 },

  /**
   * How a template stands against its scope's baseline reward, before the
   * derived target has its say. A word in the template, a number here.
   */
  effortTiers: { light: 0.7, baseline: 1, demanding: 1.4, headline: 1.8 },

  /**
   * Relative chance of being chosen when more templates are eligible than the
   * scope has slots. Also a word in the template, a number here.
   */
  selectionWeights: { common: 1.4, standard: 1, rare: 0.6 },

  /**
   * Bounds on the reward multiplier. A generous library can never turn a daily
   * into a jackpot, and a sparse one can never make a reward derisory.
   */
  rewardScale: { min: 0.5, max: 2.2 },
} as const;

/**
 * The nominal ask of each counting challenge, before the library has its say.
 *
 * These are the figures the design names — "Story Complete three races",
 * "complete races from five championships" — and they are targets only in the
 * sense that the generator aims at them. The real target is clamped to what the
 * library can actually supply, so a template whose nominal ask the library
 * cannot meet is scaled down, or simply not offered.
 */
export const CHALLENGE_NOMINALS = {
  daily: { resumedRaces: 1, distinctRaces: 2, sessions: 1, storyCompletes: 1 },
  weekly: { storyCompletes: 1, sessions: 3, resumedRaces: 2, championships: 2 },
  monthly: { storyCompletes: 3, championships: 3, longRaces: 1, resumedRaces: 3, seasonStories: 2 },
  seasonal: { storyCompletes: 10, championships: 5, longRaces: 1, seasonsCompleted: 1, majorEventStories: 2 },
} as const;

// ---------------------------------------------------------------------------
// Mastery — how the scoped metrics behind a node are measured
//
// `MASTERY_CONFIG` above decides what a mastery node asks for. The two figures
// here decide how the scoped metrics behind those nodes are measured, and they
// are deliberately the same numbers `engines/metrics.ts` uses for the career-
// wide `stories12h` and `stories24h` counts: a race that counts as a twelve-
// hour story on the statistics page has to count as one inside a mastery tree
// too, or the same race would be two different things in two places.
//
// The tolerance below the nominal runtime is on purpose. A twelve-hour race
// shortened to 11h40m by a red flag is still a twelve-hour race, and a node
// that quietly refused to acknowledge it would be reading the regulations
// rather than the race.
// ---------------------------------------------------------------------------

export const MASTERY_SHAPE = {
  /** Runtime (hours) at or above which a Story Complete counts as a 12-hour race. */
  stories12hMinHours: 11.5,
  /** Runtime (hours) at or above which a Story Complete counts as a 24-hour race. */
  stories24hMinHours: 23,
} as const;

// ---------------------------------------------------------------------------
// Season pass — presentation
//
// `SEASON_PASS_CONFIG` above decides what the quarterly track costs. The single
// figure here decides how much of the track the "next up" strip puts in front
// of the user at once, and it lives in configuration for the same reason every
// other tunable does: so the season-pass engine contains no bare numbers, and
// so a rebalance of the pass can change how it reads as well as how it runs.
//
// It is deliberately small. The whole hundred-tier track is always browsable —
// this is only the short preview shown beside the current tier, and a preview
// that reached too far ahead would turn a quarter into a checklist.
// ---------------------------------------------------------------------------

export const SEASON_PASS_SHAPE = {
  /** How many not-yet-unlocked tiers the "next up" preview shows. */
  upcomingTierCount: 4,
} as const;

// ---------------------------------------------------------------------------
// Momentum — presentation
//
// `MOMENTUM_CONFIG` above decides how momentum rises and how gently it
// settles. The two figures here decide only how much of the resulting history
// the chart draws, and they live in configuration for the same reason every
// other tunable does: so the momentum engine contains no bare numbers of its
// own. Neither figure touches progression — changing them changes the width of
// a chart and nothing else.
// ---------------------------------------------------------------------------

export const MOMENTUM_SHAPE = {
  /** Days of momentum history the chart shows unless asked for more. */
  defaultChartDays: 30,
  /** Upper bound on a requested window, so one query cannot read a decade. */
  maxChartDays: 365,
} as const;

// ---------------------------------------------------------------------------
// Trophy cabinet and Hall of Fame
//
// The awards engine RECORDS moments; it does not invent them. Every figure
// here decides only when a moment has become large enough to deserve a plaque
// on the wall or a trophy on the shelf, and none of them can take one away.
// Lowering a threshold means the next run records something that was already
// true; raising one leaves every entry already in the hall exactly where it
// is. That asymmetry is the whole point, and it is why nothing in this block
// is expressed as a condition an entry must keep satisfying.
//
// Rarity sits beside each threshold rather than in a table of its own, for the
// same reason it sits beside each definition in `config/achievements.ts`: how
// rare a moment is forms part of what the moment IS, and separating the two
// would let a rebalance move a threshold while leaving the presentation that
// belongs to it behind.
//
// The ladders below deliberately stop well short of the milestone ladders in
// `config/milestones.ts`. A milestone marks every rung of a long climb; the
// Hall of Fame marks the handful of rungs somebody would actually mention
// years later, and a hall that recorded all twenty viewing-hour rungs would be
// a log rather than a museum.
// ---------------------------------------------------------------------------

export const AWARDS_CONFIG = {
  /** Story Complete counts worth a plaque. The tenth, the fiftieth, and on. */
  storyMilestones: [
    { threshold: 10, rarity: 'UNCOMMON' },
    { threshold: 50, rarity: 'RARE' },
    { threshold: 100, rarity: 'EPIC' },
    { threshold: 500, rarity: 'MYTHIC' },
  ],

  /** Real viewing hours worth a plaque. Real time, never timeline time. */
  realHourMilestones: [
    { threshold: 100, rarity: 'RARE' },
    { threshold: 500, rarity: 'EPIC' },
    { threshold: 1_000, rarity: 'LEGENDARY' },
  ],

  /** Career levels worth a plaque. */
  levelMilestones: [
    { threshold: 10, rarity: 'COMMON' },
    { threshold: 25, rarity: 'UNCOMMON' },
    { threshold: 50, rarity: 'RARE' },
    { threshold: 100, rarity: 'EPIC' },
    { threshold: 250, rarity: 'EPIC' },
    { threshold: 500, rarity: 'LEGENDARY' },
    { threshold: 1_000, rarity: 'MYTHIC' },
  ],

  /**
   * Rarity of each kind of recorded moment.
   *
   * The `first…` entries are the once-in-a-career plaques; the others are the
   * per-instance ones, which sit a notch lower precisely because they recur.
   */
  rarity: {
    firstRaceCompleted: 'UNCOMMON',
    firstStoryComplete: 'RARE',
    firstRace12h: 'RARE',
    firstRace24h: 'EPIC',
    firstMajorEvent: 'RARE',
    firstSeasonComplete: 'EPIC',
    firstSeasonSweep: 'LEGENDARY',
    firstMasteryTree: 'LEGENDARY',
    firstSeasonPass: 'LEGENDARY',
    firstPrestige: 'LEGENDARY',

    seasonComplete: 'RARE',
    /** A season in which every single race is Story Complete. */
    seasonSweep: 'EPIC',
    majorEvent: 'EPIC',
    masteryTree: 'LEGENDARY',
    prestige: 'LEGENDARY',
    seasonPassComplete: 'LEGENDARY',
  },

  /**
   * Achievement rarities rare enough to earn a place in the cabinet as well as
   * on the achievement board. Everything below this stays on the board, which
   * is where the hundreds of ordinary unlocks belong — a cabinet holding every
   * achievement would be a second copy of the board rather than a shelf.
   */
  trophyAchievementRarities: ['LEGENDARY', 'MYTHIC'],
} as const;

// ---------------------------------------------------------------------------
// Statistics — window shapes
//
// `engines/stats-engine.ts` reports what has already happened. It owns no
// balance constants, because nothing it reports can change what anything costs
// or pays: a statistics page that could move a figure by being looked at would
// not be a statistics page. What it does own is how much history a chart puts
// in front of the user at once, and those figures live here for the same
// reason every other tunable does — so the engine contains no bare numbers of
// its own.
//
// Nothing here can alter a figure. A shorter window shows fewer months of the
// same history; the ledger underneath it is untouched, and widening the window
// again brings every month back exactly as it was.
// ---------------------------------------------------------------------------

export const STATS_CONFIG = {
  /** Months of XP history the chart draws unless asked for more. */
  xpHistoryDefaultMonths: 24,

  /**
   * Upper bound on a requested XP window.
   *
   * The series is built from one aggregate per month rather than one pass over
   * the whole ledger — the ledger is the longest table in the database, and a
   * chart of the last two years has no business reading all of it — so this
   * bound is also what keeps the number of queries in proportion with the
   * width of the chart.
   */
  xpHistoryMaxMonths: 60,

  /**
   * Trailing months the "recently" averages are read from, so a career that
   * has changed shape is not described only by its lifetime average.
   */
  recentMonthsWindow: 6,
} as const;
