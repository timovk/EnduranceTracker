/**
 * Personal statistics.
 *
 * This engine is READ-ONLY. It opens no transaction, writes nothing and awards
 * nothing — everything it reports was earned somewhere else, and a statistics
 * page that could move a figure by being looked at would not be a statistics
 * page. It therefore reads through the global client rather than taking a
 * transaction client the way the writing engines do.
 *
 * TWO QUANTITIES THAT ARE NEVER THE SAME THING
 *
 * Real viewing time is what a person actually spent in front of the screen. It
 * comes from `RaceViewingSession.realSeconds`, it counts every re-watch, and it
 * is what the viewing budget is denominated in.
 *
 * Unique race-timeline coverage is how much of a race's story has been seen at
 * least once. It comes from `Race.coverageSec`, which is rebuilt from the
 * merged `WatchedInterval` set, and re-watching cannot increase it.
 *
 * The worked example: watch 00:00–01:00 of a race, then re-watch 00:30–01:00.
 * That is 1h 30m of real viewing time and 1h of unique coverage. Both figures
 * are true and they measure different things, so every field in this file
 * carries the distinction in its name —
 *
 *   * `realSeconds` / `realHours`      time spent, re-watches included
 *   * `uniqueCoverageSeconds`          story seen, re-watches excluded
 *   * `timelinePlayedSeconds`          timeline played, re-watches included
 *   * `newCoverageSeconds`             story seen for the first time in a window
 *
 * — so that nothing downstream can quietly put one in the other's place.
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
 * Totals and per-race figures are aggregated by the database: one `aggregate`
 * for the scope's totals and one `groupBy` for its per-race sums, both of which
 * stay constant in size as the session history grows. The one thing Postgres is
 * not asked to do is bucket sessions into calendar days and months, because
 * doing that in SQL would mean committing to a timezone in the query, and the
 * rest of the application (`domain/periods`, the momentum history, the viewing
 * week) treats a day as a LOCAL calendar day. Those buckets are therefore built
 * in JavaScript from the narrowest possible projection — three columns, no
 * relations — which keeps the one unbounded read small enough to stay honest
 * with tens of thousands of sessions.
 *
 * Everything returned is plainly serialisable: numbers, strings and Dates. No
 * BigInt crosses this boundary, because these views are rendered by client
 * components and `careerXp` is a BigInt in the database.
 */

import type { Prisma } from '@/generated/prisma/client';
import { ACHIEVEMENTS, RACE_TYPE_PRESETS, SEASON_PASS_CONFIG, STATS_CONFIG } from '@/lib/config';
import { EXPIRED_CHALLENGE_NOTE, backlogFraming } from '@/lib/copy/tone';
import { prisma } from '@/lib/db/client';
import { isoWeekParts, monthPeriod } from '@/lib/domain/periods';
import { averagePlaybackSpeed } from '@/lib/domain/playback';
import { levelFromXp, prestigeForLevel, titleForLevel, totalXpForLevel } from '@/lib/domain/progression';
import type { ChallengeScope, RaceStatus, RaceType } from '@/lib/domain/types';

// ===========================================================================
// The filter
// ===========================================================================

/**
 * How the statistics page narrows what it is looking at.
 *
 * Two different kinds of narrowing live in one object, and the difference
 * matters. `championshipId`, `seasonId`, `circuitSlug`, `raceType`, the runtime
 * bounds, `status` and `storyCompleteOnly` choose a set of RACES. `year`
 * chooses a WINDOW OF TIME: viewing figures come from the sessions logged
 * inside it, and a race counts as in scope for a year when something actually
 * happened to it in that year.
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

export interface StatsDurationOption {
  raceType: RaceType;
  label: string;
  races: number;
  /** Shortest and longest runtime actually present for this type. */
  minRuntimeHours: number;
  maxRuntimeHours: number;
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
  durations: StatsDurationOption[];
  statuses: StatsStatusOption[];
  /** Bounds for the runtime slider, in hours. */
  runtimeHours: { min: number; max: number };
}

// ===========================================================================
// The view
// ===========================================================================

/** Time spent and story seen, kept rigorously apart. */
export interface ViewingTotals {
  /** Real-world seconds in front of the screen. Re-watches included. */
  realSeconds: number;
  realHours: number;
  /** Real viewing time expressed in whole days' worth of hours. */
  equivalentDays: number;

  /** Race-timeline seconds played, re-watches included. NOT coverage. */
  timelinePlayedSeconds: number;
  timelinePlayedHours: number;

  /**
   * Unique race-timeline seconds covered by the races in scope, as a lifetime
   * figure per race. Re-watching never increases it.
   */
  uniqueCoverageSeconds: number;
  uniqueCoverageHours: number;

  /**
   * Unique race-timeline seconds seen for the FIRST time by the sessions in
   * scope. Under a year filter this is the story the year actually uncovered,
   * which is a different question from how much of those races has ever been
   * seen — hence both figures, separately named.
   */
  newCoverageSeconds: number;
  newCoverageHours: number;

  /**
   * Real seconds attributable to re-watched timeline, apportioned from the
   * scope's own average speed. Re-watching is a perfectly good way to spend an
   * evening; this is here to be interesting, never to be deducted.
   */
  rewatchRealSeconds: number;
  /** Share of the timeline played that had been seen before, 0-1. */
  rewatchShare: number;

  sessions: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
}

export interface RaceTotals {
  /** Races matching the filter. Every percentage below is taken against this. */
  racesInScope: number;
  racesStarted: number;
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

export interface LongestSessionView {
  raceId: string;
  raceName: string;
  watchedAt: Date;
  realSeconds: number;
  timelineSeconds: number;
  playbackSpeed: number;
}

export interface SessionTotals {
  sessions: number;
  /** Mean real seconds per logged stint. */
  averageRealSeconds: number;
  averageRealMinutes: number;
  longestRealSeconds: number;
  longestSession: LongestSessionView | null;
  /** Timeline played ÷ real time: the speed actually watched at, weighted. */
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
  /** Most real viewing time. */
  championshipByHours: FavouriteEntry | null;
  /** Most races seen through — a different question, and often a different answer. */
  championshipByCompletions: FavouriteEntry | null;
  circuit: FavouriteEntry | null;
  /** The recurring event (`Race.iconicKey`) with the most real viewing time. */
  event: FavouriteEntry | null;
  /** The single race with the most real viewing time. */
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
  /** Against the races in the current filter. */
  library: ScopedPercent;
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

  career: CareerSnapshot;
  note: string;
}

/** The rule this file exists to keep, said plainly enough for the page to show. */
export const SCOPED_PERCENTAGE_NOTE =
  'Every percentage here is measured against a scope you defined — this filter, a season, ' +
  'a championship, a quarter. Nothing measures your career against every race ever run.';

/** Framing for the page as a whole. A record, not a scoreboard. */
export const STATISTICS_NOTE =
  'A record of what you have watched. Nothing here expires, and nothing here goes down.';

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

/**
 * Local calendar day as `YYYY-MM-DD`.
 *
 * Built from local date parts rather than `toISOString`, which would be UTC:
 * a session logged at 00:30 in a timezone ahead of UTC belongs to the day the
 * user was living in, not to the previous one.
 */
function localDayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Half-open window of a calendar year, in local time. */
export interface DateWindow {
  start: Date;
  /** Exclusive. */
  end: Date;
}

export function yearWindow(year: number): DateWindow {
  return { start: new Date(year, 0, 1, 0, 0, 0, 0), end: new Date(year + 1, 0, 1, 0, 0, 0, 0) };
}

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

/** The label the Add Race form uses for a race type, so the filter agrees with it. */
export function raceTypeLabel(raceType: RaceType): string {
  return RACE_TYPE_PRESETS.find((preset) => preset.type === raceType)?.label ?? raceType;
}

function isWithin(date: Date | null, window: DateWindow | null): boolean {
  if (date === null) return false;
  if (window === null) return true;
  return date >= window.start && date < window.end;
}

// ===========================================================================
// Turning a filter into queries
// ===========================================================================

/**
 * The race predicates of a filter — everything except the year.
 *
 * Used both to choose the races in scope and, nested, to choose the sessions
 * that belong to them, so the two can never drift apart.
 */
export function buildRaceScopeWhere(userId: string, filter: StatsFilter = {}): Prisma.RaceWhereInput {
  const where: Prisma.RaceWhereInput = { userId };

  if (filter.championshipId !== undefined) where.championshipId = filter.championshipId;
  if (filter.seasonId !== undefined) where.seasonId = filter.seasonId;
  if (filter.circuitSlug !== undefined) where.circuitSlug = filter.circuitSlug;
  if (filter.raceType !== undefined) where.raceType = filter.raceType;
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.storyCompleteOnly === true) where.storyCompletedAt = { not: null };

  const min = filter.minRuntimeHours;
  const max = filter.maxRuntimeHours;
  if (min !== undefined || max !== undefined) {
    where.runtimeSec = {
      ...(min !== undefined ? { gte: Math.round(min * SECONDS_PER_HOUR) } : {}),
      ...(max !== undefined ? { lte: Math.round(max * SECONDS_PER_HOUR) } : {}),
    };
  }

  return where;
}

/**
 * The races a filter puts in scope.
 *
 * With a year, a race is in scope when something happened to it that year: it
 * was watched, its story finished, or it was marked complete. That is what
 * makes "2025" read as the year rather than as the whole library seen through
 * a date field.
 */
export function buildRacesInScopeWhere(userId: string, filter: StatsFilter = {}): Prisma.RaceWhereInput {
  const where = buildRaceScopeWhere(userId, filter);
  if (filter.year === undefined) return where;

  const window = yearWindow(filter.year);
  const inYear = { gte: window.start, lt: window.end };
  return {
    ...where,
    OR: [
      { sessions: { some: { watchedAt: inYear } } },
      { storyCompletedAt: inYear },
      { completedAt: inYear },
    ],
  };
}

/** The sessions a filter puts in scope: the right races, inside the right window. */
export function buildSessionScopeWhere(
  userId: string,
  filter: StatsFilter = {},
): Prisma.RaceViewingSessionWhereInput {
  const where: Prisma.RaceViewingSessionWhereInput = {
    userId,
    race: buildRaceScopeWhere(userId, filter),
  };
  if (filter.year !== undefined) {
    const window = yearWindow(filter.year);
    where.watchedAt = { gte: window.start, lt: window.end };
  }
  return where;
}

// ===========================================================================
// Calendar buckets
// ===========================================================================

interface DayBucket {
  date: string;
  realSeconds: number;
  sessions: number;
  newCoverageSeconds: number;
}

interface MonthBucket {
  key: string;
  year: number;
  month: number;
  realSeconds: number;
  sessions: number;
  newCoverageSeconds: number;
  days: Set<string>;
}

interface YearBucket {
  year: number;
  realSeconds: number;
  sessions: number;
  newCoverageSeconds: number;
  days: Set<string>;
}

interface ActivityBuckets {
  days: Map<string, DayBucket>;
  months: Map<string, MonthBucket>;
  years: Map<number, YearBucket>;
  /** Distinct viewing weeks with activity, as `2026-W12` keys. */
  weeks: Set<string>;
}

/**
 * Bucket sessions into local days, months, years and viewing weeks.
 *
 * This is the one read in the file that grows with the session history, so the
 * projection is as narrow as the database allows: three scalar columns, no
 * relations, no ordering. It is done here rather than in SQL because a calendar
 * day in this application is a LOCAL day — `domain/periods`, the momentum
 * history and the viewing week all agree on that — and expressing it in the
 * query would mean freezing a timezone into it.
 */
async function loadActivityBuckets(
  where: Prisma.RaceViewingSessionWhereInput,
  weekStartsOn = 1,
): Promise<ActivityBuckets> {
  const rows = await prisma.raceViewingSession.findMany({
    where,
    select: { watchedAt: true, realSeconds: true, newCoverageSeconds: true },
  });

  const buckets: ActivityBuckets = {
    days: new Map(),
    months: new Map(),
    years: new Map(),
    weeks: new Set(),
  };

  for (const row of rows) {
    const at = row.watchedAt;
    const dayKey = localDayKey(at);
    const year = at.getFullYear();
    const monthKey = dayKey.slice(0, 7);

    const day = buckets.days.get(dayKey) ??
      { date: dayKey, realSeconds: 0, sessions: 0, newCoverageSeconds: 0 };
    day.realSeconds += row.realSeconds;
    day.newCoverageSeconds += row.newCoverageSeconds;
    day.sessions += 1;
    buckets.days.set(dayKey, day);

    const month = buckets.months.get(monthKey) ??
      { key: monthKey, year, month: at.getMonth() + 1, realSeconds: 0, sessions: 0, newCoverageSeconds: 0, days: new Set<string>() };
    month.realSeconds += row.realSeconds;
    month.newCoverageSeconds += row.newCoverageSeconds;
    month.sessions += 1;
    month.days.add(dayKey);
    buckets.months.set(monthKey, month);

    const yearBucket = buckets.years.get(year) ??
      { year, realSeconds: 0, sessions: 0, newCoverageSeconds: 0, days: new Set<string>() };
    yearBucket.realSeconds += row.realSeconds;
    yearBucket.newCoverageSeconds += row.newCoverageSeconds;
    yearBucket.sessions += 1;
    yearBucket.days.add(dayKey);
    buckets.years.set(year, yearBucket);

    const week = isoWeekParts(at, weekStartsOn);
    buckets.weeks.add(`${week.isoYear}-W${`${week.isoWeek}`.padStart(2, '0')}`);
  }

  return buckets;
}

// ===========================================================================
// The scope: one load, shared by every breakdown on the page
// ===========================================================================

const STATS_RACE_SELECT = {
  id: true,
  name: true,
  championshipId: true,
  seasonId: true,
  circuit: true,
  circuitSlug: true,
  country: true,
  raceType: true,
  status: true,
  runtimeSec: true,
  coverageSec: true,
  isMajorEvent: true,
  iconicKey: true,
  raceDate: true,
  startedAt: true,
  completedAt: true,
  storyCompletedAt: true,
  lastWatchedAt: true,
} satisfies Prisma.RaceSelect;

type StatsRaceRow = Prisma.RaceGetPayload<{ select: typeof STATS_RACE_SELECT }>;

/** Real viewing figures for one race, inside the current scope. */
interface RaceSessionTotals {
  sessions: number;
  realSeconds: number;
  timelineSeconds: number;
  newCoverageSeconds: number;
  longestRealSeconds: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
}

const EMPTY_RACE_TOTALS: RaceSessionTotals = {
  sessions: 0,
  realSeconds: 0,
  timelineSeconds: 0,
  newCoverageSeconds: 0,
  longestRealSeconds: 0,
  firstWatchedAt: null,
  lastWatchedAt: null,
};

interface ChampionshipRow {
  id: string;
  name: string;
  slug: string;
  accentColor: string;
}

/**
 * Everything one scope needs, loaded once.
 *
 * The totals and the per-race sums are aggregated by the database; only the
 * calendar buckets and the race rows themselves come back as rows, and the race
 * library is bounded by what the user has added rather than by how long they
 * have been watching.
 */
interface StatsScope {
  filter: StatsFilter;
  window: DateWindow | null;
  races: StatsRaceRow[];
  perRace: Map<string, RaceSessionTotals>;
  totals: RaceSessionTotals;
  buckets: ActivityBuckets;
  championships: ChampionshipRow[];
  weekStartsOn: number;
}

async function loadScope(userId: string, filter: StatsFilter): Promise<StatsScope> {
  const raceWhere = buildRacesInScopeWhere(userId, filter);
  const sessionWhere = buildSessionScopeWhere(userId, filter);
  const window = filter.year === undefined ? null : yearWindow(filter.year);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { weekStart: true } });
  const weekStartsOn = user?.weekStart ?? 1;

  const [races, perRaceRows, aggregate, buckets, championships] = await Promise.all([
    prisma.race.findMany({ where: raceWhere, select: STATS_RACE_SELECT }),
    prisma.raceViewingSession.groupBy({
      by: ['raceId'],
      where: sessionWhere,
      _sum: { realSeconds: true, timelineSeconds: true, newCoverageSeconds: true },
      _max: { realSeconds: true, watchedAt: true },
      _min: { watchedAt: true },
      _count: true,
    }),
    prisma.raceViewingSession.aggregate({
      where: sessionWhere,
      _sum: { realSeconds: true, timelineSeconds: true, newCoverageSeconds: true },
      _max: { realSeconds: true, watchedAt: true },
      _min: { watchedAt: true },
      _count: true,
    }),
    loadActivityBuckets(sessionWhere, weekStartsOn),
    prisma.championship.findMany({
      where: { userId },
      select: { id: true, name: true, slug: true, accentColor: true },
    }),
  ]);

  const perRace = new Map<string, RaceSessionTotals>();
  for (const row of perRaceRows) {
    perRace.set(row.raceId, {
      sessions: row._count,
      realSeconds: row._sum.realSeconds ?? 0,
      timelineSeconds: row._sum.timelineSeconds ?? 0,
      newCoverageSeconds: row._sum.newCoverageSeconds ?? 0,
      longestRealSeconds: row._max.realSeconds ?? 0,
      firstWatchedAt: row._min.watchedAt,
      lastWatchedAt: row._max.watchedAt,
    });
  }

  return {
    filter,
    window,
    races,
    perRace,
    totals: {
      sessions: aggregate._count,
      realSeconds: aggregate._sum.realSeconds ?? 0,
      timelineSeconds: aggregate._sum.timelineSeconds ?? 0,
      newCoverageSeconds: aggregate._sum.newCoverageSeconds ?? 0,
      longestRealSeconds: aggregate._max.realSeconds ?? 0,
      firstWatchedAt: aggregate._min.watchedAt,
      lastWatchedAt: aggregate._max.watchedAt,
    },
    buckets,
    championships,
    weekStartsOn,
  };
}

/** Real viewing figures for one race in this scope, or zeroes if it was not watched. */
function totalsFor(scope: StatsScope, raceId: string): RaceSessionTotals {
  return scope.perRace.get(raceId) ?? EMPTY_RACE_TOTALS;
}

// ===========================================================================
// Building the view
// ===========================================================================

function buildViewingTotals(scope: StatsScope, uniqueCoverageSeconds: number): ViewingTotals {
  const { totals } = scope;

  // Timeline played that had been seen before. Re-watching is a perfectly good
  // evening; this figure exists to be interesting, and nothing subtracts it
  // from anything.
  const rewatchTimelineSeconds = Math.max(0, totals.timelineSeconds - totals.newCoverageSeconds);
  const rewatchShare = divide(rewatchTimelineSeconds, totals.timelineSeconds);

  return {
    realSeconds: totals.realSeconds,
    realHours: toHours(totals.realSeconds),
    equivalentDays: round1(totals.realSeconds / SECONDS_PER_DAY),

    timelinePlayedSeconds: totals.timelineSeconds,
    timelinePlayedHours: toHours(totals.timelineSeconds),

    uniqueCoverageSeconds,
    uniqueCoverageHours: toHours(uniqueCoverageSeconds),

    newCoverageSeconds: totals.newCoverageSeconds,
    newCoverageHours: toHours(totals.newCoverageSeconds),

    // Apportioned rather than measured: the session rows hold one speed each,
    // so the honest conversion from re-watched timeline to real time is the
    // scope's own ratio of real seconds to timeline seconds.
    rewatchRealSeconds: Math.round(totals.realSeconds * rewatchShare),
    rewatchShare: round2(rewatchShare),

    sessions: totals.sessions,
    firstWatchedAt: totals.firstWatchedAt,
    lastWatchedAt: totals.lastWatchedAt,
  };
}

function buildRaceTotals(scope: StatsScope): RaceTotals {
  const window = scope.window;

  let started = 0;
  let completed = 0;
  let storyComplete = 0;
  let unstarted = 0;
  let runtimeSum = 0;
  let longestRuntime = 0;
  let coverageRatioSum = 0;
  let majorEvents = 0;
  let majorEventsStoryComplete = 0;

  for (const race of scope.races) {
    runtimeSum += race.runtimeSec;
    longestRuntime = Math.max(longestRuntime, race.runtimeSec);
    coverageRatioSum += divide(Math.min(race.coverageSec, race.runtimeSec), race.runtimeSec);

    if (race.startedAt === null) unstarted += 1;
    if (isWithin(race.startedAt, window)) started += 1;
    if (isWithin(race.completedAt, window)) completed += 1;
    if (isWithin(race.storyCompletedAt, window)) storyComplete += 1;
    if (race.isMajorEvent) {
      majorEvents += 1;
      if (isWithin(race.storyCompletedAt, window)) majorEventsStoryComplete += 1;
    }
  }

  const racesInScope = scope.races.length;

  return {
    racesInScope,
    racesStarted: started,
    racesCompleted: completed,
    racesStoryComplete: storyComplete,
    racesUnstarted: unstarted,

    completionPercent: percentOf(completed, racesInScope),
    storyCompletePercent: percentOf(storyComplete, racesInScope),
    startedCompletionPercent: percentOf(completed, started),

    averageRuntimeSec: Math.round(divide(runtimeSum, racesInScope)),
    averageRuntimeHours: toHours(divide(runtimeSum, racesInScope)),
    longestRuntimeSec: longestRuntime,
    averageCoveragePercent: round1(divide(coverageRatioSum, racesInScope) * 100),

    majorEvents,
    majorEventsStoryComplete,

    libraryNote: backlogFraming(unstarted),
  };
}

function buildSessionTotals(scope: StatsScope, longest: LongestSessionView | null): SessionTotals {
  const { totals } = scope;
  const activeDays = scope.buckets.days.size;

  return {
    sessions: totals.sessions,
    averageRealSeconds: Math.round(divide(totals.realSeconds, totals.sessions)),
    averageRealMinutes: round1(divide(totals.realSeconds, totals.sessions) / 60),
    longestRealSeconds: totals.longestRealSeconds,
    longestSession: longest,
    // Weighted by timeline seconds rather than by session count, so a two-minute
    // stint at 3x cannot drag the average of a six-hour race.
    averagePlaybackSpeed: averagePlaybackSpeed([
      { timelineSeconds: totals.timelineSeconds, realSeconds: totals.realSeconds },
    ]),
    averageSessionsPerActiveDay: round2(divide(totals.sessions, activeDays)),
  };
}

/**
 * Story completions per local month and per year, from the races in scope.
 *
 * Taken from `Race.storyCompletedAt` rather than from the session rows: a story
 * finishes once, on the day it finished, however many stints it took.
 */
function storyCompletionsByPeriod(scope: StatsScope): { months: Map<string, number>; years: Map<number, number> } {
  const months = new Map<string, number>();
  const years = new Map<number, number>();

  for (const race of scope.races) {
    const at = race.storyCompletedAt;
    if (at === null || !isWithin(at, scope.window)) continue;
    const key = localDayKey(at).slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + 1);
    years.set(at.getFullYear(), (years.get(at.getFullYear()) ?? 0) + 1);
  }

  return { months, years };
}

/**
 * Months as a contiguous series.
 *
 * Quiet months are included with zeroes rather than left out. A chart with a
 * gap in it invites the reader to wonder what went wrong; a chart with a quiet
 * month in it simply shows a quiet month, which is all it was.
 */
function buildMonthlyStats(
  buckets: ActivityBuckets,
  storyCompletions: Map<string, number>,
  range: DateWindow | null,
): MonthlyStat[] {
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
    const now = new Date();
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
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
      activeDays: bucket?.days.size ?? 0,
      newCoverageSeconds,
      newCoverageHours: toHours(newCoverageSeconds),
      racesStoryComplete: storyCompletions.get(month.key) ?? 0,
      averageSessionRealSeconds: Math.round(divide(realSeconds, sessions)),
    };
  });
}

function buildYearStats(buckets: ActivityBuckets, storyCompletions: Map<number, number>): YearStat[] {
  return [...buckets.years.values()]
    .map((bucket): YearStat => ({
      year: bucket.year,
      realSeconds: bucket.realSeconds,
      realHours: toHours(bucket.realSeconds),
      sessions: bucket.sessions,
      activeDays: bucket.days.size,
      newCoverageSeconds: bucket.newCoverageSeconds,
      racesStoryComplete: storyCompletions.get(bucket.year) ?? 0,
    }))
    .sort((a, b) => b.year - a.year);
}

function buildCadence(scope: StatsScope, monthly: MonthlyStat[], years: YearStat[], now: Date): CadenceStats {
  const { totals, buckets } = scope;

  // The span the averages are taken over: the filtered window if there is one,
  // otherwise from the first session to today. Never longer than the career.
  const start = scope.window?.start ?? totals.firstWatchedAt ?? now;
  const windowEnd = scope.window?.end ?? now;
  const end = new Date(Math.min(windowEnd.getTime(), now.getTime()));
  const elapsedDays = Math.max(1, (end.getTime() - start.getTime()) / MS_PER_DAY);
  const elapsedWeeks = Math.max(1, elapsedDays / 7);
  const elapsedMonths = Math.max(1, monthly.length);

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
    (best, day) => (best === null || day.realSeconds > best.realSeconds ? day : best),
    null,
  );

  return {
    activeDays: buckets.days.size,
    activeWeeks: buckets.weeks.size,
    activeMonths: buckets.months.size,
    elapsedWeeks: round1(elapsedWeeks),
    elapsedMonths: monthly.length,

    averageRealHoursPerWeek: round2(divide(totals.realSeconds / SECONDS_PER_HOUR, elapsedWeeks)),
    averageRealHoursPerActiveWeek: round2(divide(totals.realSeconds / SECONDS_PER_HOUR, buckets.weeks.size)),
    averageRealHoursPerMonth: round2(divide(totals.realSeconds / SECONDS_PER_HOUR, elapsedMonths)),
    averageRealHoursPerActiveMonth: round2(divide(totals.realSeconds / SECONDS_PER_HOUR, buckets.months.size)),

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
  uniqueCoverageSeconds: number;
  sessions: number;
  firstWatchedAt: Date | null;
  lastWatchedAt: Date | null;
}

/**
 * Fold the races in scope into groups.
 *
 * Real viewing time always comes from the sessions in scope, and unique
 * coverage always from the race's own merged intervals, so a group's two time
 * figures answer the two different questions they are named for.
 */
function groupRaces(
  scope: StatsScope,
  keyOf: (race: StatsRaceRow) => { key: string; name: string } | null,
): RaceGroup[] {
  const groups = new Map<string, RaceGroup>();

  for (const race of scope.races) {
    const identity = keyOf(race);
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
      uniqueCoverageSeconds: 0,
      sessions: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
    };

    const totals = totalsFor(scope, race.id);
    group.races += 1;
    if (isWithin(race.startedAt, scope.window)) group.racesStarted += 1;
    if (isWithin(race.completedAt, scope.window)) group.racesCompleted += 1;
    if (isWithin(race.storyCompletedAt, scope.window)) group.racesStoryComplete += 1;
    group.realSeconds += totals.realSeconds;
    group.timelineSeconds += totals.timelineSeconds;
    group.uniqueCoverageSeconds += Math.min(race.coverageSec, race.runtimeSec);
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
    realSeconds: group.realSeconds,
    realHours: toHours(group.realSeconds),
    sessions: group.sessions,
    races: group.races,
    racesCompleted: group.racesCompleted,
    racesStoryComplete: group.racesStoryComplete,
    uniqueCoverageSeconds: group.uniqueCoverageSeconds,
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

        realSeconds: group.realSeconds,
        realHours: toHours(group.realSeconds),
        timelinePlayedSeconds: group.timelineSeconds,
        uniqueCoverageSeconds: group.uniqueCoverageSeconds,
        uniqueCoverageHours: toHours(group.uniqueCoverageSeconds),
        sessions: group.sessions,
        averagePlaybackSpeed: averagePlaybackSpeed([
          { timelineSeconds: group.timelineSeconds, realSeconds: group.realSeconds },
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
  for (const race of scope.races) {
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
      realSeconds: group.realSeconds,
      realHours: toHours(group.realSeconds),
      uniqueCoverageSeconds: group.uniqueCoverageSeconds,
      sessions: group.sessions,
      lastWatchedAt: group.lastWatchedAt,
    }))
    .sort((a, b) => b.realSeconds - a.realSeconds || a.name.localeCompare(b.name));
}

function buildFavourites(scope: StatsScope, eventNames: Map<string, string>): FavouriteStats {
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
  const events = groupRaces(scope, (race) =>
    race.iconicKey === null
      ? null
      : { key: race.iconicKey, name: eventNames.get(race.iconicKey) ?? race.name },
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
      : toFavourite(race, `${toHours(race.realSeconds)} real hours across ${race.sessions} sessions.`),
  };
}

/** A human description of the current scope, for the heading above the figures. */
function describeScope(
  filter: StatsFilter,
  names: { championship: string | null; season: string | null; circuit: string | null },
): string {
  const parts: string[] = [];

  if (filter.year !== undefined) parts.push(`${filter.year}`);
  if (names.championship !== null) parts.push(names.championship);
  if (names.season !== null) parts.push(names.season);
  if (names.circuit !== null) parts.push(names.circuit);
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
 * The years that have something in them.
 *
 * Read from the span of the session history and then one aggregate per year
 * inside it, rather than by reading every session: the filter needs a short
 * list of years, and the number of years a career spans is a much smaller
 * quantity than the number of stints it holds.
 */
async function loadActiveYears(userId: string): Promise<StatsYearOption[]> {
  const span = await prisma.raceViewingSession.aggregate({
    where: { userId },
    _min: { watchedAt: true },
    _max: { watchedAt: true },
  });

  const first = span._min.watchedAt;
  const last = span._max.watchedAt;
  if (first === null || last === null) return [];

  const years: number[] = [];
  for (let year = first.getFullYear(); year <= last.getFullYear(); year += 1) years.push(year);

  const rows = await Promise.all(
    years.map(async (year): Promise<StatsYearOption> => {
      const window = yearWindow(year);
      const aggregate = await prisma.raceViewingSession.aggregate({
        where: { userId, watchedAt: { gte: window.start, lt: window.end } },
        _sum: { realSeconds: true },
        _count: true,
      });
      const realSeconds = aggregate._sum.realSeconds ?? 0;
      return { year, sessions: aggregate._count, realSeconds, realHours: toHours(realSeconds) };
    }),
  );

  return rows.filter((row) => row.sessions > 0).sort((a, b) => b.year - a.year);
}

/**
 * What the filter controls can offer, read out of the library itself.
 *
 * Nothing here is a fixed catalogue of motorsport. A year appears because
 * something was watched in it, a championship because the user made it, a
 * circuit because the user typed it — which is also why there is no figure
 * anywhere saying how much of "everything" these represent.
 */
export async function getFilterOptions(userId: string): Promise<StatsFilterOptions> {
  const [races, championships, seasons, years] = await Promise.all([
    prisma.race.findMany({
      where: { userId },
      select: { circuit: true, circuitSlug: true, country: true, raceType: true, status: true, runtimeSec: true },
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
    loadActiveYears(userId),
  ]);

  const circuits = new Map<string, StatsCircuitOption>();
  const durations = new Map<RaceType, { races: number; min: number; max: number }>();
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

    const duration = durations.get(race.raceType) ??
      { races: 0, min: Number.POSITIVE_INFINITY, max: 0 };
    duration.races += 1;
    duration.min = Math.min(duration.min, race.runtimeSec);
    duration.max = Math.max(duration.max, race.runtimeSec);
    durations.set(race.raceType, duration);

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

    durations: RACE_TYPE_PRESETS
      .filter((preset) => durations.has(preset.type))
      .map((preset): StatsDurationOption => {
        const found = durations.get(preset.type);
        return {
          raceType: preset.type,
          label: preset.label,
          races: found?.races ?? 0,
          minRuntimeHours: round1((found?.min ?? 0) / SECONDS_PER_HOUR),
          maxRuntimeHours: round1((found?.max ?? 0) / SECONDS_PER_HOUR),
        };
      }),

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
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
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
 * Real viewing seconds per local calendar day of one year.
 *
 * Only days with something on them are returned; the calendar fills its own
 * gaps. A quiet day is simply a day, and the grid says nothing about it.
 */
export async function getActivityCalendar(userId: string, year: number): Promise<ActivityCalendarDay[]> {
  const window = yearWindow(year);
  const buckets = await loadActivityBuckets({
    userId,
    watchedAt: { gte: window.start, lt: window.end },
  });

  return [...buckets.days.values()]
    .map((day): ActivityCalendarDay => ({
      date: day.date,
      realSeconds: day.realSeconds,
      sessions: day.sessions,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Month-by-month viewing, for one year or for the whole career.
 *
 * Real viewing time comes from the sessions; story completions come from the
 * races, dated by when the story finished. XP is deliberately not here — it has
 * its own series in `getXpHistory`, keyed by the same `YYYY-MM` so a chart can
 * put the two side by side without either engine guessing at the other.
 */
export async function getMonthlyBreakdown(userId: string, year?: number): Promise<MonthlyStat[]> {
  const window = year === undefined ? null : yearWindow(year);

  const [buckets, storyRaces] = await Promise.all([
    loadActivityBuckets({
      userId,
      ...(window === null ? {} : { watchedAt: { gte: window.start, lt: window.end } }),
    }),
    prisma.race.findMany({
      where: {
        userId,
        storyCompletedAt: window === null ? { not: null } : { gte: window.start, lt: window.end },
      },
      select: { storyCompletedAt: true },
    }),
  ]);

  const storyByMonth = new Map<string, number>();
  for (const race of storyRaces) {
    const at = race.storyCompletedAt;
    if (at === null) continue;
    const key = localDayKey(at).slice(0, 7);
    storyByMonth.set(key, (storyByMonth.get(key) ?? 0) + 1);
  }

  return buildMonthlyStats(buckets, storyByMonth, window);
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
 * scopes somebody defined by adding a championship or an event.
 */
async function loadMasteryTotals(userId: string): Promise<MasteryTotals> {
  const trees = await prisma.masteryTree.findMany({
    where: { userId },
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
  const [scope, mastery] = await Promise.all([loadScope(userId, filter), loadMasteryTotals(userId)]);
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
 * row precisely so that re-balancing this year cannot rewrite it.
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
 * Every figure the statistics page shows, for one scope.
 *
 * This is the only place the pieces are assembled, so the numbers on one page
 * are always mutually consistent: one load of the scope feeds the totals, the
 * breakdowns and the calendar alike, and nothing is counted twice by two
 * different queries that happened to run a second apart.
 *
 * Three of the series ignore the filter, because they are career-long by
 * nature and would be meaningless narrowed to a circuit: the level ladder, the
 * annual budget history and the challenge record. The XP series does follow a
 * year filter, since a year of XP is a perfectly sensible question.
 */
export async function getStatistics(
  userId: string,
  filter: StatsFilter = {},
): Promise<StatisticsView> {
  const now = new Date();
  const scope = await loadScope(userId, filter);
  const xpWindow = scope.window ?? defaultXpWindow(now, STATS_CONFIG.xpHistoryDefaultMonths);

  const [
    longestSessionRow,
    achievementsUnlocked,
    mastery,
    seasonPasses,
    challenges,
    xpHistory,
    levelHistory,
    budgetHistory,
    profile,
    eventNameRows,
    season,
  ] = await Promise.all([
    prisma.raceViewingSession.findFirst({
      where: buildSessionScopeWhere(userId, filter),
      orderBy: { realSeconds: 'desc' },
      select: {
        raceId: true, watchedAt: true, realSeconds: true, timelineSeconds: true,
        playbackSpeed: true, race: { select: { name: true } },
      },
    }),
    prisma.achievementProgress.count({ where: { userId, unlockedAt: { not: null } } }),
    loadMasteryTotals(userId),
    getSeasonPassStats(userId),
    getChallengeStats(userId),
    monthlyXpSeries(userId, xpWindow.start, xpWindow.end),
    getLevelHistory(userId),
    getBudgetHistory(userId),
    prisma.careerProfile.findUnique({
      where: { userId },
      select: { careerXp: true, level: true, prestige: true },
    }),
    prisma.raceMastery.findMany({ where: { userId }, select: { key: true, name: true } }),
    filter.seasonId === undefined
      ? Promise.resolve(null)
      // Scoped through the championship, which is where a season's ownership
      // lives: this id is the raw `?season=` query parameter, so an unscoped
      // read would put another career's season in this one's header.
      : prisma.championshipSeason.findFirst({
          where: { id: filter.seasonId, championship: { userId } },
          select: { year: true, label: true, championship: { select: { name: true } } },
        }),
  ]);

  const storyCompletions = storyCompletionsByPeriod(scope);
  const monthly = buildMonthlyStats(scope.buckets, storyCompletions.months, scope.window);
  const years = buildYearStats(scope.buckets, storyCompletions.years);

  // Unique coverage is a per-race figure and is summed from the races in scope,
  // never from the sessions: a re-watched hour appears twice in the session
  // history and exactly once here, which is the whole point of the distinction.
  const uniqueCoverageSeconds = scope.races.reduce(
    (sum, race) => sum + Math.min(race.coverageSec, race.runtimeSec),
    0,
  );

  const races = buildRaceTotals(scope);
  const championshipName = filter.championshipId === undefined
    ? null
    : scope.championships.find((row) => row.id === filter.championshipId)?.name ?? null;
  const circuitName = filter.circuitSlug === undefined
    ? null
    : scope.races.find((race) => race.circuitSlug === filter.circuitSlug)?.circuit ?? filter.circuitSlug;
  const seasonName = season === null
    ? null
    : season.label ?? `${season.championship.name} ${season.year}`;

  const scopeLabel = describeScope(filter, {
    championship: championshipName,
    season: seasonName,
    circuit: circuitName,
  });

  const careerXp = profile === null ? 0 : Number(profile.careerXp);
  const levelState = levelFromXp(careerXp);

  return {
    generatedAt: now,
    filter,
    scopeLabel,

    viewing: buildViewingTotals(scope, uniqueCoverageSeconds),
    races,
    sessions: buildSessionTotals(
      scope,
      longestSessionRow === null
        ? null
        : {
            raceId: longestSessionRow.raceId,
            raceName: longestSessionRow.race.name,
            watchedAt: longestSessionRow.watchedAt,
            realSeconds: longestSessionRow.realSeconds,
            timelineSeconds: longestSessionRow.timelineSeconds,
            playbackSpeed: longestSessionRow.playbackSpeed,
          },
    ),
    cadence: buildCadence(scope, monthly, years, now),
    favourites: buildFavourites(scope, new Map(eventNameRows.map((row) => [row.key, row.name]))),

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
      library: {
        scope: scopeLabel,
        percent: races.completionPercent,
        done: races.racesCompleted,
        total: races.racesInScope,
      },
      storyLibrary: {
        scope: scopeLabel,
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
