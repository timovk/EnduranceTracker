/**
 * Career Statistics.
 *
 * This engine is READ-ONLY. It opens no transaction, writes nothing and awards
 * nothing — everything it reports was earned somewhere else, and a statistics
 * page that could move a figure by being looked at would not be a statistics
 * page. It therefore reads through the global client rather than taking a
 * transaction client the way the writing engines do.
 *
 * THE REPLAY IS THE SOURCE (0.4.0)
 *
 * Every viewing figure comes from the career replay (`domain/career-timeline`,
 * cached per account by `career-timeline-engine`), folded by the same
 * `summariseWindow` the Career Chronicle and the year comparison use. A year
 * on this page, that year's chapter and that year in a comparison therefore
 * cannot disagree, and a deleted stint is gone from every figure at once —
 * nothing here reads the coverage snapshot a stint row took when it was
 * logged. The database is asked which races a filter chooses, and for what
 * the replay does not hold: the ledger, landmarks, the budget, challenges and
 * the season pass.
 *
 * TWO QUANTITIES THAT ARE NEVER THE SAME THING
 *
 * Viewing time is what a person actually spent in front of the screen,
 * counted the way XP counts it: a stint's real time, but never more than its
 * timeline at the 0.75× credit floor (`creditedSeconds`). For every speed of
 * 0.75× and above that is simply its real time. It counts every re-watch.
 * Every `realSeconds` / `realHours` field in this file is this CREDITED time;
 * the viewing budget alone keeps raw real time (`STATISTICS_NOTE` says so).
 *
 * Unique race-timeline coverage is how much of a race's story has been seen at
 * least once: the replay's merged intervals, clamped to the race's runtime.
 * Re-watching cannot increase it.
 *
 * The worked example: watch 00:00–01:00 of a race, then re-watch 00:30–01:00.
 * That is 1h 30m of viewing time and 1h of unique coverage. Both figures are
 * true and they measure different things, so every field in this file carries
 * the distinction in its name —
 *
 *   * `realSeconds` / `realHours`      time spent (credited), re-watches included
 *   * `uniqueCoverageSeconds`          story seen, re-watches excluded
 *   * `timelinePlayedSeconds`          timeline played, re-watches included
 *   * `newCoverageSeconds`             story seen for the first time in a window
 *   * `rewatchSeconds`                 time spent on story already seen
 *
 * — so that nothing downstream can quietly put one in the other's place.
 *
 * Time is spread over each stint's window and split at local midnights, and
 * only the part inside a window counts; facts — a session, a race started or
 * completed — happen at the stint's instant (`domain/window-summary`).
 *
 * EVERY PERCENTAGE IS SCOPED
 *
 * No figure here measures a career against all of endurance racing, and there
 * must never be one. A percentage like that would silently turn every race ever
 * run into something outstanding, which is the exact feeling this application
 * exists to avoid. Percentages are only ever taken against a scope somebody
 * defined: the races in the current filter, a season the user wrote down, a
 * championship's mastery tree, a quarter's season pass, this application's own
 * achievement catalogue. Every percentage field names its scope, and
 * `SCOPED_PERCENTAGE_NOTE` states the rule for the page itself.
 *
 * WHERE THE WORK HAPPENS
 *
 * One cached replay per account, one query for the races a filter chooses,
 * and folds over the stints that are linear in their number — no query per
 * race anywhere. The ledger series stay database aggregates, bounded by the
 * months or years they cover rather than by the rows the ledger holds.
 * Records and the year comparison are computed only when their tab asks.
 *
 * Everything returned is plainly serialisable: numbers, strings and Dates. No
 * BigInt crosses this boundary, because these views are rendered by client
 * components and `careerXp` is a BigInt in the database.
 */

import type { Prisma } from '@/generated/prisma/client';
import {
  ACHIEVEMENTS, CAREER_STATS_SHAPE, DURATION_CLASSES, RACE_TYPE_PRESETS, SEASON_PASS_CONFIG, STATS_CONFIG,
} from '@/lib/config';
import { EXPIRED_CHALLENGE_NOTE, backlogFraming } from '@/lib/copy/tone';
import { prisma } from '@/lib/db/client';
import { clipToWindow, samePeriodEnd, yearWindow, type LocalWindow } from '@/lib/domain/calendar';
import { coverageAt, type CareerTimeline, type RaceHistory, type TimelineRaceRow } from '@/lib/domain/career-timeline';
import { monthPeriod } from '@/lib/domain/periods';
import { averagePlaybackSpeed } from '@/lib/domain/playback';
import { levelFromXp, prestigeForLevel, titleForLevel, totalXpForLevel } from '@/lib/domain/progression';
import {
  RECORD_ORDER, careerRecordOptions, computeRecordProgression, currentRecords, recordLabel,
  type RecordEvent, type RecordKind,
} from '@/lib/domain/records';
import { formatDuration, formatElapsed } from '@/lib/domain/time';
import type { ChallengeScope, RaceStatus, RaceType } from '@/lib/domain/types';
import {
  compareSummaries, durationClassOf, durationClassRange, summariseWindow,
  type Bucket, type CompareGroupRow, type CompareRow, type CompareSide, type GroupRow, type StintRef, type WindowSummary,
} from '@/lib/domain/window-summary';
import { getCareerTimeline } from './career-timeline-engine';
import { eventHref } from './mastery-engine';

// ===========================================================================
// The filter
// ===========================================================================

/**
 * How the statistics page narrows what it is looking at.
 *
 * Two different kinds of narrowing live in one object, and the difference
 * matters. Everything but `year` chooses a set of RACES: a championship, a
 * season, a circuit, a recurring event, one race, a length band, the legacy
 * race type, the runtime bounds, a library status, Story Complete only.
 * `year` chooses a WINDOW OF TIME: viewing figures come from the part of each
 * stint inside it, and a race counts as in scope for a year when it was
 * watched in that year.
 *
 * Every field is optional and an empty filter means the whole career.
 */
export interface StatsFilter {
  /** Calendar year, in local time — the same day boundaries as everything else. */
  year?: number;
  championshipId?: string;
  seasonId?: string;
  /** The normalised circuit key, so spellings of one circuit stay one circuit. */
  circuitSlug?: string;
  /**
   * A recurring event, by its key. Matched on `Race.iconicKey`, the key the
   * replay groups a race's editions by, so the filter chooses exactly the
   * races the event's rows and options count.
   */
  eventKey?: string;
  /** One race. */
  raceId?: string;
  /** A race-length band, by its `DURATION_CLASSES` key. */
  length?: string;
  /** The race's own type label. Still honoured in a URL; the length bands are what the page offers. */
  raceType?: RaceType;
  /** Race runtime bounds, in hours: "only the long ones", "only the sprints". */
  minRuntimeHours?: number;
  maxRuntimeHours?: number;
  status?: RaceStatus;
  /** Only races whose story is complete. */
  storyCompleteOnly?: boolean;
}

export interface StatsYearOption {
  year: number;
  sessions: number;
  realSeconds: number;
  realHours: number;
}

export interface StatsChampionshipOption {
  id: string;
  name: string;
  slug: string;
  shortName: string | null;
  accentColor: string;
  races: number;
}

export interface StatsSeasonOption {
  id: string;
  championshipId: string;
  championshipName: string;
  year: number;
  label: string;
  races: number;
}

export interface StatsCircuitOption {
  circuitSlug: string;
  name: string;
  country: string | null;
  races: number;
}

export interface StatsEventOption {
  key: string;
  name: string;
  /** Credited hours across the event's races, the whole career. */
  hours: number;
}

export interface StatsRaceOption {
  id: string;
  name: string;
  /** Credited hours inside the chosen year, or the whole career without one. */
  hours: number;
}

export interface StatsLengthOption {
  /** A `DURATION_CLASSES` key. */
  key: string;
  label: string;
  races: number;
}

export interface StatsStatusOption {
  status: RaceStatus;
  label: string;
  races: number;
}

/**
 * Everything the filter controls can offer, derived from the library itself.
 *
 * Nothing here is a fixed list of what exists in motorsport: a championship
 * appears because the user created it, a circuit because the user typed it, a
 * year because something was watched in it.
 */
export interface StatsFilterOptions {
  years: StatsYearOption[];
  championships: StatsChampionshipOption[];
  seasons: StatsSeasonOption[];
  circuits: StatsCircuitOption[];
  events: StatsEventOption[];
  /**
   * Offered once a championship, event or year narrows the library (a career
   * of thousands of races is no list to choose from): the races in that scope,
   * most watched first, at most `CAREER_STATS_SHAPE.raceOptionLimit`. Empty
   * until then.
   */
  races: StatsRaceOption[];
  /** The length bands the library has races in, shortest first. */
  lengths: StatsLengthOption[];
  statuses: StatsStatusOption[];
  /** Bounds for the runtime slider, in hours. */
  runtimeHours: { min: number; max: number };
}

// ===========================================================================
// The view
// ===========================================================================

/** Time spent and story seen, kept rigorously apart. */
export interface ViewingTotals {
  /** Credited seconds in front of the screen. Re-watches included. */
  realSeconds: number;
  realHours: number;
  /** Viewing time expressed in whole days' worth of hours. */
  equivalentDays: number;

  /** Race-timeline seconds played, re-watches included. NOT coverage. */
  timelinePlayedSeconds: number;
  timelinePlayedHours: number;

  /**
   * Unique race-timeline seconds covered by the races in scope. Under a year
   * filter it is each race's coverage as the year ended (or as it stands, for
   * the year in progress); otherwise as it stands. Re-watching never
   * increases it.
   */
  uniqueCoverageSeconds: number;
  uniqueCoverageHours: number;

  /**
   * Unique race-timeline seconds seen for the FIRST time in scope. Under a
   * year filter this is the story the year actually uncovered, which is a
   * different question from how much of those races has ever been seen —
   * hence both figures, separately named.
   */
  newCoverageSeconds: number;
  newCoverageHours: number;

  /**
   * Credited seconds spent on timeline already seen. Re-watching is a
   * perfectly good way to spend an evening; this is here to be interesting,
   * never to be deducted.
   */
  rewatchRealSeconds: number;
  /** Share of the viewing time that was a re-watch, 0-1. */
  rewatchShare: number;

  sessions: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
}

export interface RaceTotals {
  /** Races matching the filter. Every percentage below is taken against this. */
  racesInScope: number;
  racesStarted: number;
  /**
   * Races completed, which in 0.4.0 means Story Complete in the replay: the
   * same number as `racesStoryComplete`, shown once as "Races completed
   * (Story Complete)". A race marked Completed by hand counts in neither.
   */
  racesCompleted: number;
  racesStoryComplete: number;
  /** Races not yet begun. A library of future experiences, not a backlog. */
  racesUnstarted: number;

  /** Completed ÷ races in scope, as a percentage. Scoped, never universal. */
  completionPercent: number;
  /** Story Complete ÷ races in scope. */
  storyCompletePercent: number;
  /** Completed ÷ started — of the stories opened, how many were seen through. */
  startedCompletionPercent: number;

  averageRuntimeSec: number;
  averageRuntimeHours: number;
  longestRuntimeSec: number;
  /** Mean unique coverage across the races in scope, as a percentage. */
  averageCoveragePercent: number;

  majorEvents: number;
  majorEventsStoryComplete: number;

  /** Neutral framing for whatever is still waiting. */
  libraryNote: string;
}

/** One stint, as the page names it: the longest, or the shortest that means anything. */
export interface LongestSessionView {
  raceId: string;
  raceName: string;
  watchedAt: Date;
  /** Credited seconds. */
  realSeconds: number;
  timelineSeconds: number;
  playbackSpeed: number;
}

export interface SessionTotals {
  sessions: number;
  /** Mean credited seconds per logged stint. */
  averageRealSeconds: number;
  averageRealMinutes: number;
  longestRealSeconds: number;
  longestSession: LongestSessionView | null;
  /** Timeline played ÷ the real time it took: the speed actually watched at, weighted. */
  averagePlaybackSpeed: number;
  averageSessionsPerActiveDay: number;
}

export interface YearStat {
  year: number;
  realSeconds: number;
  realHours: number;
  sessions: number;
  activeDays: number;
  newCoverageSeconds: number;
  racesStoryComplete: number;
}

export interface MonthlyStat {
  /** `2026-03`, matching `domain/periods`. */
  key: string;
  year: number;
  /** 1-12. */
  month: number;
  label: string;
  start: Date;
  /** Exclusive. */
  end: Date;
  realSeconds: number;
  realHours: number;
  sessions: number;
  activeDays: number;
  newCoverageSeconds: number;
  newCoverageHours: number;
  racesStoryComplete: number;
  averageSessionRealSeconds: number;
}

export interface CadenceStats {
  activeDays: number;
  activeWeeks: number;
  activeMonths: number;
  /** Calendar weeks and months spanned by the scope, activity or not. */
  elapsedWeeks: number;
  elapsedMonths: number;

  averageRealHoursPerWeek: number;
  averageRealHoursPerActiveWeek: number;
  averageRealHoursPerMonth: number;
  averageRealHoursPerActiveMonth: number;

  /** The same two averages over the trailing window, for recent shape. */
  recentMonths: number;
  recentAverageRealHoursPerWeek: number;
  recentAverageRealHoursPerMonth: number;

  mostActiveMonth: MonthlyStat | null;
  mostActiveYear: YearStat | null;
  mostActiveDay: { date: string; realSeconds: number; realHours: number; sessions: number } | null;
}

/** A championship, circuit, event or race that the career has favoured. */
export interface FavouriteEntry {
  key: string;
  name: string;
  realSeconds: number;
  realHours: number;
  sessions: number;
  races: number;
  racesCompleted: number;
  racesStoryComplete: number;
  uniqueCoverageSeconds: number;
  /** One neutral sentence the UI can show verbatim. */
  detail: string;
}

export interface FavouriteStats {
  /** Most viewing time. */
  championshipByHours: FavouriteEntry | null;
  /** Most races seen through — a different question, and often a different answer. */
  championshipByCompletions: FavouriteEntry | null;
  circuit: FavouriteEntry | null;
  /** The recurring event with the most viewing time. */
  event: FavouriteEntry | null;
  /** The single race with the most viewing time. */
  race: FavouriteEntry | null;
}

/**
 * A percentage together with the scope it was taken against.
 *
 * The scope travels with the number on purpose: a percentage that arrives at
 * the UI without one is a percentage that can be relabelled by accident.
 */
export interface ScopedPercent {
  scope: string;
  percent: number;
  done: number;
  total: number;
}

export interface CompletionStats {
  /** Against this application's own achievement catalogue. */
  achievements: ScopedPercent;
  /** Against the mastery nodes of the trees this career actually has. */
  mastery: ScopedPercent;
  masteryTreesCompleted: number;
  masteryTreesTotal: number;
  /** Story Complete races against the races in the current filter. */
  storyLibrary: ScopedPercent;
  note: string;
}

export interface SeasonPassHistoryStat {
  passes: number;
  completedPasses: number;
  tiersUnlocked: number;
  milestoneTiersUnlocked: number;
  seasonXpEarned: number;
  bestTier: number;
  bestQuarterLabel: string | null;
  averageTier: number;
  /** Tiers in one pass, from configuration. */
  tierCount: number;
  /** Tiers unlocked ÷ tiers offered by the quarters this career has had. */
  completion: ScopedPercent;
  note: string;
}

export interface ChallengeScopeStat {
  scope: ChallengeScope;
  offered: number;
  completed: number;
  active: number;
  /** Windows that closed without being completed. Recorded, never charged for. */
  closed: number;
  /** Completed ÷ windows that have closed one way or the other. */
  completionPercent: number;
}

export interface ChallengeStat {
  offered: number;
  completed: number;
  active: number;
  closed: number;
  completionPercent: number;
  byScope: ChallengeScopeStat[];
  careerXpFromChallenges: number;
  seasonXpFromChallenges: number;
  note: string;
}

export interface XpHistoryPoint {
  key: string;
  year: number;
  month: number;
  label: string;
  start: Date;
  /** Exclusive. */
  end: Date;
  /** Career XP earned inside this month. */
  careerXp: number;
  /** Season XP earned inside this month, a separate quarterly currency. */
  seasonXp: number;
  awards: number;
  /** Career XP total at the end of the month. */
  cumulativeCareerXp: number;
  /** Career level at the end of the month. */
  level: number;
  levelsGained: number;
}

export interface LevelHistoryPoint {
  level: number;
  /** Null only when the ledger holds no award that reached this level. */
  reachedAt: Date | null;
  totalXpRequired: number;
  title: string;
  isTitleThreshold: boolean;
  prestige: number;
  isPrestigeThreshold: boolean;
  /** Days spent on the previous level, when both moments are known. */
  daysSincePrevious: number | null;
  /**
   * True when this level was crossed inside an award that also crossed the one
   * above it — a single large bonus can carry a career through several levels
   * at once, and the ledger records only where it landed.
   */
  carriedInSameAward: boolean;
}

/** One day of the activity calendar. Days with no activity are simply absent. */
export interface ActivityCalendarDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  realSeconds: number;
  sessions: number;
}

export interface ChampionshipStat {
  /** Null for races the user has not put in a championship. */
  championshipId: string | null;
  name: string;
  slug: string | null;
  accentColor: string | null;

  racesInScope: number;
  racesStarted: number;
  racesCompleted: number;
  racesStoryComplete: number;

  realSeconds: number;
  realHours: number;
  timelinePlayedSeconds: number;
  uniqueCoverageSeconds: number;
  uniqueCoverageHours: number;
  sessions: number;
  averagePlaybackSpeed: number;

  /** Completed ÷ races of this championship in scope. */
  completionPercent: number;
  /** This championship's own mastery tree, when it has one. */
  masteryPercent: number | null;

  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
}

export interface CircuitStat {
  circuitSlug: string;
  name: string;
  country: string | null;
  racesInScope: number;
  racesCompleted: number;
  racesStoryComplete: number;
  realSeconds: number;
  realHours: number;
  uniqueCoverageSeconds: number;
  sessions: number;
  lastWatchedAt: Date | null;
}

export interface BudgetYearStat {
  year: number;
  annualBudgetHours: number;
  weeklyTargetHours: number;
  /** Real viewing hours actually recorded in that calendar year. */
  actualHours: number;
  /** Where the year landed against its own plan. Information, nothing else. */
  percentOfPlan: number;
  /** Sum of what the allocator suggested across the weeks on record. */
  recommendedHours: number;
  weeksOnRecord: number;
  restWeeks: number;
  averageWeeklyHours: number;
  sessions: number;
  isCurrent: boolean;
  note: string;
}

export interface CareerSnapshot {
  level: number;
  prestige: number;
  careerXp: number;
  title: string;
  xpIntoLevel: number;
  xpForLevel: number;
}

/**
 * One row of a breakdown the replay groups: an event, a length band, a
 * championship. Its time is the scope's credited time that fell on its races.
 */
export interface GroupStat {
  id: string | null;
  name: string;
  accentColor: string | null;
  /** The event's own page, on an event row; null otherwise. */
  href: string | null;
  realSeconds: number;
  realHours: number;
  racesExperienced: number;
  storyCompletes: number;
  /** Of the scope's viewing time, 0-1. */
  share: number;
}

/** One day of the week, whichever weeks it fell in. */
export interface WeekdayStat {
  /** 0 = Sunday, as `Date.getDay()`. */
  weekday: number;
  label: string;
  short: string;
  realSeconds: number;
  realHours: number;
  sessions: number;
}

/** A count of Story Completes, per championship. */
export interface StoryCompleteCount {
  id: string | null;
  name: string;
  accentColor: string | null;
  storyCompletes: number;
}

export interface YearStoryCompletes {
  year: number;
  storyCompletes: number;
}

/** Races completed, month by month and in total so far. */
export interface CompletionsPoint {
  /** `2026-03`. */
  month: string;
  label: string;
  storyCompletes: number;
  cumulative: number;
}

/** Landmarks reached by the end of a month, each kind counted from the start of the scope. */
export interface LandmarksPoint {
  /** `2026-03`. */
  month: string;
  label: string;
  achievements: number;
  masteryNodes: number;
  milestones: number;
}

/** A calendar year of the ledger: the XP it earned and the levels it climbed. */
export interface XpYearStat {
  year: number;
  xpEarned: number;
  levelsGained: number;
}

/**
 * Everything the statistics page renders for one scope.
 *
 * Assembled by `getStatistics`, which is the only place the pieces are brought
 * together, so the figures on one page are always mutually consistent.
 */
export interface StatisticsView {
  generatedAt: Date;
  /** The filter as applied, echoed back so the UI never has to guess. */
  filter: StatsFilter;
  scopeLabel: string;
  /** A filter narrows the races. */
  narrowed: boolean;
  /** Said beside XP, levels and landmarks while a filter narrows the races: those are the whole career's. */
  careerWideNote: string | null;

  viewing: ViewingTotals;
  races: RaceTotals;
  sessions: SessionTotals;
  cadence: CadenceStats;
  favourites: FavouriteStats;
  completion: CompletionStats;
  seasonPasses: SeasonPassHistoryStat;
  challenges: ChallengeStat;

  monthly: MonthlyStat[];
  years: YearStat[];
  championships: ChampionshipStat[];
  circuits: CircuitStat[];

  xpHistory: XpHistoryPoint[];
  levelHistory: LevelHistoryPoint[];
  budgetHistory: BudgetYearStat[];

  /** Credited seconds spent on story already seen. */
  rewatchSeconds: number;
  /** Races watched in scope that reached "experienced": a tenth of the race, or an hour of a long one. */
  racesExperienced: number;
  /** Of the races started in scope, the share Story Complete, 0-100; null below `rateMinimumRaces` started. */
  storyCompleteRate: number | null;
  /** The plain mean of each watched race's completion, 0-100. */
  averageRaceCompletionPercent: number | null;
  shortestMeaningfulSession: LongestSessionView | null;
  /** The longest race experienced in scope, by runtime. */
  longestRace: { raceId: string; name: string; runtimeSec: number } | null;
  championshipsFollowed: number;
  eventsFollowed: number;
  byEvent: GroupStat[];
  /** Seven days, starting on the user's first day of the week. */
  byWeekday: WeekdayStat[];
  /** The length bands with anything in them, shortest first. */
  byDurationClass: GroupStat[];
  storyCompletesByChampionship: StoryCompleteCount[];
  /** Oldest year first, every year from the first with viewing to the last, quiet years at 0. */
  storyCompletesByYear: YearStoryCompletes[];
  completionsOverTime: CompletionsPoint[];
  landmarksOverTime: LandmarksPoint[];
  /** Newest year first, one row for every year in `years`. */
  xpAndLevelsByYear: XpYearStat[];

  career: CareerSnapshot;
  note: string;
}

/** The rule this file exists to keep, said plainly enough for the page to show. */
export const SCOPED_PERCENTAGE_NOTE =
  'Every percentage here is measured against a scope you defined — this filter, a season, ' +
  'a championship, a quarter. Nothing measures your career against every race ever run.';

/**
 * Framing for the page as a whole. A record, not a scoreboard — and the one
 * sentence on why an hour here and an hour on the Viewing Budget can differ.
 */
export const STATISTICS_NOTE =
  'A record of what you have watched. Nothing here expires. Hours here count the way XP does and are ' +
  'spread over the time a stint took, so a stint below 0.75× or one that crossed midnight can read a ' +
  'little differently on the Viewing Budget, which counts real time on the day a stint was logged.';

/** Said once, under the Records grid, instead of on every card it applies to. */
export const RECORDS_LOGGED_TIME_NOTE =
  'Records marked * depend on when stints were logged: a stint’s time is spread over the time before it was logged.';

/** Why XP, levels and landmarks do not follow a race filter. */
export const CAREER_WIDE_XP_NOTE =
  'XP, levels and landmarks count your whole career, whatever the filter: they are kept for the career, not per race.';

/** Display names for race statuses, so the filter reads as English. */
export const RACE_STATUS_LABELS: Readonly<Record<RaceStatus, string>> = {
  UNWATCHED: 'Not started',
  QUEUED: 'Queued',
  WATCHING: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ABANDONED: 'Set aside',
  ARCHIVED: 'Archived',
};

// ===========================================================================
// Small pure helpers
// ===========================================================================

const MS_PER_DAY = 86_400_000;
/** Seconds in a day. A unit conversion for "days spent watching", not a tunable. */
const SECONDS_PER_DAY = 86_400;
const SECONDS_PER_HOUR = 3_600;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Seconds to hours, to one decimal — the form every hours field takes. */
function toHours(seconds: number): number {
  return round1(seconds / SECONDS_PER_HOUR);
}

/** A percentage, 0-100, to one decimal. Zero when there is nothing to divide by. */
function percentOf(part: number, whole: number): number {
  return whole <= 0 ? 0 : round1((part / whole) * 100);
}

function divide(part: number, whole: number): number {
  return whole <= 0 ? 0 : part / whole;
}

/** Half-open window of a calendar year, in local time. */
export interface DateWindow {
  start: Date;
  /** Exclusive. */
  end: Date;
}

// Local calendar days and years come from `domain/calendar`, the one place the
// application buckets time by the local clock. `yearWindow` is re-exported so
// this module's surface is unchanged, with exactly one definition behind it.
export { yearWindow };

/** The months covering `[start, end)`, each with the key and label the app uses. */
function monthWindowsBetween(start: Date, end: Date): { key: string; label: string; year: number; month: number; start: Date; end: Date }[] {
  const months: { key: string; label: string; year: number; month: number; start: Date; end: Date }[] = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1, 0, 0, 0, 0);
  // Bounded so a corrupt date can never spin here. A century of months is far
  // more than any chart asks for and still terminates immediately.
  let guard = 0;
  while (cursor < end && guard < 1_200) {
    const period = monthPeriod(cursor);
    months.push({
      key: period.key,
      label: period.label,
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
      start: period.start,
      end: period.end,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 0, 0, 0, 0);
    guard += 1;
  }
  return months;
}

/** Local midnight on the first day of the month after `at`'s. */
function startOfNextMonth(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth() + 1, 1, 0, 0, 0, 0);
}

/** The label the Add Race form uses for a race type, so a legacy filter agrees with it. */
export function raceTypeLabel(raceType: RaceType): string {
  return RACE_TYPE_PRESETS.find((preset) => preset.type === raceType)?.label ?? raceType;
}

/**
 * Whether a value from an address is a library status. A filter reaches the
 * database as it is, so an unknown value must be dropped before it gets there.
 */
export function isRaceStatus(value: string | undefined): value is RaceStatus {
  return value !== undefined && Object.hasOwn(RACE_STATUS_LABELS, value);
}

/** Whether a value from an address is a race type the Add Race form offers. */
export function isRaceType(value: string | undefined): value is RaceType {
  return RACE_TYPE_PRESETS.some((preset) => preset.type === value);
}

function isWithin(date: Date | null, window: DateWindow | null): boolean {
  if (date === null) return false;
  if (window === null) return true;
  return date >= window.start && date < window.end;
}

/** "22 September 2026". */
function longDate(at: Date): string {
  return `${at.getDate()} ${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`;
}

// ===========================================================================
// Turning a filter into queries
// ===========================================================================

/**
 * The race predicates of a filter — everything except the year — always
 * inside the account.
 *
 * A length band is a runtime range from `durationClassRange`, the same bands
 * `durationClassOf` sorts races into, so the filter and the length chart can
 * never disagree about which band a race is in.
 */
export function buildRaceScopeWhere(userId: string, filter: StatsFilter = {}): Prisma.RaceWhereInput {
  const where: Prisma.RaceWhereInput = { userId };

  if (filter.championshipId !== undefined) where.championshipId = filter.championshipId;
  if (filter.seasonId !== undefined) where.seasonId = filter.seasonId;
  if (filter.circuitSlug !== undefined) where.circuitSlug = filter.circuitSlug;
  if (filter.eventKey !== undefined) where.iconicKey = filter.eventKey;
  if (filter.raceId !== undefined) where.id = filter.raceId;
  if (filter.raceType !== undefined) where.raceType = filter.raceType;
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.storyCompleteOnly === true) where.storyCompletedAt = { not: null };

  // The runtime bounds and a length band both narrow `runtimeSec`, so they
  // are folded into one range: the tighter lower bound, and each upper bound.
  let atLeast = filter.minRuntimeHours === undefined ? null : Math.round(filter.minRuntimeHours * SECONDS_PER_HOUR);
  const atMost = filter.maxRuntimeHours === undefined ? null : Math.round(filter.maxRuntimeHours * SECONDS_PER_HOUR);
  const band = filter.length === undefined ? null : durationClassRange(filter.length);
  if (band !== null) atLeast = Math.max(atLeast ?? 0, band.minSec);
  const below = band?.maxSec ?? null;
  if (atLeast !== null || atMost !== null || below !== null) {
    where.runtimeSec = {
      ...(atLeast !== null ? { gte: atLeast } : {}),
      ...(atMost !== null ? { lte: atMost } : {}),
      ...(below !== null ? { lt: below } : {}),
    };
  }

  return where;
}

/** Whether a filter narrows the races at all, or only (at most) the window of time. */
export function narrowsRaces(filter: StatsFilter): boolean {
  return filter.championshipId !== undefined || filter.seasonId !== undefined || filter.circuitSlug !== undefined
    || filter.eventKey !== undefined || filter.raceId !== undefined || filter.length !== undefined
    || filter.raceType !== undefined || filter.minRuntimeHours !== undefined || filter.maxRuntimeHours !== undefined
    || filter.status !== undefined || filter.storyCompleteOnly === true;
}

// ===========================================================================
// The replay, the filter, and one window of it
// ===========================================================================

const STATS_RACE_SELECT = {
  id: true,
  name: true,
  championshipId: true,
  circuit: true,
  circuitSlug: true,
  country: true,
  runtimeSec: true,
  isMajorEvent: true,
} satisfies Prisma.RaceSelect;

type StatsRaceRow = Prisma.RaceGetPayload<{ select: typeof STATS_RACE_SELECT }>;

interface ChampionshipRow {
  id: string;
  name: string;
  slug: string;
  accentColor: string;
}

/** What a filter resolves to, before any window is applied. */
interface FilterContext {
  filter: StatsFilter;
  timeline: CareerTimeline;
  weekStartsOn: number;
  /** The races the filter's race predicates choose, read from the library inside the account. */
  races: StatsRaceRow[];
  /** The same choice as a predicate over the replay's races; undefined when nothing narrows the races. */
  include: ((race: TimelineRaceRow) => boolean) | undefined;
  championships: ChampionshipRow[];
  scopeLabel: string;
}

async function loadWeekStart(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { weekStart: true } });
  return user?.weekStart ?? 1;
}

/**
 * The replay, the races a filter chooses, and the words for the choice.
 *
 * Every id in the filter came from a URL, so each is only ever read inside
 * the account: the race query carries `userId`, a season is found through its
 * championship's owner, and an event or race name comes from this account's
 * own replay or races — an id from anywhere else simply chooses nothing.
 */
async function loadFilterContext(userId: string, filter: StatsFilter): Promise<FilterContext> {
  const [timeline, weekStartsOn, races, championships, season] = await Promise.all([
    getCareerTimeline(userId),
    loadWeekStart(userId),
    prisma.race.findMany({ where: buildRaceScopeWhere(userId, filter), select: STATS_RACE_SELECT }),
    prisma.championship.findMany({
      where: { userId },
      select: { id: true, name: true, slug: true, accentColor: true },
    }),
    filter.seasonId === undefined
      ? Promise.resolve(null)
      : prisma.championshipSeason.findFirst({
          where: { id: filter.seasonId, championship: { userId } },
          select: { year: true, label: true, championship: { select: { name: true } } },
        }),
  ]);

  const chosen = new Set(races.map((race) => race.id));
  const include = narrowsRaces(filter) ? (race: TimelineRaceRow) => chosen.has(race.id) : undefined;

  let eventName: string | null = null;
  if (filter.eventKey !== undefined) {
    for (const race of timeline.racesById.values()) {
      if (race.eventKey === filter.eventKey) {
        eventName = race.eventName ?? race.eventKey;
        break;
      }
    }
  }

  const scopeLabel = describeScope(filter, {
    championship: filter.championshipId === undefined
      ? null
      : championships.find((row) => row.id === filter.championshipId)?.name ?? null,
    season: season === null ? null : season.label ?? `${season.championship.name} ${season.year}`,
    circuit: filter.circuitSlug === undefined
      ? null
      : races.find((race) => race.circuitSlug === filter.circuitSlug)?.circuit ?? filter.circuitSlug,
    event: eventName,
    race: filter.raceId === undefined ? null : timeline.racesById.get(filter.raceId)?.name ?? null,
  });

  return { filter, timeline, weekStartsOn, races, include, championships, scopeLabel };
}

function windowOptions(weekStartsOn: number, include?: (race: TimelineRaceRow) => boolean) {
  return {
    weekStartsOn,
    include,
    meaningfulSessionSeconds: CAREER_STATS_SHAPE.meaningfulSessionMinutes * 60,
    rateMinimumRaces: CAREER_STATS_SHAPE.rateMinimumRaces,
  };
}

/**
 * The unfiltered lifetime summary of a replay, kept beside it.
 *
 * The page and its filter options both ask for it, and a cached replay is the
 * same object until the history changes, so it is folded once per replay. A
 * `WeakMap`, so it goes when the replay does. Its maps are shared: read them,
 * never write to them.
 */
const lifetimeSummaries = new WeakMap<CareerTimeline, Map<number, WindowSummary>>();

function lifetimeSummary(timeline: CareerTimeline, weekStartsOn: number): WindowSummary {
  let byWeekStart = lifetimeSummaries.get(timeline);
  if (byWeekStart === undefined) {
    byWeekStart = new Map();
    lifetimeSummaries.set(timeline, byWeekStart);
  }
  let summary = byWeekStart.get(weekStartsOn);
  if (summary === undefined) {
    summary = summariseWindow(timeline, null, windowOptions(weekStartsOn));
    byWeekStart.set(weekStartsOn, summary);
  }
  return summary;
}

function summariseScope(context: FilterContext, window: LocalWindow | null): WindowSummary {
  if (window === null && context.include === undefined) return lifetimeSummary(context.timeline, context.weekStartsOn);
  return summariseWindow(context.timeline, window, windowOptions(context.weekStartsOn, context.include));
}

// ---------------------------------------------------------------------------
// Per race, inside the window
// ---------------------------------------------------------------------------

/** Viewing figures for one race (or the whole scope) inside the window. */
interface RaceSessionTotals {
  /** Stints whose instant is inside the window. */
  sessions: number;
  /** Credited seconds inside the window. */
  realSeconds: number;
  timelineSeconds: number;
  newCoverageSeconds: number;
  rewatchSeconds: number;
  /** The real time the timeline took to play at its speeds, for the average speed. */
  playbackRealSeconds: number;
  longestRealSeconds: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
  /** The race's unique coverage as the window ends (as it stands, for the whole career). */
  coverageSeconds: number;
}

function emptyTotals(): RaceSessionTotals {
  return {
    sessions: 0, realSeconds: 0, timelineSeconds: 0, newCoverageSeconds: 0, rewatchSeconds: 0,
    playbackRealSeconds: 0, longestRealSeconds: 0, firstWatchedAt: null, lastWatchedAt: null, coverageSeconds: 0,
  };
}

/** A race's coverage as the window ends: after its last stint logged before the end. */
function coverageAtEnd(history: RaceHistory, window: LocalWindow | null): number {
  return window === null ? history.coverageSeconds : coverageAt(history, new Date(window.end.getTime() - 1));
}

/**
 * Each chosen race's stints, clipped to the window.
 *
 * A race's time inside the window is the part of each stint's window that
 * falls in it (the same clip `summariseWindow` makes), and its sessions are
 * the stints logged inside it. A race enters the map when either is true, so
 * under a year filter the map's keys are the races the year touched.
 */
function raceTotalsInWindow(
  context: FilterContext,
  window: LocalWindow | null,
): { perRace: Map<string, RaceSessionTotals>; totals: RaceSessionTotals } {
  const perRace = new Map<string, RaceSessionTotals>();
  const totals = emptyTotals();

  for (const race of context.races) {
    const history = context.timeline.races.get(race.id);
    if (history === undefined || history.stints.length === 0) continue;

    let row: RaceSessionTotals | null = null;
    for (const stint of history.stints) {
      const part = window === null
        ? { fraction: 1 }
        : clipToWindow(stint.startsAt, stint.watchedAt, window);
      const counted = isWithin(stint.watchedAt, window);
      if (part === null && !counted) continue;

      row ??= emptyTotals();
      const fraction = part?.fraction ?? 0;
      for (const target of [row, totals]) {
        target.realSeconds += stint.creditedSeconds * fraction;
        target.timelineSeconds += stint.timelineSeconds * fraction;
        target.newCoverageSeconds += stint.addedCoverageSeconds * fraction;
        target.rewatchSeconds += stint.rewatchCreditedSeconds * fraction;
        if (stint.playbackSpeed > 0) target.playbackRealSeconds += (stint.timelineSeconds * fraction) / stint.playbackSpeed;
        if (!counted) continue;
        target.sessions += 1;
        target.longestRealSeconds = Math.max(target.longestRealSeconds, stint.creditedSeconds);
        target.firstWatchedAt = earliest(target.firstWatchedAt, stint.watchedAt);
        target.lastWatchedAt = latest(target.lastWatchedAt, stint.watchedAt);
      }
    }

    if (row !== null) {
      row.coverageSeconds = Math.min(coverageAtEnd(history, window), race.runtimeSec);
      totals.coverageSeconds += row.coverageSeconds;
      perRace.set(race.id, row);
    }
  }

  return { perRace, totals };
}

// ---------------------------------------------------------------------------
// Calendar buckets, from the summary
// ---------------------------------------------------------------------------

interface DayBucket {
  date: string;
  realSeconds: number;
  sessions: number;
  newCoverageSeconds: number;
}

interface PeriodBucket {
  realSeconds: number;
  sessions: number;
  newCoverageSeconds: number;
  storyCompletes: number;
  /** Local days in the period with viewing time on them. */
  activeDays: number;
}

interface ActivityBuckets {
  days: Map<string, DayBucket>;
  /** Keyed `YYYY-MM`. */
  months: Map<string, PeriodBucket>;
  years: Map<number, PeriodBucket>;
  /** Viewing weeks with viewing time in them, as the budget keys them. */
  activeWeeks: number;
}

/**
 * The summary's local days, weeks, months and years, in the shapes this page
 * reports. A day is active when viewing time fell on it — the same rule the
 * summary's own `activeDays` follows — so a stint logged with no time behind
 * it counts as a session on its day without making the day active.
 */
function bucketsFromSummary(summary: WindowSummary): ActivityBuckets {
  const days = new Map<string, DayBucket>();
  const activeByMonth = new Map<string, number>();
  const activeByYear = new Map<number, number>();

  for (const [key, bucket] of summary.days) {
    days.set(key, {
      date: key,
      realSeconds: Math.round(bucket.creditedSeconds),
      sessions: bucket.sessions,
      newCoverageSeconds: Math.round(bucket.newCoverageSeconds),
    });
    if (bucket.creditedSeconds > 0) {
      const month = key.slice(0, 7);
      const year = Number.parseInt(key.slice(0, 4), 10);
      activeByMonth.set(month, (activeByMonth.get(month) ?? 0) + 1);
      activeByYear.set(year, (activeByYear.get(year) ?? 0) + 1);
    }
  }

  const period = (bucket: Bucket, active: number): PeriodBucket => ({
    realSeconds: Math.round(bucket.creditedSeconds),
    sessions: bucket.sessions,
    newCoverageSeconds: Math.round(bucket.newCoverageSeconds),
    storyCompletes: bucket.storyCompletes,
    activeDays: active,
  });

  const months = new Map<string, PeriodBucket>();
  for (const [key, bucket] of summary.months) months.set(key, period(bucket, activeByMonth.get(key) ?? 0));
  const years = new Map<number, PeriodBucket>();
  for (const [year, bucket] of summary.years) years.set(year, period(bucket, activeByYear.get(year) ?? 0));

  let activeWeeks = 0;
  for (const bucket of summary.weeks.values()) if (bucket.creditedSeconds > 0) activeWeeks += 1;

  return { days, months, years, activeWeeks };
}

// ---------------------------------------------------------------------------
// The scope: one load, shared by every breakdown on the page
// ---------------------------------------------------------------------------

/**
 * Everything one scope needs, loaded once: the filter's context, the window,
 * the summary of that window, and each race's figures inside it.
 */
interface StatsScope extends FilterContext {
  window: LocalWindow | null;
  summary: WindowSummary;
  /**
   * The races in scope: every race the filter chooses, or under a year filter
   * those the year touched — watched in it, or with viewing time in it.
   */
  inScope: StatsRaceRow[];
  perRace: Map<string, RaceSessionTotals>;
  totals: RaceSessionTotals;
  buckets: ActivityBuckets;
}

async function loadScope(userId: string, filter: StatsFilter): Promise<StatsScope> {
  const context = await loadFilterContext(userId, filter);
  const window = filter.year === undefined ? null : yearWindow(filter.year);
  const summary = summariseScope(context, window);
  const { perRace, totals } = raceTotalsInWindow(context, window);
  return {
    ...context,
    window,
    summary,
    inScope: window === null ? context.races : context.races.filter((race) => perRace.has(race.id)),
    perRace,
    totals,
    buckets: bucketsFromSummary(summary),
  };
}

/** Viewing figures for one race in this scope, or zeroes if it was not watched. */
function totalsFor(scope: StatsScope, raceId: string): RaceSessionTotals {
  return scope.perRace.get(raceId) ?? emptyTotals();
}

// ===========================================================================
// Building the view
// ===========================================================================

function buildViewingTotals(scope: StatsScope): ViewingTotals {
  const { summary, totals } = scope;
  const realSeconds = Math.round(summary.creditedSeconds);
  const rewatchSeconds = Math.round(summary.rewatchSeconds);

  return {
    realSeconds,
    realHours: toHours(realSeconds),
    equivalentDays: round1(realSeconds / SECONDS_PER_DAY),

    timelinePlayedSeconds: Math.round(summary.timelineSeconds),
    timelinePlayedHours: toHours(summary.timelineSeconds),

    uniqueCoverageSeconds: Math.round(totals.coverageSeconds),
    uniqueCoverageHours: toHours(totals.coverageSeconds),

    newCoverageSeconds: Math.round(summary.newCoverageSeconds),
    newCoverageHours: toHours(summary.newCoverageSeconds),

    // Measured, stint by stint, by the replay: the credited time of each stint
    // that went on timeline its race had already covered.
    rewatchRealSeconds: rewatchSeconds,
    rewatchShare: round2(divide(rewatchSeconds, realSeconds)),

    sessions: summary.sessions,
    firstWatchedAt: totals.firstWatchedAt,
    lastWatchedAt: totals.lastWatchedAt,
  };
}

function buildRaceTotals(scope: StatsScope): RaceTotals {
  const { summary } = scope;

  let unstarted = 0;
  let runtimeSum = 0;
  let longestRuntime = 0;
  let coverageRatioSum = 0;
  let majorEvents = 0;
  let majorEventsStoryComplete = 0;

  for (const race of scope.inScope) {
    const history = scope.timeline.races.get(race.id);
    runtimeSum += race.runtimeSec;
    longestRuntime = Math.max(longestRuntime, race.runtimeSec);
    coverageRatioSum += divide(totalsFor(scope, race.id).coverageSeconds, race.runtimeSec);

    if (history === undefined || history.firstStintAt === null) unstarted += 1;
    if (race.isMajorEvent) {
      majorEvents += 1;
      if (history !== undefined && isWithin(history.storyCompletedAt, scope.window)) majorEventsStoryComplete += 1;
    }
  }

  const racesInScope = scope.inScope.length;
  // One number for one idea: completed is Story Complete in the replay, dated
  // by the stint that completed it.
  const completed = summary.storyCompletes;

  return {
    racesInScope,
    racesStarted: summary.racesStarted,
    racesCompleted: completed,
    racesStoryComplete: completed,
    racesUnstarted: unstarted,

    completionPercent: percentOf(completed, racesInScope),
    storyCompletePercent: percentOf(completed, racesInScope),
    startedCompletionPercent: percentOf(completed, summary.racesStarted),

    averageRuntimeSec: Math.round(divide(runtimeSum, racesInScope)),
    averageRuntimeHours: toHours(divide(runtimeSum, racesInScope)),
    longestRuntimeSec: longestRuntime,
    averageCoveragePercent: round1(divide(coverageRatioSum, racesInScope) * 100),

    majorEvents,
    majorEventsStoryComplete,

    libraryNote: backlogFraming(unstarted),
  };
}

/** A stint the summary picked out, with the few figures the page shows beside it. */
function sessionView(timeline: CareerTimeline, ref: StintRef | null): LongestSessionView | null {
  if (ref === null) return null;
  const stint = timeline.races.get(ref.raceId)?.stints.find((candidate) => candidate.sessionId === ref.sessionId);
  return {
    raceId: ref.raceId,
    raceName: ref.raceName,
    watchedAt: ref.at,
    realSeconds: ref.creditedSeconds,
    timelineSeconds: stint?.timelineSeconds ?? 0,
    playbackSpeed: ref.playbackSpeed,
  };
}

function buildSessionTotals(scope: StatsScope): SessionTotals {
  const { summary, totals } = scope;
  const longest = sessionView(scope.timeline, summary.longestSession);
  const average = summary.averageSessionSeconds ?? 0;

  return {
    sessions: summary.sessions,
    averageRealSeconds: Math.round(average),
    averageRealMinutes: round1(average / 60),
    longestRealSeconds: longest?.realSeconds ?? 0,
    longestSession: longest,
    // Weighted by timeline seconds rather than by session count, so a two-minute
    // stint at 3x cannot drag the average of a six-hour race.
    averagePlaybackSpeed: averagePlaybackSpeed([
      { timelineSeconds: totals.timelineSeconds, realSeconds: totals.playbackRealSeconds },
    ]),
    averageSessionsPerActiveDay: round2(divide(summary.sessions, summary.activeDays)),
  };
}

/**
 * Months as a contiguous series.
 *
 * Quiet months are included with zeroes rather than left out. A chart with a
 * gap in it invites the reader to wonder what went wrong; a chart with a quiet
 * month in it simply shows a quiet month, which is all it was.
 */
function buildMonthlyStats(buckets: ActivityBuckets, range: DateWindow | null, now: Date): MonthlyStat[] {
  let start: Date;
  let end: Date;

  if (range !== null) {
    start = range.start;
    end = range.end;
  } else {
    const keys = [...buckets.months.keys()].sort();
    const first = keys[0];
    if (first === undefined) return [];
    const [firstYear, firstMonth] = first.split('-');
    start = new Date(Number(firstYear), Number(firstMonth) - 1, 1, 0, 0, 0, 0);
    end = startOfNextMonth(now);
  }

  return monthWindowsBetween(start, end).map((month): MonthlyStat => {
    const bucket = buckets.months.get(month.key);
    const realSeconds = bucket?.realSeconds ?? 0;
    const sessions = bucket?.sessions ?? 0;
    const newCoverageSeconds = bucket?.newCoverageSeconds ?? 0;

    return {
      key: month.key,
      year: month.year,
      month: month.month,
      label: month.label,
      start: month.start,
      end: month.end,
      realSeconds,
      realHours: toHours(realSeconds),
      sessions,
      activeDays: bucket?.activeDays ?? 0,
      newCoverageSeconds,
      newCoverageHours: toHours(newCoverageSeconds),
      racesStoryComplete: bucket?.storyCompletes ?? 0,
      averageSessionRealSeconds: Math.round(divide(realSeconds, sessions)),
    };
  });
}

function buildYearStats(buckets: ActivityBuckets): YearStat[] {
  return [...buckets.years.entries()]
    .map(([year, bucket]): YearStat => ({
      year,
      realSeconds: bucket.realSeconds,
      realHours: toHours(bucket.realSeconds),
      sessions: bucket.sessions,
      activeDays: bucket.activeDays,
      newCoverageSeconds: bucket.newCoverageSeconds,
      racesStoryComplete: bucket.storyCompletes,
    }))
    .sort((a, b) => b.year - a.year);
}

function buildCadence(scope: StatsScope, monthly: MonthlyStat[], years: YearStat[], now: Date): CadenceStats {
  const { buckets, summary } = scope;
  const realSeconds = summary.creditedSeconds;

  // The span the averages are taken over: the filtered window if there is one,
  // otherwise from the first session to today. Never longer than the career.
  const start = scope.window?.start ?? summary.activeFrom ?? now;
  const windowEnd = scope.window?.end ?? now;
  const end = new Date(Math.min(windowEnd.getTime(), now.getTime()));
  const elapsedDays = Math.max(1, (end.getTime() - start.getTime()) / MS_PER_DAY);
  const elapsedWeeks = Math.max(1, elapsedDays / 7);
  const elapsedMonths = Math.max(1, monthly.length);
  const activeMonths = [...buckets.months.values()].filter((month) => month.activeDays > 0).length;

  const recentMonths = monthly.slice(-STATS_CONFIG.recentMonthsWindow);
  const recentSeconds = recentMonths.reduce((sum, month) => sum + month.realSeconds, 0);
  const recentDays = recentMonths.reduce(
    (sum, month) => sum + (month.end.getTime() - month.start.getTime()) / MS_PER_DAY,
    0,
  );

  const mostActiveMonth = monthly.reduce<MonthlyStat | null>(
    (best, month) => (month.realSeconds > 0 && (best === null || month.realSeconds > best.realSeconds) ? month : best),
    null,
  );
  const mostActiveYear = years.reduce<YearStat | null>(
    (best, year) => (best === null || year.realSeconds > best.realSeconds ? year : best),
    null,
  );
  const mostActiveDayBucket = [...buckets.days.values()].reduce<DayBucket | null>(
    (best, day) => (day.realSeconds > 0 && (best === null || day.realSeconds > best.realSeconds) ? day : best),
    null,
  );

  return {
    activeDays: summary.activeDays,
    activeWeeks: buckets.activeWeeks,
    activeMonths,
    elapsedWeeks: round1(elapsedWeeks),
    elapsedMonths: monthly.length,

    averageRealHoursPerWeek: round2(divide(realSeconds / SECONDS_PER_HOUR, elapsedWeeks)),
    averageRealHoursPerActiveWeek: round2(divide(realSeconds / SECONDS_PER_HOUR, buckets.activeWeeks)),
    averageRealHoursPerMonth: round2(divide(realSeconds / SECONDS_PER_HOUR, elapsedMonths)),
    averageRealHoursPerActiveMonth: round2(divide(realSeconds / SECONDS_PER_HOUR, activeMonths)),

    recentMonths: recentMonths.length,
    recentAverageRealHoursPerWeek: round2(divide(recentSeconds / SECONDS_PER_HOUR, Math.max(1, recentDays / 7))),
    recentAverageRealHoursPerMonth: round2(divide(recentSeconds / SECONDS_PER_HOUR, Math.max(1, recentMonths.length))),

    mostActiveMonth,
    mostActiveYear,
    mostActiveDay: mostActiveDayBucket === null
      ? null
      : {
          date: mostActiveDayBucket.date,
          realSeconds: mostActiveDayBucket.realSeconds,
          realHours: toHours(mostActiveDayBucket.realSeconds),
          sessions: mostActiveDayBucket.sessions,
        },
  };
}

// ---------------------------------------------------------------------------
// Grouping races
// ---------------------------------------------------------------------------

interface RaceGroup {
  key: string;
  name: string;
  races: number;
  racesStarted: number;
  racesCompleted: number;
  racesStoryComplete: number;
  realSeconds: number;
  timelineSeconds: number;
  playbackRealSeconds: number;
  uniqueCoverageSeconds: number;
  sessions: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
}

/**
 * Fold the races in scope into groups.
 *
 * Viewing time always comes from the part of each stint inside the window, and
 * unique coverage from the race's own merged intervals, so a group's two time
 * figures answer the two different questions they are named for. Started and
 * completed are the replay's instants: a race's first stint, and the stint
 * that completed its story.
 */
function groupRaces(
  scope: StatsScope,
  keyOf: (race: StatsRaceRow, replayed: TimelineRaceRow | undefined) => { key: string; name: string } | null,
): RaceGroup[] {
  const groups = new Map<string, RaceGroup>();

  for (const race of scope.inScope) {
    const identity = keyOf(race, scope.timeline.racesById.get(race.id));
    if (identity === null) continue;

    const group = groups.get(identity.key) ?? {
      key: identity.key,
      name: identity.name,
      races: 0,
      racesStarted: 0,
      racesCompleted: 0,
      racesStoryComplete: 0,
      realSeconds: 0,
      timelineSeconds: 0,
      playbackRealSeconds: 0,
      uniqueCoverageSeconds: 0,
      sessions: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
    };

    const totals = totalsFor(scope, race.id);
    const history = scope.timeline.races.get(race.id);
    group.races += 1;
    if (history !== undefined && isWithin(history.firstStintAt, scope.window)) group.racesStarted += 1;
    if (history !== undefined && isWithin(history.storyCompletedAt, scope.window)) {
      group.racesCompleted += 1;
      group.racesStoryComplete += 1;
    }
    group.realSeconds += totals.realSeconds;
    group.timelineSeconds += totals.timelineSeconds;
    group.playbackRealSeconds += totals.playbackRealSeconds;
    group.uniqueCoverageSeconds += totals.coverageSeconds;
    group.sessions += totals.sessions;
    group.firstWatchedAt = earliest(group.firstWatchedAt, totals.firstWatchedAt);
    group.lastWatchedAt = latest(group.lastWatchedAt, totals.lastWatchedAt);

    groups.set(identity.key, group);
  }

  return [...groups.values()];
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

function toFavourite(group: RaceGroup, detail: string): FavouriteEntry {
  return {
    key: group.key,
    name: group.name,
    realSeconds: Math.round(group.realSeconds),
    realHours: toHours(group.realSeconds),
    sessions: group.sessions,
    races: group.races,
    racesCompleted: group.racesCompleted,
    racesStoryComplete: group.racesStoryComplete,
    uniqueCoverageSeconds: Math.round(group.uniqueCoverageSeconds),
    detail,
  };
}

function bestBy(groups: RaceGroup[], value: (group: RaceGroup) => number): RaceGroup | null {
  return groups.reduce<RaceGroup | null>(
    (best, group) => (value(group) > 0 && (best === null || value(group) > value(best)) ? group : best),
    null,
  );
}

function buildChampionshipStats(
  scope: StatsScope,
  masteryPercents: Map<string, number>,
): ChampionshipStat[] {
  const names = new Map(scope.championships.map((row) => [row.id, row]));
  const groups = groupRaces(scope, (race) => ({
    key: race.championshipId ?? '',
    name: race.championshipId === null
      ? 'Without a championship'
      : names.get(race.championshipId)?.name ?? 'Championship',
  }));

  return groups
    .map((group): ChampionshipStat => {
      const championship = group.key === '' ? undefined : names.get(group.key);
      return {
        championshipId: group.key === '' ? null : group.key,
        name: group.name,
        slug: championship?.slug ?? null,
        accentColor: championship?.accentColor ?? null,

        racesInScope: group.races,
        racesStarted: group.racesStarted,
        racesCompleted: group.racesCompleted,
        racesStoryComplete: group.racesStoryComplete,

        realSeconds: Math.round(group.realSeconds),
        realHours: toHours(group.realSeconds),
        timelinePlayedSeconds: Math.round(group.timelineSeconds),
        uniqueCoverageSeconds: Math.round(group.uniqueCoverageSeconds),
        uniqueCoverageHours: toHours(group.uniqueCoverageSeconds),
        sessions: group.sessions,
        averagePlaybackSpeed: averagePlaybackSpeed([
          { timelineSeconds: group.timelineSeconds, realSeconds: group.playbackRealSeconds },
        ]),

        completionPercent: percentOf(group.racesCompleted, group.races),
        masteryPercent: group.key === '' ? null : masteryPercents.get(group.key) ?? null,

        firstWatchedAt: group.firstWatchedAt,
        lastWatchedAt: group.lastWatchedAt,
      };
    })
    .sort((a, b) => b.realSeconds - a.realSeconds || a.name.localeCompare(b.name));
}

function buildCircuitStats(scope: StatsScope): CircuitStat[] {
  // A race with no circuit recorded is simply not a circuit, so it is left out
  // rather than folded into an "unknown" row that would sort above real ones.
  const displayNames = new Map<string, { name: string; country: string | null }>();
  for (const race of scope.inScope) {
    if (race.circuitSlug === null) continue;
    if (!displayNames.has(race.circuitSlug)) {
      displayNames.set(race.circuitSlug, { name: race.circuit ?? race.circuitSlug, country: race.country });
    }
  }

  const groups = groupRaces(scope, (race) =>
    race.circuitSlug === null
      ? null
      : { key: race.circuitSlug, name: displayNames.get(race.circuitSlug)?.name ?? race.circuitSlug },
  );

  return groups
    .map((group): CircuitStat => ({
      circuitSlug: group.key,
      name: group.name,
      country: displayNames.get(group.key)?.country ?? null,
      racesInScope: group.races,
      racesCompleted: group.racesCompleted,
      racesStoryComplete: group.racesStoryComplete,
      realSeconds: Math.round(group.realSeconds),
      realHours: toHours(group.realSeconds),
      uniqueCoverageSeconds: Math.round(group.uniqueCoverageSeconds),
      sessions: group.sessions,
      lastWatchedAt: group.lastWatchedAt,
    }))
    .sort((a, b) => b.realSeconds - a.realSeconds || a.name.localeCompare(b.name));
}

function buildFavourites(scope: StatsScope): FavouriteStats {
  const championshipNames = new Map(scope.championships.map((row) => [row.id, row.name]));
  const championships = groupRaces(scope, (race) =>
    race.championshipId === null
      ? null
      : {
          key: race.championshipId,
          name: championshipNames.get(race.championshipId) ?? 'Championship',
        },
  );
  const circuits = groupRaces(scope, (race) =>
    race.circuitSlug === null ? null : { key: race.circuitSlug, name: race.circuit ?? race.circuitSlug },
  );
  const events = groupRaces(scope, (_race, replayed) =>
    replayed === undefined || replayed.eventKey === null
      ? null
      : { key: replayed.eventKey, name: replayed.eventName ?? replayed.eventKey },
  );
  const races = groupRaces(scope, (race) => ({ key: race.id, name: race.name }));

  const byHours = bestBy(championships, (group) => group.realSeconds);
  const byCompletions = bestBy(championships, (group) => group.racesStoryComplete);
  const circuit = bestBy(circuits, (group) => group.realSeconds);
  const event = bestBy(events, (group) => group.realSeconds);
  const race = bestBy(races, (group) => group.realSeconds);

  return {
    championshipByHours: byHours === null
      ? null
      : toFavourite(byHours, `${toHours(byHours.realSeconds)} hours of viewing across ${byHours.races} races.`),
    championshipByCompletions: byCompletions === null
      ? null
      : toFavourite(byCompletions, `${byCompletions.racesStoryComplete} races seen all the way through.`),
    circuit: circuit === null
      ? null
      : toFavourite(circuit, `${toHours(circuit.realSeconds)} hours here, across ${circuit.races} races.`),
    event: event === null
      ? null
      : toFavourite(event, `${event.races} editions, ${event.racesStoryComplete} of them Story Complete.`),
    race: race === null
      ? null
      : toFavourite(race, `${toHours(race.realSeconds)} hours across ${race.sessions} sessions.`),
  };
}

// ---------------------------------------------------------------------------
// The replay's own breakdowns
// ---------------------------------------------------------------------------

function toGroupStat(row: GroupRow, href: string | null): GroupStat {
  return {
    id: row.id,
    name: row.name,
    accentColor: row.accent,
    href,
    realSeconds: Math.round(row.creditedSeconds),
    realHours: toHours(row.creditedSeconds),
    racesExperienced: row.racesExperienced,
    storyCompletes: row.storyCompletes,
    share: row.share,
  };
}

/**
 * The events that have a page: a key the replay found linked to its event row.
 * A key typed onto a race and not yet linked has no page to open.
 */
function linkedEventKeys(timeline: CareerTimeline): Set<string> {
  const keys = new Set<string>();
  for (const race of timeline.racesById.values()) {
    if (race.eventKey !== null && race.eventId !== null) keys.add(race.eventKey);
  }
  return keys;
}

function buildByWeekday(summary: WindowSummary, weekStartsOn: number): WeekdayStat[] {
  return Array.from({ length: 7 }, (_, offset): WeekdayStat => {
    const weekday = (((weekStartsOn + offset) % 7) + 7) % 7;
    const bucket = summary.weekdays[weekday];
    const realSeconds = Math.round(bucket?.creditedSeconds ?? 0);
    const label = WEEKDAY_NAMES[weekday] ?? '';
    return {
      weekday,
      label,
      short: label.slice(0, 3),
      realSeconds,
      realHours: toHours(realSeconds),
      sessions: bucket?.sessions ?? 0,
    };
  });
}

/** Races completed month by month, and in total by each month's end: a step line, never a streak. */
function buildCompletionsOverTime(monthly: readonly MonthlyStat[], now: Date): CompletionsPoint[] {
  let cumulative = 0;
  return monthly
    .filter((month) => month.start <= now)
    .map((month) => {
      cumulative += month.racesStoryComplete;
      return { month: month.key, label: month.label, storyCompletes: month.racesStoryComplete, cumulative };
    });
}

/**
 * Story Completes year by year, oldest first, from the first year with
 * viewing to the last. A quiet year between them stays in as an empty slot,
 * so the bars read as a calendar and never close up the years around a gap.
 */
function buildStoryCompletesByYear(years: readonly YearStat[]): YearStoryCompletes[] {
  if (years.length === 0) return [];
  const byYear = new Map(years.map((year) => [year.year, year.racesStoryComplete]));
  const first = Math.min(...byYear.keys());
  const last = Math.max(...byYear.keys());
  return Array.from({ length: last - first + 1 }, (_, offset): YearStoryCompletes => ({
    year: first + offset,
    storyCompletes: byYear.get(first + offset) ?? 0,
  }));
}

/** When each landmark was reached, by kind. */
interface LandmarkDates {
  achievements: Date[];
  masteryNodes: Date[];
  milestones: Date[];
}

/**
 * The keys of events merged into another. Their trees keep their own unlocks,
 * but the steps now live — dated — in the event they were merged into, so a
 * count of steps leaves those trees out, as the Mastery page does.
 */
async function mergedEventKeys(userId: string): Promise<string[]> {
  const rows = await prisma.raceMastery.findMany({
    where: { userId, mergedIntoId: { not: null } },
    select: { key: true },
  });
  return rows.map((row) => row.key);
}

/** Leaves out the trees of events merged into another, when there are any. */
function outsideMergedTrees(merged: readonly string[]): Prisma.MasteryTreeWhereInput {
  if (merged.length === 0) return {};
  return { OR: [{ kind: { not: 'RACE_EVENT' } }, { iconicKey: null }, { iconicKey: { notIn: [...merged] } }] };
}

/**
 * When every achievement, mastery step and milestone was reached: the date the
 * history places it at (`achievedAt`) where there is one, otherwise when it was
 * recorded. Three reads of dates alone.
 */
async function loadLandmarkDates(userId: string, merged: Promise<string[]>): Promise<LandmarkDates> {
  const trees = outsideMergedTrees(await merged);
  const [achievements, masteryNodes, milestones] = await Promise.all([
    prisma.achievementProgress.findMany({
      where: { userId, unlockedAt: { not: null } },
      select: { unlockedAt: true },
    }),
    prisma.masteryProgress.findMany({
      where: { userId, unlockedAt: { not: null }, node: { tree: trees } },
      select: { unlockedAt: true, achievedAt: true },
    }),
    prisma.milestoneProgress.findMany({
      where: { userId, reachedAt: { not: null } },
      select: { reachedAt: true, achievedAt: true },
    }),
  ]);
  const dates = (rows: readonly (Date | null)[]) => rows.filter((at): at is Date => at !== null);
  return {
    achievements: dates(achievements.map((row) => row.unlockedAt)),
    masteryNodes: dates(masteryNodes.map((row) => row.achievedAt ?? row.unlockedAt)),
    milestones: dates(milestones.map((row) => row.achievedAt ?? row.reachedAt)),
  };
}

/**
 * Landmarks reached, cumulative, month by month: from the first landmark (or
 * the start of the filtered year) to this month. Under a year filter only
 * that year's landmarks count, so the lines start from zero in January.
 */
function buildLandmarksOverTime(dates: LandmarkDates, window: LocalWindow | null, now: Date): LandmarksPoint[] {
  const inside = (at: Date) => at <= now && isWithin(at, window);
  const all = [...dates.achievements, ...dates.masteryNodes, ...dates.milestones].filter(inside);
  if (all.length === 0) return [];

  const first = all.reduce((min, at) => (at < min ? at : min));
  const start = window?.start ?? first;
  const end = new Date(Math.min((window?.end ?? startOfNextMonth(now)).getTime(), startOfNextMonth(now).getTime()));

  const perMonth = (list: readonly Date[]) => {
    const counts = new Map<string, number>();
    for (const at of list) {
      if (!inside(at)) continue;
      const key = monthPeriod(at).key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const achievements = perMonth(dates.achievements);
  const masteryNodes = perMonth(dates.masteryNodes);
  const milestones = perMonth(dates.milestones);

  const running = { achievements: 0, masteryNodes: 0, milestones: 0 };
  return monthWindowsBetween(start, end).map((month): LandmarksPoint => {
    running.achievements += achievements.get(month.key) ?? 0;
    running.masteryNodes += masteryNodes.get(month.key) ?? 0;
    running.milestones += milestones.get(month.key) ?? 0;
    return { month: month.key, label: month.label, ...running };
  });
}

/** The level the ledger stood at just before an instant: the `levelAfter` of the last row before it. */
async function levelBefore(userId: string, at: Date): Promise<number> {
  const row = await prisma.xPTransaction.findFirst({
    where: { userId, createdAt: { lt: at } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { levelAfter: true },
  });
  return row?.levelAfter ?? 1;
}

/**
 * XP earned and levels gained inside a window of the ledger. Dated by the
 * ledger's own `createdAt`: when the XP was actually awarded.
 */
async function ledgerWindow(userId: string, window: LocalWindow): Promise<{ xpEarned: number; levelsGained: number }> {
  const [sum, before, after] = await Promise.all([
    prisma.xPTransaction.aggregate({
      where: { userId, createdAt: { gte: window.start, lt: window.end } },
      _sum: { amount: true },
    }),
    levelBefore(userId, window.start),
    levelBefore(userId, window.end),
  ]);
  return { xpEarned: sum._sum.amount ?? 0, levelsGained: Math.max(0, after - before) };
}

/**
 * XP and levels for each year the page lists: one ledger aggregate per year,
 * and the level at each year boundary — one read per boundary, shared by the
 * two years that meet there. Bounded by the number of years, never by rows.
 */
async function loadXpAndLevelsByYear(userId: string, years: readonly number[]): Promise<XpYearStat[]> {
  const sorted = [...new Set(years)].sort((a, b) => b - a);
  if (sorted.length === 0) return [];

  const boundaries = new Map<number, Date>();
  for (const year of sorted) {
    const window = yearWindow(year);
    boundaries.set(window.start.getTime(), window.start);
    boundaries.set(window.end.getTime(), window.end);
  }
  const [levels, sums] = await Promise.all([
    Promise.all([...boundaries.entries()].map(async ([ms, at]) => [ms, await levelBefore(userId, at)] as const)),
    Promise.all(sorted.map((year) => {
      const window = yearWindow(year);
      return prisma.xPTransaction.aggregate({
        where: { userId, createdAt: { gte: window.start, lt: window.end } },
        _sum: { amount: true },
      });
    })),
  ]);
  const levelAt = new Map(levels);

  return sorted.map((year, index): XpYearStat => {
    const window = yearWindow(year);
    const before = levelAt.get(window.start.getTime()) ?? 1;
    const after = levelAt.get(window.end.getTime()) ?? before;
    return { year, xpEarned: sums[index]?._sum.amount ?? 0, levelsGained: Math.max(0, after - before) };
  });
}

/** A human description of the current scope, for the heading above the figures. */
function describeScope(
  filter: StatsFilter,
  names: { championship: string | null; season: string | null; circuit: string | null; event: string | null; race: string | null },
): string {
  const parts: string[] = [];

  if (filter.year !== undefined) parts.push(`${filter.year}`);
  if (names.championship !== null) parts.push(names.championship);
  if (names.season !== null) parts.push(names.season);
  if (filter.eventKey !== undefined) parts.push(names.event ?? filter.eventKey);
  if (filter.raceId !== undefined) parts.push(names.race ?? 'A race no longer in your library');
  if (names.circuit !== null) parts.push(names.circuit);
  if (filter.length !== undefined) {
    const band = DURATION_CLASSES.find((entry) => entry.key === filter.length);
    if (band !== undefined) parts.push(`Races of ${band.label.toLowerCase()}`);
  }
  if (filter.raceType !== undefined) parts.push(raceTypeLabel(filter.raceType));

  // Compact hour notation rather than the word, which keeps the label short
  // and sidesteps "1 hours" without a plural rule nobody would maintain.
  const min = filter.minRuntimeHours;
  const max = filter.maxRuntimeHours;
  if (min !== undefined && max !== undefined) parts.push(`${min}h–${max}h races`);
  else if (min !== undefined) parts.push(`${min}h and longer`);
  else if (max !== undefined) parts.push(`up to ${max}h`);

  if (filter.status !== undefined) parts.push(RACE_STATUS_LABELS[filter.status]);
  if (filter.storyCompleteOnly === true) parts.push('Story Complete only');

  return parts.length === 0 ? 'Your whole career' : parts.join(' · ');
}

// ===========================================================================
// Filter options
// ===========================================================================

const STATUS_ORDER: readonly RaceStatus[] = [
  'WATCHING', 'PAUSED', 'QUEUED', 'UNWATCHED', 'COMPLETED', 'ABANDONED', 'ARCHIVED',
];

/**
 * The races the Race select offers: those the rest of the filter chooses,
 * most watched first (inside the chosen year, when there is one), capped.
 * The race already chosen is always offered, so the select can show it.
 */
function raceOptions(
  timeline: CareerTimeline,
  candidates: readonly { id: string; name: string }[],
  filter: StatsFilter,
): StatsRaceOption[] {
  const window = filter.year === undefined ? null : yearWindow(filter.year);
  const options: { id: string; name: string; seconds: number }[] = [];

  for (const candidate of candidates) {
    const history = timeline.races.get(candidate.id);
    if (window === null) {
      options.push({ id: candidate.id, name: candidate.name, seconds: history?.creditedSeconds ?? 0 });
      continue;
    }
    if (history === undefined) continue;
    let seconds = 0;
    let watched = false;
    for (const stint of history.stints) {
      const part = clipToWindow(stint.startsAt, stint.watchedAt, window);
      if (part !== null) seconds += stint.creditedSeconds * part.fraction;
      if (isWithin(stint.watchedAt, window)) watched = true;
    }
    if (watched || seconds > 0) options.push({ id: candidate.id, name: candidate.name, seconds });
  }

  options.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  const offered = options.slice(0, CAREER_STATS_SHAPE.raceOptionLimit);
  if (filter.raceId !== undefined && !offered.some((option) => option.id === filter.raceId)) {
    const chosen = options.find((option) => option.id === filter.raceId);
    const replayed = timeline.racesById.get(filter.raceId);
    if (chosen !== undefined) offered.push(chosen);
    else if (replayed !== undefined) offered.push({ id: replayed.id, name: replayed.name, seconds: 0 });
  }
  return offered.map((option) => ({ id: option.id, name: option.name, hours: toHours(option.seconds) }));
}

/**
 * What the filter controls can offer, read out of the library itself.
 *
 * Nothing here is a fixed catalogue of motorsport. A year appears because
 * something was watched in it, a championship because the user made it, a
 * circuit because the user typed it — which is also why there is no figure
 * anywhere saying how much of "everything" these represent. Years and events
 * are read from the replay, so their hours are the page's own.
 */
export async function getFilterOptions(userId: string, filter: StatsFilter = {}): Promise<StatsFilterOptions> {
  const offersRaces = filter.championshipId !== undefined || filter.eventKey !== undefined
    || filter.year !== undefined || filter.raceId !== undefined;

  const [timeline, weekStartsOn, races, championships, seasons, candidates] = await Promise.all([
    getCareerTimeline(userId),
    loadWeekStart(userId),
    prisma.race.findMany({
      where: { userId },
      select: { circuit: true, circuitSlug: true, country: true, status: true, runtimeSec: true },
    }),
    prisma.championship.findMany({
      where: { userId },
      select: {
        id: true, name: true, slug: true, shortName: true, accentColor: true,
        _count: { select: { races: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.championshipSeason.findMany({
      where: { championship: { userId } },
      select: {
        id: true, year: true, label: true, championshipId: true,
        championship: { select: { name: true } },
        _count: { select: { races: true } },
      },
      orderBy: [{ year: 'desc' }],
    }),
    offersRaces
      ? prisma.race.findMany({
          where: buildRaceScopeWhere(userId, { ...filter, raceId: undefined }),
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const lifetime = lifetimeSummary(timeline, weekStartsOn);
  const years = [...lifetime.years.entries()]
    .filter(([, bucket]) => bucket.sessions > 0 || bucket.creditedSeconds > 0)
    .map(([year, bucket]): StatsYearOption => ({
      year,
      sessions: bucket.sessions,
      realSeconds: Math.round(bucket.creditedSeconds),
      realHours: toHours(bucket.creditedSeconds),
    }))
    .sort((a, b) => b.year - a.year);

  const events = new Map<string, { name: string; seconds: number }>();
  for (const race of timeline.racesById.values()) {
    if (race.eventKey === null) continue;
    const event = events.get(race.eventKey) ?? { name: race.eventName ?? race.eventKey, seconds: 0 };
    event.seconds += timeline.races.get(race.id)?.creditedSeconds ?? 0;
    events.set(race.eventKey, event);
  }

  const circuits = new Map<string, StatsCircuitOption>();
  const lengths = new Map<string, number>();
  const statuses = new Map<RaceStatus, number>();
  let runtimeMin = Number.POSITIVE_INFINITY;
  let runtimeMax = 0;

  for (const race of races) {
    if (race.circuitSlug !== null) {
      const existing = circuits.get(race.circuitSlug);
      if (existing === undefined) {
        circuits.set(race.circuitSlug, {
          circuitSlug: race.circuitSlug,
          name: race.circuit ?? race.circuitSlug,
          country: race.country,
          races: 1,
        });
      } else {
        existing.races += 1;
      }
    }

    const band = durationClassOf(race.runtimeSec).key;
    lengths.set(band, (lengths.get(band) ?? 0) + 1);

    statuses.set(race.status, (statuses.get(race.status) ?? 0) + 1);
    runtimeMin = Math.min(runtimeMin, race.runtimeSec);
    runtimeMax = Math.max(runtimeMax, race.runtimeSec);
  }

  return {
    years,

    championships: championships.map((row): StatsChampionshipOption => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      shortName: row.shortName,
      accentColor: row.accentColor,
      races: row._count.races,
    })),

    seasons: seasons.map((row): StatsSeasonOption => ({
      id: row.id,
      championshipId: row.championshipId,
      championshipName: row.championship.name,
      year: row.year,
      label: row.label ?? `${row.championship.name} ${row.year}`,
      races: row._count.races,
    })),

    circuits: [...circuits.values()].sort((a, b) => b.races - a.races || a.name.localeCompare(b.name)),

    events: [...events.entries()]
      .map(([key, event]): StatsEventOption => ({ key, name: event.name, hours: toHours(event.seconds) }))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),

    races: offersRaces ? raceOptions(timeline, candidates, filter) : [],

    lengths: DURATION_CLASSES
      .filter((band) => lengths.has(band.key) || band.key === filter.length)
      .map((band): StatsLengthOption => ({ key: band.key, label: band.label, races: lengths.get(band.key) ?? 0 })),

    statuses: STATUS_ORDER
      .filter((status) => statuses.has(status))
      .map((status): StatsStatusOption => ({
        status,
        label: RACE_STATUS_LABELS[status],
        races: statuses.get(status) ?? 0,
      })),

    runtimeHours: {
      min: Number.isFinite(runtimeMin) ? round1(runtimeMin / SECONDS_PER_HOUR) : 0,
      max: round1(runtimeMax / SECONDS_PER_HOUR),
    },
  };
}

// ===========================================================================
// XP and levels over time
// ===========================================================================

/**
 * Career and season XP per month, with the running career total beside it.
 *
 * Built from one aggregate per month rather than one pass over the ledger. The
 * ledger is the longest table in the database — every stint writes to it — and
 * a two-year chart has no business reading all of it. The running total starts
 * from a single aggregate of everything before the window, so the cumulative
 * line is exact even when the window starts years into a career, and the level
 * at each point is then a pure function of that total rather than another read.
 */
async function monthlyXpSeries(userId: string, start: Date, end: Date): Promise<XpHistoryPoint[]> {
  const months = monthWindowsBetween(start, end);

  const [baseline, monthlySums] = await Promise.all([
    prisma.xPTransaction.aggregate({
      where: { userId, createdAt: { lt: start } },
      _sum: { amount: true },
    }),
    Promise.all(
      months.map((month) =>
        prisma.xPTransaction.aggregate({
          where: { userId, createdAt: { gte: month.start, lt: month.end } },
          _sum: { amount: true, seasonAmount: true },
          _count: true,
        }),
      ),
    ),
  ]);

  let cumulative = baseline._sum.amount ?? 0;
  let level = levelFromXp(cumulative).level;

  return months.map((month, index): XpHistoryPoint => {
    const sums = monthlySums[index];
    const careerXp = sums?._sum.amount ?? 0;
    const seasonXp = sums?._sum.seasonAmount ?? 0;

    cumulative += careerXp;
    const levelAfter = levelFromXp(cumulative).level;
    const levelsGained = levelAfter - level;
    level = levelAfter;

    return {
      key: month.key,
      year: month.year,
      month: month.month,
      label: month.label,
      start: month.start,
      end: month.end,
      careerXp,
      seasonXp,
      awards: sums?._count ?? 0,
      cumulativeCareerXp: cumulative,
      level: levelAfter,
      levelsGained,
    };
  });
}

/** The default XP window: the trailing months configuration asks for. */
function defaultXpWindow(now: Date, months: number): DateWindow {
  const end = startOfNextMonth(now);
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * Career XP month by month.
 *
 * `months` is clamped to the configured maximum, which keeps the number of
 * per-month aggregates in proportion with the width of the chart.
 */
export async function getXpHistory(
  userId: string,
  opts: { months?: number } = {},
): Promise<XpHistoryPoint[]> {
  const requested = opts.months ?? STATS_CONFIG.xpHistoryDefaultMonths;
  const months = Math.max(1, Math.min(Math.round(requested), STATS_CONFIG.xpHistoryMaxMonths));
  const window = defaultXpWindow(new Date(), months);
  return monthlyXpSeries(userId, window.start, window.end);
}

/**
 * When each career level was reached.
 *
 * One `groupBy` over the ledger gives the first award that landed on each
 * level; the XP each level required and the title and prestige that came with
 * it are pure functions of the level, so nothing else needs reading. Levels a
 * single large award carried straight through have no row of their own and are
 * recorded at the moment of the award that crossed them, flagged
 * `carriedInSameAward` so the chart can draw them honestly.
 */
export async function getLevelHistory(userId: string): Promise<LevelHistoryPoint[]> {
  const [rows, profile] = await Promise.all([
    prisma.xPTransaction.groupBy({
      by: ['levelAfter'],
      where: { userId },
      _min: { createdAt: true },
    }),
    prisma.careerProfile.findUnique({ where: { userId }, select: { level: true, createdAt: true } }),
  ]);

  const reached = new Map<number, Date>();
  for (const row of rows) {
    const at = row._min.createdAt;
    if (at !== null) reached.set(row.levelAfter, at);
  }

  const highest = Math.max(profile?.level ?? 1, ...reached.keys(), 1);
  const points: LevelHistoryPoint[] = [];
  let previousMoment: Date | null = null;

  for (let level = 1; level <= highest; level += 1) {
    let reachedAt = reached.get(level) ?? null;
    let carried = false;

    if (level === 1) {
      // Every career starts at level one, and no award put it there.
      reachedAt = profile?.createdAt ?? reachedAt;
    } else if (reachedAt === null) {
      for (let ahead = level + 1; ahead <= highest; ahead += 1) {
        const later = reached.get(ahead);
        if (later !== undefined) {
          reachedAt = later;
          carried = true;
          break;
        }
      }
    }

    const title = titleForLevel(level);
    const prestige = prestigeForLevel(level);

    points.push({
      level,
      reachedAt,
      totalXpRequired: totalXpForLevel(level),
      title: title.title,
      isTitleThreshold: title.level === level,
      prestige,
      isPrestigeThreshold: prestige > prestigeForLevel(level - 1),
      daysSincePrevious: reachedAt === null || previousMoment === null
        ? null
        : round1((reachedAt.getTime() - previousMoment.getTime()) / MS_PER_DAY),
      carriedInSameAward: carried,
    });

    if (reachedAt !== null) previousMoment = reachedAt;
  }

  return points;
}

// ===========================================================================
// Calendars and months
// ===========================================================================

/**
 * Viewing seconds per local calendar day of one year, from the replay.
 *
 * Only days with something on them are returned; the calendar fills its own
 * gaps. A quiet day is simply a day, and the grid says nothing about it.
 */
export async function getActivityCalendar(userId: string, year: number): Promise<ActivityCalendarDay[]> {
  const [timeline, weekStartsOn] = await Promise.all([getCareerTimeline(userId), loadWeekStart(userId)]);
  const summary = summariseWindow(timeline, yearWindow(year), windowOptions(weekStartsOn));

  return [...bucketsFromSummary(summary).days.values()]
    .filter((day) => day.realSeconds > 0 || day.sessions > 0)
    .map((day): ActivityCalendarDay => ({ date: day.date, realSeconds: day.realSeconds, sessions: day.sessions }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Month-by-month viewing, for one year or for the whole career, from the
 * replay: viewing time over the stint windows, story completions at the
 * stint that completed them. XP is deliberately not here — it has its own
 * series in `getXpHistory`, keyed by the same `YYYY-MM` so a chart can put the
 * two side by side without either engine guessing at the other.
 */
export async function getMonthlyBreakdown(userId: string, year?: number, now: Date = new Date()): Promise<MonthlyStat[]> {
  const window = year === undefined ? null : yearWindow(year);
  const [timeline, weekStartsOn] = await Promise.all([getCareerTimeline(userId), loadWeekStart(userId)]);
  const summary = window === null
    ? lifetimeSummary(timeline, weekStartsOn)
    : summariseWindow(timeline, window, windowOptions(weekStartsOn));
  return buildMonthlyStats(bucketsFromSummary(summary), window, now);
}

// ===========================================================================
// Breakdowns
// ===========================================================================

interface MasteryTotals {
  byChampionship: Map<string, number>;
  nodesTotal: number;
  nodesUnlocked: number;
  treesTotal: number;
  treesCompleted: number;
}

/**
 * Mastery completion, per tree and in total.
 *
 * A championship's percentage is taken against that championship's own tree,
 * and the career figure against the trees this career actually has. Both are
 * scopes somebody defined by adding a championship or an event. The tree of an
 * event merged into another is left out: its steps live on in the event it was
 * merged into, and counting both would count each step twice.
 */
async function loadMasteryTotals(userId: string, merged: Promise<string[]>): Promise<MasteryTotals> {
  const trees = await prisma.masteryTree.findMany({
    where: { userId, ...outsideMergedTrees(await merged) },
    select: {
      championshipId: true,
      nodes: { select: { progress: { where: { userId }, select: { unlockedAt: true } } } },
    },
  });

  const byChampionship = new Map<string, number>();
  let nodesTotal = 0;
  let nodesUnlocked = 0;
  let treesCompleted = 0;

  for (const tree of trees) {
    const unlocked = tree.nodes.filter((node) =>
      node.progress.some((row) => row.unlockedAt !== null),
    ).length;
    nodesTotal += tree.nodes.length;
    nodesUnlocked += unlocked;
    if (tree.nodes.length > 0 && unlocked === tree.nodes.length) treesCompleted += 1;
    if (tree.championshipId !== null) {
      byChampionship.set(tree.championshipId, percentOf(unlocked, tree.nodes.length));
    }
  }

  return { byChampionship, nodesTotal, nodesUnlocked, treesTotal: trees.length, treesCompleted };
}

/** Viewing and completion per championship, inside the current filter. */
export async function getChampionshipBreakdown(
  userId: string,
  filter: StatsFilter = {},
): Promise<ChampionshipStat[]> {
  const merged = mergedEventKeys(userId);
  const [scope, mastery] = await Promise.all([loadScope(userId, filter), loadMasteryTotals(userId, merged)]);
  return buildChampionshipStats(scope, mastery.byChampionship);
}

/** Viewing and completion per circuit, inside the current filter. */
export async function getCircuitBreakdown(
  userId: string,
  filter: StatsFilter = {},
): Promise<CircuitStat[]> {
  const scope = await loadScope(userId, filter);
  return buildCircuitStats(scope);
}

// ===========================================================================
// Budget, challenges and the season pass
// ===========================================================================

/**
 * Each year's viewing budget beside what the year actually held.
 *
 * Every figure is a record. A year that ran under its plan and a year that ran
 * over it are both simply reported, because the budget is a planning framework
 * and never a restriction — and because a past year's plan is kept on its own
 * row precisely so that re-balancing this year cannot rewrite it. The budget
 * counts raw real time on the day a stint was logged, as the Viewing Budget
 * page does.
 */
export async function getBudgetHistory(userId: string): Promise<BudgetYearStat[]> {
  const now = new Date();
  const budgetYears = await prisma.budgetYear.findMany({
    where: { userId },
    orderBy: { year: 'desc' },
    select: { id: true, year: true, annualBudgetHours: true, weeklyTargetHours: true },
  });

  return Promise.all(
    budgetYears.map(async (row): Promise<BudgetYearStat> => {
      const window = yearWindow(row.year);
      const [sessions, weeks, restWeeks, weekCount] = await Promise.all([
        prisma.raceViewingSession.aggregate({
          where: { userId, watchedAt: { gte: window.start, lt: window.end } },
          _sum: { realSeconds: true },
          _count: true,
        }),
        prisma.budgetWeek.aggregate({
          where: { budgetYearId: row.id },
          _sum: { recommendedHours: true },
        }),
        prisma.budgetWeek.count({ where: { budgetYearId: row.id, isRestWeek: true } }),
        prisma.budgetWeek.count({ where: { budgetYearId: row.id } }),
      ]);

      const actualHours = round1((sessions._sum.realSeconds ?? 0) / SECONDS_PER_HOUR);
      const isCurrent = now >= window.start && now < window.end;
      const elapsedEnd = new Date(Math.min(window.end.getTime(), now.getTime()));
      const elapsedWeeks = Math.max(1, (elapsedEnd.getTime() - window.start.getTime()) / (MS_PER_DAY * 7));

      return {
        year: row.year,
        annualBudgetHours: row.annualBudgetHours,
        weeklyTargetHours: row.weeklyTargetHours,
        actualHours,
        percentOfPlan: percentOf(actualHours, row.annualBudgetHours),
        recommendedHours: round1(weeks._sum.recommendedHours ?? 0),
        weeksOnRecord: weekCount,
        restWeeks,
        averageWeeklyHours: round2(actualHours / elapsedWeeks),
        sessions: sessions._count,
        isCurrent,
        note: isCurrent
          ? `${actualHours} hours recorded so far, against a ${row.annualBudgetHours}-hour plan for the year.`
          : `${actualHours} hours recorded across the year, against a ${row.annualBudgetHours}-hour plan.`,
      };
    }),
  );
}

const CHALLENGE_SCOPES: readonly ChallengeScope[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'SEASONAL'];

/** Framing for a challenge record with nothing closed in it yet. */
export const CHALLENGE_SUMMARY_NOTE =
  'Challenges are opportunities rather than obligations. A window that closes takes nothing with it.';

/**
 * How the challenge boards have gone.
 *
 * A window that closed without being completed is counted as closed, never as
 * anything worse: challenges are opportunities, they cost nothing to let pass,
 * and the completion percentage is taken only against the windows that have
 * actually closed — a challenge still running is not a shortfall.
 *
 * Counted by the database rather than by loading the boards: a daily board
 * alone is three rows a day, and none of them need to be in memory to be
 * counted. Challenges with no progress row have never been touched, so they are
 * still open, which is why the totals come from the challenges themselves.
 */
export async function getChallengeStats(userId: string): Promise<ChallengeStat> {
  const [byScope, xp] = await Promise.all([
    Promise.all(
      CHALLENGE_SCOPES.map(async (scope): Promise<ChallengeScopeStat> => {
        const [offered, completed, closed] = await Promise.all([
          prisma.challenge.count({ where: { userId, scope } }),
          prisma.challengeProgress.count({ where: { challenge: { userId, scope }, state: 'COMPLETED' } }),
          prisma.challengeProgress.count({ where: { challenge: { userId, scope }, state: 'EXPIRED' } }),
        ]);
        return {
          scope,
          offered,
          completed,
          active: Math.max(0, offered - completed - closed),
          closed,
          completionPercent: percentOf(completed, completed + closed),
        };
      }),
    ),
    prisma.xPTransaction.aggregate({
      where: { userId, source: 'CHALLENGE' },
      _sum: { amount: true, seasonAmount: true },
    }),
  ]);

  const offered = byScope.reduce((sum, row) => sum + row.offered, 0);
  const completed = byScope.reduce((sum, row) => sum + row.completed, 0);
  const closed = byScope.reduce((sum, row) => sum + row.closed, 0);

  return {
    offered,
    completed,
    active: byScope.reduce((sum, row) => sum + row.active, 0),
    closed,
    completionPercent: percentOf(completed, completed + closed),
    byScope,
    careerXpFromChallenges: xp._sum.amount ?? 0,
    seasonXpFromChallenges: xp._sum.seasonAmount ?? 0,
    // The shared note explains a closed window, so it is shown once there is
    // one to explain and the general framing is used until then.
    note: closed > 0 ? EXPIRED_CHALLENGE_NOTE : CHALLENGE_SUMMARY_NOTE,
  };
}

/** Framing for the season-pass summary. Cosmetic rewards, permanent career. */
export const SEASON_PASS_SUMMARY_NOTE =
  'Season pass rewards are cosmetic, so nothing in your permanent career depends on where a quarter finished.';

/**
 * Every quarter the career has had, as one summary.
 *
 * The completion percentage is taken against the tiers those quarters actually
 * offered — a scope of exactly the quarters lived through, never a target set
 * by quarters that have not happened yet.
 */
export async function getSeasonPassStats(userId: string): Promise<SeasonPassHistoryStat> {
  const passes = await prisma.seasonPass.findMany({
    where: { userId },
    orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
    select: {
      year: true,
      quarter: true,
      tier: true,
      seasonXp: true,
      tiers: { where: { unlockedAt: { not: null } }, select: { isMilestone: true } },
    },
  });

  const tierCount = SEASON_PASS_CONFIG.tierCount;
  let tiersUnlocked = 0;
  let milestoneTiersUnlocked = 0;
  let seasonXpEarned = 0;
  let completedPasses = 0;
  let bestTier = 0;
  let bestQuarterLabel: string | null = null;

  for (const pass of passes) {
    tiersUnlocked += pass.tiers.length;
    milestoneTiersUnlocked += pass.tiers.filter((tier) => tier.isMilestone).length;
    seasonXpEarned += pass.seasonXp;
    if (pass.tiers.length >= tierCount) completedPasses += 1;
    if (pass.tier > bestTier) {
      bestTier = pass.tier;
      // The same shape the season pass page uses for a quarter.
      bestQuarterLabel = `Q${pass.quarter} ${pass.year}`;
    }
  }

  const tiersOffered = passes.length * tierCount;

  return {
    passes: passes.length,
    completedPasses,
    tiersUnlocked,
    milestoneTiersUnlocked,
    seasonXpEarned,
    bestTier,
    bestQuarterLabel,
    averageTier: round1(divide(passes.reduce((sum, pass) => sum + pass.tier, 0), passes.length)),
    tierCount,
    completion: {
      scope: 'the quarters your career has had',
      percent: percentOf(tiersUnlocked, tiersOffered),
      done: tiersUnlocked,
      total: tiersOffered,
    },
    note: SEASON_PASS_SUMMARY_NOTE,
  };
}

// ===========================================================================
// The whole page
// ===========================================================================

/**
 * Every figure the core tabs show — Overview, Cadence, Breakdown and Career —
 * for one scope.
 *
 * This is the only place the pieces are assembled, so the numbers on one page
 * are always mutually consistent: one summary of the replay feeds the totals,
 * the breakdowns and the calendar alike, and nothing is counted twice by two
 * different queries that happened to run a second apart.
 *
 * Some series ignore the race filters, because they are career-long by nature
 * and would be meaningless narrowed to a circuit: the ledger (XP and levels),
 * the landmarks, the annual budget history and the challenge record. The XP
 * series and the landmarks do follow a year filter, since a year of either is
 * a perfectly sensible question. `now` dates the year in progress; the page
 * passes the clock.
 */
export async function getStatistics(
  userId: string,
  filter: StatsFilter = {},
  now: Date = new Date(),
): Promise<StatisticsView> {
  const scope = await loadScope(userId, filter);
  const { summary } = scope;
  const xpWindow = scope.window ?? defaultXpWindow(now, STATS_CONFIG.xpHistoryDefaultMonths);
  const monthly = buildMonthlyStats(scope.buckets, scope.window, now);
  const years = buildYearStats(scope.buckets);
  const merged = mergedEventKeys(userId);

  const [
    achievementsUnlocked,
    mastery,
    seasonPasses,
    challenges,
    xpHistory,
    levelHistory,
    budgetHistory,
    profile,
    landmarks,
    xpAndLevelsByYear,
  ] = await Promise.all([
    prisma.achievementProgress.count({ where: { userId, unlockedAt: { not: null } } }),
    loadMasteryTotals(userId, merged),
    getSeasonPassStats(userId),
    getChallengeStats(userId),
    monthlyXpSeries(userId, xpWindow.start, xpWindow.end),
    getLevelHistory(userId),
    getBudgetHistory(userId),
    prisma.careerProfile.findUnique({
      where: { userId },
      select: { careerXp: true, level: true, prestige: true },
    }),
    loadLandmarkDates(userId, merged),
    loadXpAndLevelsByYear(userId, years.map((year) => year.year)),
  ]);

  const races = buildRaceTotals(scope);
  const careerXp = profile === null ? 0 : Number(profile.careerXp);
  const levelState = levelFromXp(careerXp);
  const linkedEvents = linkedEventKeys(scope.timeline);

  return {
    generatedAt: now,
    filter,
    scopeLabel: scope.scopeLabel,
    narrowed: narrowsRaces(filter),
    careerWideNote: narrowsRaces(filter) ? CAREER_WIDE_XP_NOTE : null,

    viewing: buildViewingTotals(scope),
    races,
    sessions: buildSessionTotals(scope),
    cadence: buildCadence(scope, monthly, years, now),
    favourites: buildFavourites(scope),

    completion: {
      achievements: {
        scope: 'this application’s achievement catalogue',
        percent: percentOf(achievementsUnlocked, ACHIEVEMENTS.length),
        done: achievementsUnlocked,
        total: ACHIEVEMENTS.length,
      },
      mastery: {
        scope: 'the mastery trees your championships and events have',
        percent: percentOf(mastery.nodesUnlocked, mastery.nodesTotal),
        done: mastery.nodesUnlocked,
        total: mastery.nodesTotal,
      },
      masteryTreesCompleted: mastery.treesCompleted,
      masteryTreesTotal: mastery.treesTotal,
      storyLibrary: {
        scope: scope.scopeLabel,
        percent: races.storyCompletePercent,
        done: races.racesStoryComplete,
        total: races.racesInScope,
      },
      note: SCOPED_PERCENTAGE_NOTE,
    },

    seasonPasses,
    challenges,

    monthly,
    years,
    championships: buildChampionshipStats(scope, mastery.byChampionship),
    circuits: buildCircuitStats(scope),

    xpHistory,
    levelHistory,
    budgetHistory,

    rewatchSeconds: Math.round(summary.rewatchSeconds),
    racesExperienced: summary.racesExperienced,
    storyCompleteRate: summary.storyCompleteRate === null ? null : round1(summary.storyCompleteRate),
    averageRaceCompletionPercent: summary.averageRaceCompletionPercent === null
      ? null
      : round1(summary.averageRaceCompletionPercent),
    shortestMeaningfulSession: sessionView(scope.timeline, summary.shortestMeaningfulSession),
    longestRace: summary.longestRace === null
      ? null
      : { raceId: summary.longestRace.raceId, name: summary.longestRace.name, runtimeSec: summary.longestRace.runtimeSec },
    championshipsFollowed: summary.championshipsWatched,
    eventsFollowed: summary.eventsWatched,
    byEvent: summary.byEvent.map((row) =>
      toGroupStat(row, row.id !== null && linkedEvents.has(row.id) ? eventHref(row.id) : null)),
    byWeekday: buildByWeekday(summary, scope.weekStartsOn),
    byDurationClass: summary.byDurationClass.map((row) => toGroupStat(row, null)),
    storyCompletesByChampionship: summary.byChampionship
      .filter((row) => row.storyCompletes > 0)
      .map((row): StoryCompleteCount => ({
        id: row.id, name: row.name, accentColor: row.accent, storyCompletes: row.storyCompletes,
      }))
      .sort((a, b) => b.storyCompletes - a.storyCompletes || a.name.localeCompare(b.name)),
    storyCompletesByYear: buildStoryCompletesByYear(years),
    completionsOverTime: buildCompletionsOverTime(monthly, now),
    landmarksOverTime: buildLandmarksOverTime(landmarks, scope.window, now),
    xpAndLevelsByYear,

    career: {
      level: profile?.level ?? levelState.level,
      prestige: profile?.prestige ?? prestigeForLevel(levelState.level),
      careerXp,
      title: titleForLevel(levelState.level).title,
      xpIntoLevel: levelState.xpIntoLevel,
      xpForLevel: levelState.xpForLevel,
    },

    note: STATISTICS_NOTE,
  };
}

// ===========================================================================
// Personal Records
// ===========================================================================

/** One improvement of a record, as the page shows it. */
export interface RecordEntry {
  kind: RecordKind;
  label: string;
  value: number;
  unit: RecordEvent['unit'];
  valueText: string;
  at: Date;
  /** When, in words: the day, seven days, month or year a period record covers, or the day it was set. */
  when: string;
  /** The race or event that set it, with its page while it still has one. */
  subject: { name: string; href: string | null } | null;
  /** It rests on when stints were logged, so the page marks it (`RECORDS_LOGGED_TIME_NOTE`). */
  loggedTime: boolean;
}

/** A record standing now, and every improvement that led to it, newest first. */
export interface RecordCard extends RecordEntry {
  history: RecordEntry[];
}

export interface RecordsView {
  scopeLabel: string;
  /** Kept within this year (the year filter): "Your best in 2027". Null for career records. */
  withinYear: number | null;
  /** The races are narrowed by a filter. */
  narrowed: boolean;
  /** Only records that are set, in `RECORD_ORDER`. */
  records: RecordCard[];
  /** The rest, named once: "most Story Completes in a year, …". */
  stillToBeSet: string[];
  /** Shown under the grid when a card carries the mark. */
  loggedTimeNote: string | null;
}

/** Periods read as themselves; stints and races read as the day they happened. */
const PERIOD_KINDS = new Set<RecordKind>([
  'most-in-a-day', 'most-in-seven-days', 'most-in-a-month', 'most-completions-in-a-month',
  'most-story-completes-in-a-year', 'most-new-coverage-in-a-day',
]);

/** Records measured from the first stint to the last: they can run to days, so they read as such. */
const ELAPSED_KINDS = new Set<RecordKind>(['fastest-long-race-completion', 'longest-start-to-finish']);

function recordValueText(event: RecordEvent): string {
  if (event.unit === 'editions') return `${event.value} editions`;
  if (event.unit === 'count') return `${event.value}`;
  return ELAPSED_KINDS.has(event.kind) ? formatElapsed(event.value) : formatDuration(event.value);
}

function recordEntry(event: RecordEvent, timeline: CareerTimeline, linkedEvents: ReadonlySet<string>): RecordEntry {
  let subject: RecordEntry['subject'] = null;
  if (event.kind === 'longest-edition-streak' && event.eventKey !== null) {
    subject = { name: event.detail, href: linkedEvents.has(event.eventKey) ? eventHref(event.eventKey) : null };
  } else if (event.raceId !== null) {
    subject = { name: event.detail, href: timeline.racesById.has(event.raceId) ? `/races/${event.raceId}` : null };
  }
  return {
    kind: event.kind,
    label: event.label,
    value: event.value,
    unit: event.unit,
    valueText: recordValueText(event),
    at: event.at,
    when: PERIOD_KINDS.has(event.kind) ? event.detail : longDate(event.at),
    subject,
    loggedTime: event.basis === 'logged-time',
  };
}

/**
 * Personal Records inside a filter: the records standing, each with every
 * improvement that led to it. With a year filter they are the best within
 * that year ("your best in 2027"); otherwise the career's.
 */
export async function getRecords(userId: string, filter: StatsFilter = {}): Promise<RecordsView> {
  const context = await loadFilterContext(userId, filter);
  const progression = computeRecordProgression(context.timeline, {
    ...careerRecordOptions(context.weekStartsOn),
    include: context.include,
    within: filter.year === undefined ? undefined : yearWindow(filter.year),
  });

  const linkedEvents = linkedEventKeys(context.timeline);
  const records = currentRecords(progression).map((current): RecordCard => ({
    ...recordEntry(current, context.timeline, linkedEvents),
    history: progression
      .filter((event) => event.kind === current.kind)
      .map((event) => recordEntry(event, context.timeline, linkedEvents))
      .reverse(),
  }));
  const set = new Set(records.map((record) => record.kind));
  const rollingDays = careerRecordOptions(context.weekStartsOn).rollingDays;

  return {
    scopeLabel: context.scopeLabel,
    withinYear: filter.year ?? null,
    narrowed: narrowsRaces(filter),
    records,
    stillToBeSet: RECORD_ORDER
      .filter((kind) => !set.has(kind))
      .map((kind) => {
        const label = recordLabel(kind, rollingDays);
        return `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
      }),
    loggedTimeNote: records.some((record) => record.loggedTime) ? RECORDS_LOGGED_TIME_NOTE : null,
  };
}

// ===========================================================================
// Two years compared
// ===========================================================================

export type { CompareGroupRow, CompareRow };

export interface YearComparisonView {
  /** The calendar years the career spans, newest first. A comparison needs two. */
  years: number[];
  /** The base year and the year compared with it; null while there is nothing to compare. */
  a: number | null;
  b: number | null;
  /** Either year is the one in progress, so both can be cut to the same stretch of the year. */
  samePeriodOffered: boolean;
  samePeriod: boolean;
  /** "1 January to 26 September", when both years are cut to the same stretch. */
  stretchLabel: string | null;
  /** The race filters, in words; a comparison ignores the year filter. */
  scopeLabel: string;
  narrowed: boolean;
  /** Said beside XP and levels while a filter narrows the races: those are the whole career's. */
  careerWideNote: string | null;
  rows: CompareRow[];
  championships: CompareGroupRow[];
  events: CompareGroupRow[];
  /** Credited seconds, month by month, side by side. */
  months: { month: number; a: number; b: number }[];
  /** "Your 2026 chapter began on 22 September", said first when it applies. */
  partialNote: string | null;
  /** Said instead of a comparison while the career spans a single calendar year. */
  emptyNote: string | null;
}

/**
 * Two calendar years side by side (`compareSummaries`), inside the race
 * filters. `a` is the base: differences are `b − a`. Years that are missing or
 * outside the career fall back to the previous year and the current one, and
 * a base equal to `b` falls back to the year before `b` (the newest other
 * year, when `b` is the career's first).
 *
 * When either year is the one in progress, both are cut by default to the
 * same stretch of the year — 1 January to this moment's date and time in
 * each — so a year still under way is never compared with a whole one.
 * XP and levels come from the ledger for the same windows, and are the whole
 * career's whatever the race filters say.
 */
export async function getYearComparison(
  userId: string,
  a: number | undefined,
  b: number | undefined,
  options: { samePeriod?: boolean; filter?: StatsFilter } = {},
  now: Date = new Date(),
): Promise<YearComparisonView> {
  const filter: StatsFilter = { ...(options.filter ?? {}), year: undefined };
  const context = await loadFilterContext(userId, filter);
  const currentYear = now.getFullYear();
  const first = context.timeline.stints[0]?.watchedAt ?? null;
  const last = context.timeline.stints[context.timeline.stints.length - 1]?.watchedAt ?? null;
  const firstYear = first?.getFullYear() ?? currentYear;
  const lastYear = Math.max(currentYear, last?.getFullYear() ?? currentYear);

  const years: number[] = [];
  if (first !== null) for (let year = lastYear; year >= firstYear; year -= 1) years.push(year);

  const base = {
    years,
    scopeLabel: context.scopeLabel,
    narrowed: narrowsRaces(filter),
    careerWideNote: narrowsRaces(filter) ? CAREER_WIDE_XP_NOTE : null,
  };

  if (years.length < 2) {
    return {
      ...base,
      a: null, b: null, samePeriodOffered: false, samePeriod: false, stretchLabel: null,
      rows: [], championships: [], events: [], months: [], partialNote: null,
      emptyNote: `Comparisons open once your career spans two calendar years. Your first year ends on 31 December ${firstYear}.`,
    };
  }

  const valid = (year: number | undefined): year is number => year !== undefined && years.includes(year);
  const newest = years[0]!;
  const yearB = valid(b) ? b : newest;
  // A year compared with itself says "the same" on every row, so the base
  // falls back to another year then too. The career spans two, so one exists.
  const yearA = valid(a) && a !== yearB
    ? a
    : years.find((year) => year < yearB) ?? years.find((year) => year !== yearB)!;

  const samePeriodOffered = yearA === currentYear || yearB === currentYear;
  const samePeriod = samePeriodOffered && options.samePeriod !== false;
  const windowFor = (year: number): LocalWindow => (
    samePeriod ? { start: yearWindow(year).start, end: samePeriodEnd(year, now) } : yearWindow(year)
  );

  const side = async (year: number): Promise<CompareSide> => {
    const window = windowFor(year);
    const summary = summariseWindow(context.timeline, window, windowOptions(context.weekStartsOn, context.include));
    const ledger = await ledgerWindow(userId, window);
    const began = first !== null && first.getFullYear() === year && first > yearWindow(year).start ? first : null;
    return { ...summary, year, xpEarned: ledger.xpEarned, levelsGained: ledger.levelsGained, careerBeganInYear: began };
  };
  const [sideA, sideB] = await Promise.all([side(yearA), side(yearB)]);
  const compared = compareSummaries(sideA, sideB);

  return {
    ...base,
    a: yearA,
    b: yearB,
    samePeriodOffered,
    samePeriod,
    stretchLabel: samePeriod ? `1 January to ${now.getDate()} ${MONTH_NAMES[now.getMonth()]}` : null,
    rows: compared.rows,
    championships: compared.championships,
    events: compared.events,
    months: compared.months.map((month) => ({ month: month.month, a: Math.round(month.a), b: Math.round(month.b) })),
    partialNote: compared.partialNote,
    emptyNote: null,
  };
}
