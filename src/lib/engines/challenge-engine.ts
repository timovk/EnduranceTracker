/**
 * The challenge system.
 *
 * Challenges are the one part of this application that could most easily turn
 * into a chore, so the rules here are deliberately strict:
 *
 *  * A challenge is GENERATED FROM THE LIBRARY THE USER ACTUALLY HAS. Every
 *    template declares an eligibility predicate over a `LibrarySnapshot` and
 *    derives its target from what is really there, clamped by
 *    `CHALLENGE_CONFIG.feasibility`. "Complete races from three championships"
 *    is not offered unless three championships hold unfinished races that could
 *    plausibly be finished inside the period. Nothing impossible is ever shown.
 *
 *  * A challenge is OPTIONAL. There are three states — ACTIVE, COMPLETED and
 *    EXPIRED — and EXPIRED is neutral information, nothing more. Letting a
 *    window close costs no XP, no level, no statistic and no collection item.
 *    See `EXPIRED_CHALLENGE_NOTE` in `@/lib/copy/tone`.
 *
 *  * Progress is RECOMPUTED FROM THE SOURCE DATA — `RaceViewingSession` rows and
 *    `Race.storyCompletedAt` — rather than incremented by a counter. That makes
 *    re-running the engine free of consequence, which is what lets the session
 *    engine call it inside every transaction without bookkeeping.
 *
 *  * Real viewing time and race-timeline time are different quantities and are
 *    never mixed. `REAL_MINUTES` is wall-clock time in front of the screen;
 *    `TIMELINE_MINUTES` is time played on the race clock. A challenge measured
 *    in one is rationed against the library's supply of that same one.
 *
 * Generation is idempotent: `(userId, scope, templateKey, periodStart)` is
 * unique in the database, and which eligible templates are used is decided by a
 * small hash-based PRNG seeded from the period. `Math.random` is not used
 * anywhere in this file, because a board that reshuffled on every page load
 * would be a different board every time it was written.
 */

import type { Challenge } from '@/generated/prisma/client';
import type { Tx } from '@/lib/db/client';
import { createManySkippingDuplicates, prisma } from '@/lib/db/client';
import { CHALLENGE_CONFIG, CHALLENGE_NOMINALS, CHALLENGE_SHAPE } from '@/lib/config';
import { EXPIRED_CHALLENGE_NOTE } from '@/lib/copy/tone';
import { periodForScope, type Period } from '@/lib/domain/periods';
import { averagePlaybackSpeed, clampSpeed } from '@/lib/domain/playback';
import { formatDuration } from '@/lib/domain/time';
import type { ChallengeScope, ChallengeState } from '@/lib/domain/types';
import type { ChallengeCompletion } from './contracts';
import { awardXp } from './xp-ledger';

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Everything a challenge can measure.
 *
 * Each one is evaluated over the challenge's own `[periodStart, periodEnd)`
 * window from raw session rows and race completion timestamps, so the same
 * window always produces the same number however many times it is asked for.
 */
export type ChallengeMetric =
  /** Wall-clock minutes in front of the screen. Re-watching counts. */
  | 'REAL_MINUTES'
  /** Minutes played on the race clock. Re-watching counts here too. */
  | 'TIMELINE_MINUTES'
  /** Stints logged. */
  | 'SESSION_COUNT'
  /** Races that gained timeline they had never had before. */
  | 'DISTINCT_RACES_PROGRESSED'
  /** Races whose story was completed inside the window. */
  | 'STORY_COMPLETES'
  /** Progress on a race whose first stint predates the window. */
  | 'RACES_RESUMED'
  /** Championships with at least one story completed inside the window. */
  | 'DISTINCT_CHAMPIONSHIPS_STORIED'
  /** Largest single race's new coverage in the window, as a percentage. */
  | 'SINGLE_RACE_PROGRESS_PERCENT'
  /** Story completes restricted to races of at least `params.minRuntimeSec`. */
  | 'LONG_RACE_STORY_COMPLETE'
  /** Championship seasons that became complete inside the window. */
  | 'SEASON_COMPLETED'
  /** Distinct local calendar days with at least one stint. */
  | 'DISTINCT_DAYS_ACTIVE';

const CHALLENGE_METRICS: readonly ChallengeMetric[] = [
  'REAL_MINUTES', 'TIMELINE_MINUTES', 'SESSION_COUNT', 'DISTINCT_RACES_PROGRESSED',
  'STORY_COMPLETES', 'RACES_RESUMED', 'DISTINCT_CHAMPIONSHIPS_STORIED',
  'SINGLE_RACE_PROGRESS_PERCENT', 'LONG_RACE_STORY_COMPLETE', 'SEASON_COMPLETED',
  'DISTINCT_DAYS_ACTIVE',
];

/**
 * Template-specific narrowing, stored as JSON on the challenge row.
 *
 * Declared as a type alias rather than an interface on purpose: only a type
 * alias picks up the implicit index signature Prisma's `InputJsonValue` wants,
 * and these values go straight into a JSON column.
 *
 * The key names are shared with the Race Strategist, which reads them to decide
 * whether a race would serve an open objective. Neither engine imports the
 * other; the JSON shape is the whole of the contract between them.
 */
export type ChallengeParams = {
  /** Confine the challenge to particular races. */
  raceIds?: string[];
  championshipIds?: string[];
  seasonIds?: string[];
  /** Only races at least this long count. */
  minRuntimeSec?: number;
  /** Only races the user tagged as a major event count. */
  majorEventOnly?: boolean;
  /** For `SINGLE_RACE_PROGRESS_PERCENT`, the percentage asked for. */
  percent?: number;
};

const SCOPES: readonly ChallengeScope[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'SEASONAL'];

/** Display order for a board that shows every scope at once. */
const SCOPE_ORDER: Readonly<Record<ChallengeScope, number>> = {
  DAILY: 0, WEEKLY: 1, MONTHLY: 2, SEASONAL: 3,
};

// ---------------------------------------------------------------------------
// The library, as the generator sees it
// ---------------------------------------------------------------------------

/**
 * One race, reduced to what generation needs.
 *
 * Deliberately plain data with no Prisma types in it, so the whole generator is
 * pure and can be tested against a hand-written library.
 */
export interface LibraryRace {
  id: string;
  name: string;
  championshipId: string | null;
  championshipName: string | null;
  seasonId: string | null;
  runtimeSec: number;
  /** Unique timeline seconds already covered. Not a high-water mark. */
  coverageSec: number;
  isMajorEvent: boolean;
  storyComplete: boolean;
  /** Some of the timeline has been watched, so the race can be resumed. */
  started: boolean;
  /**
   * Abandoned and archived races are out of play. They are never held against
   * the user; they simply stop being material a challenge can be built from.
   */
  setAside: boolean;
}

/** One championship season, reduced to what the season templates need. */
export interface LibrarySeason {
  id: string;
  label: string;
  championshipId: string;
  /** Races the user declared the season to hold, or however many are filed. */
  target: number;
  completedCount: number;
  remainingRaceCount: number;
  /** Real minutes still needed to finish the rest of it, at the usual speed. */
  remainingRealMinutes: number;
  /**
   * False when the user has declared more races than they have filed: the
   * season cannot be completed from the library as it stands, so no challenge
   * may ask for it.
   */
  completable: boolean;
}

export interface LibraryChampionship {
  id: string;
  name: string;
}

/**
 * Everything the generator is allowed to know.
 *
 * Both halves of the pace anchor are recent history rather than lifetime
 * figures: a challenge should reflect the shape of someone's viewing now, not
 * the shape of it two years ago.
 */
export interface LibrarySnapshot {
  races: readonly LibraryRace[];
  seasons: readonly LibrarySeason[];
  championships: readonly LibraryChampionship[];
  /** Weighted average playback speed, for turning timeline into real time. */
  playbackSpeed: number;
  /** Real minutes watched per day recently. Zero for a brand-new career. */
  paceRealMinutesPerDay: number;
  /** Stints logged per day recently. Zero for a brand-new career. */
  paceSessionsPerDay: number;
}

/** An empty library. Exported so tests and the seed script can start from it. */
export function emptyLibrary(): LibrarySnapshot {
  return {
    races: [],
    seasons: [],
    championships: [],
    playbackSpeed: 1,
    paceRealMinutesPerDay: 0,
    paceSessionsPerDay: 0,
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type ChallengeEffort = keyof typeof CHALLENGE_SHAPE.effortTiers;
export type ChallengeSelectionWeight = keyof typeof CHALLENGE_SHAPE.selectionWeights;

/** Everything a template is given when it is asked whether it fits. */
export interface TemplateContext {
  scope: ChallengeScope;
  library: LibrarySnapshot;
  period: Period;
  /** Days the period spans. A month is not a week. */
  periodDays: number;
  /** The most real minutes a target of this scope may ever ask for. */
  capacityMinutes: number;
  /**
   * Real minutes of racing this period can plausibly hold, after
   * `feasibility.storyCompleteSafetyMargin`. Every "could they actually do
   * this?" question in this file is answered against this figure.
   */
  budgetMinutes: number;
}

/** What a template produces once the library has had its say. */
export interface BuiltChallenge {
  title: string;
  description: string;
  target: number;
  /** The nominal ask this target came from, which is what scales the reward. */
  nominal: number;
  params: ChallengeParams;
}

export interface ChallengeTemplate {
  key: string;
  scope: ChallengeScope;
  metric: ChallengeMetric;
  weight: ChallengeSelectionWeight;
  effort: ChallengeEffort;
  /** Can the library support this challenge at all? */
  isEligible(ctx: TemplateContext): boolean;
  /** The challenge itself, or null if it collapses once the numbers are run. */
  build(ctx: TemplateContext): BuiltChallenge | null;
}

/** A challenge as generated, before it has ever touched the database. */
export interface GeneratedChallenge {
  templateKey: string;
  scope: ChallengeScope;
  metric: ChallengeMetric;
  title: string;
  description: string;
  target: number;
  params: ChallengeParams;
  xpReward: number;
  seasonXpReward: number;
  periodStart: Date;
  periodEnd: Date;
}

/** A challenge as the board renders it: live progress and time remaining. */
export interface ChallengeView {
  id: string;
  scope: ChallengeScope;
  templateKey: string;
  title: string;
  description: string;
  metric: ChallengeMetric | null;
  target: number;
  /** Recomputed from source data every time this is called, never cached. */
  value: number;
  /** 0-1, clamped, for the progress bar. */
  progress: number;
  state: ChallengeState;
  xpReward: number;
  seasonXpReward: number;
  periodStart: Date;
  periodEnd: Date;
  /** Milliseconds until the window closes. Zero once it has. */
  msRemaining: number;
  /** Neutral phrasing of the above. Never urgent, never a countdown to loss. */
  remainingLabel: string;
  completedAt: Date | null;
  /** Set only once a window has closed, and never a reprimand. */
  note: string | null;
}

// ---------------------------------------------------------------------------
// Deterministic selection
// ---------------------------------------------------------------------------

/**
 * A stable unit value in [0, 1) for a `(seed, key)` pair.
 *
 * `Math.random` is banned in this file. The set of challenges a period offers
 * has to be the same every time it is computed, or `ensureChallenges` would
 * write a different board on every call and the unique key would quietly
 * accumulate challenges instead of preventing them.
 *
 * Hashing the key rather than drawing from a stream matters just as much: the
 * result then does not depend on how many other templates happened to be
 * eligible, so adding a race to the library cannot reshuffle the challenges
 * already on the board.
 *
 * The hash is xmur3 followed by one mulberry32 step — small, fast, and stable
 * across platforms because every operation is 32-bit integer arithmetic.
 */
export function deterministicUnit(seed: string, key: string): number {
  const input = `${seed}::${key}`;
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);

  let t = ((h ^ (h >>> 16)) >>> 0) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Reading the library (pure)
// ---------------------------------------------------------------------------

/** Races still in play: not abandoned, not archived. */
export function inPlayRaces(library: LibrarySnapshot, filter?: RaceFilter): LibraryRace[] {
  return library.races.filter((race) => !race.setAside && (filter === undefined || filter(race)));
}

/** Races with story left to watch. The raw material of most templates. */
export function openRaces(library: LibrarySnapshot, filter?: RaceFilter): LibraryRace[] {
  return inPlayRaces(library, filter).filter(
    (race) => !race.storyComplete && race.runtimeSec > race.coverageSec,
  );
}

/**
 * Real minutes still needed to finish a race's story at the usual speed.
 *
 * Timeline seconds divided by playback speed — the one conversion between the
 * two quantities, kept in a single named place so it can never be done by
 * accident somewhere else.
 */
export function realMinutesToFinish(race: LibraryRace, playbackSpeed: number): number {
  const timelineRemaining = Math.max(0, race.runtimeSec - race.coverageSec);
  return timelineRemaining / clampSpeed(playbackSpeed) / 60;
}

/**
 * How many of these costs fit inside a budget, cheapest first.
 *
 * Cheapest-first is the right greedy order for "how many could they plausibly
 * finish": it is the arrangement that maximises the count, and a target derived
 * from the maximum is then clamped down again by the share rules. Erring high
 * here and low afterwards is safer than the other way round.
 */
function greedyFit(costs: readonly number[], budgetMinutes: number): number {
  const sorted = [...costs].sort((a, b) => a - b);
  let spent = 0;
  let fitted = 0;
  for (const cost of sorted) {
    if (!Number.isFinite(cost) || spent + cost > budgetMinutes) break;
    spent += cost;
    fitted += 1;
  }
  return fitted;
}

/** Story completions the period could plausibly hold, from real races. */
export function feasibleStoryCompletes(ctx: TemplateContext, filter?: RaceFilter): number {
  const costs = openRaces(ctx.library, filter).map((race) =>
    realMinutesToFinish(race, ctx.library.playbackSpeed),
  );
  return greedyFit(costs, ctx.budgetMinutes);
}

/**
 * Championships that could each contribute a finished story inside the period.
 *
 * Only the cheapest outstanding race of each championship is considered — one
 * finished story is all a championship needs to count — and those are then
 * fitted against the period's budget together, so "races from five
 * championships" is only offered when five of them really would fit.
 */
export function feasibleChampionshipsStoried(ctx: TemplateContext, filter?: RaceFilter): number {
  const cheapest = new Map<string, number>();
  for (const race of openRaces(ctx.library, filter)) {
    if (race.championshipId === null) continue;
    const cost = realMinutesToFinish(race, ctx.library.playbackSpeed);
    const current = cheapest.get(race.championshipId);
    if (current === undefined || cost < current) cheapest.set(race.championshipId, cost);
  }
  return greedyFit([...cheapest.values()], ctx.budgetMinutes);
}

/** Seasons that could be finished off inside the period. */
export function feasibleSeasonCompletions(ctx: TemplateContext): number {
  const costs = ctx.library.seasons
    .filter((season) => season.completable && season.remainingRaceCount > 0)
    .map((season) => season.remainingRealMinutes);
  return greedyFit(costs, ctx.budgetMinutes);
}

/**
 * How many separate races could be touched in the period.
 *
 * Bounded both by how many are available and by how many meaningful stints fit
 * in the budget, so a library of forty unfinished races does not produce a
 * daily challenge asking for forty of them.
 */
function feasibleTouches(ctx: TemplateContext, available: number): number {
  const stints = Math.floor(ctx.budgetMinutes / CHALLENGE_SHAPE.minTimeMinutes);
  return Math.max(0, Math.min(available, stints));
}

/**
 * Whether one race really could be moved forward by `percent` of its runtime.
 *
 * Both halves matter: the race must still have that much timeline unwatched,
 * and covering it must fit inside the period's budget once playback speed is
 * taken into account.
 */
export function feasibleSingleRaceProgress(ctx: TemplateContext, percent: number): boolean {
  const fraction = percent / 100;
  return openRaces(ctx.library).some((race) => {
    const uncovered = race.runtimeSec - race.coverageSec;
    if (uncovered < race.runtimeSec * fraction) return false;
    const realMinutes = (race.runtimeSec * fraction) / clampSpeed(ctx.library.playbackSpeed) / 60;
    return realMinutes <= ctx.budgetMinutes;
  });
}

/**
 * Minutes of viewing the library can actually supply, in the metric's own unit.
 *
 * Timeline minutes and real minutes are different quantities, so the conversion
 * happens once, here, and only for `REAL_MINUTES`. The re-watch floor is what
 * keeps a fully-completed library from having nothing to offer: re-watching is
 * a perfectly good way to spend an evening, and the application should say so.
 */
export function availableMinutes(
  ctx: TemplateContext,
  metric: 'REAL_MINUTES' | 'TIMELINE_MINUTES',
  filter?: RaceFilter,
): number {
  let outstandingTimelineSec = 0;
  let totalTimelineSec = 0;
  for (const race of inPlayRaces(ctx.library, filter)) {
    totalTimelineSec += race.runtimeSec;
    outstandingTimelineSec += Math.max(0, race.runtimeSec - race.coverageSec);
  }

  const timelineSec = Math.max(
    outstandingTimelineSec,
    totalTimelineSec * CHALLENGE_SHAPE.rewatchAvailabilityShare,
  );
  const seconds = metric === 'TIMELINE_MINUTES' ? timelineSec : timelineSec / clampSpeed(ctx.library.playbackSpeed);
  return seconds / 60;
}

// ---------------------------------------------------------------------------
// Turning a nominal ask into a real target
// ---------------------------------------------------------------------------

/** The scope's ceiling on a real-minutes target, straight from configuration. */
export function capacityMinutesFor(scope: ChallengeScope): number {
  const feasibility = CHALLENGE_CONFIG.feasibility;
  switch (scope) {
    case 'DAILY':
      return feasibility.maxDailyMinutes;
    case 'WEEKLY':
      return feasibility.maxWeeklyMinutes;
    case 'MONTHLY':
      return feasibility.maxMonthlyMinutes;
    case 'SEASONAL':
      return feasibility.maxSeasonalMinutes;
  }
}

/** Assemble the context every template is judged against. */
export function templateContext(
  scope: ChallengeScope,
  library: LibrarySnapshot,
  period: Period,
): TemplateContext {
  const capacityMinutes = capacityMinutesFor(scope);
  return {
    scope,
    library,
    period,
    periodDays: Math.max(1, (period.end.getTime() - period.start.getTime()) / 86_400_000),
    capacityMinutes,
    budgetMinutes: capacityMinutes * CHALLENGE_CONFIG.feasibility.storyCompleteSafetyMargin,
  };
}

/**
 * A time target, in the metric's own minutes.
 *
 * The nominal ask is a share of the scope's ceiling. Someone who already
 * watches more than that in a period of this length has the target follow them
 * up — `paceStretch` keeps it just inside their habit rather than just beyond
 * it — and the library then has the final word: nothing may ask for more
 * viewing than the library can supply. Returns null when even the floor would
 * not fit, which is how a template removes itself.
 */
export function deriveTimeTarget(
  ctx: TemplateContext,
  nominalMinutes: number,
  availableForMetric: number,
): number | null {
  const paceMinutes =
    ctx.library.paceRealMinutesPerDay * ctx.periodDays * CHALLENGE_SHAPE.paceStretch;
  const wanted = Math.max(nominalMinutes, paceMinutes);

  const ceiling = Math.min(
    ctx.capacityMinutes,
    availableForMetric * CHALLENGE_SHAPE.maxLibraryShare[ctx.scope],
  );
  if (ceiling < CHALLENGE_SHAPE.minTimeMinutes) return null;

  const step = CHALLENGE_SHAPE.timeRoundingMinutes;
  let rounded = Math.round(Math.min(wanted, ceiling) / step) * step;
  if (rounded > ceiling) rounded = Math.floor(ceiling / step) * step;
  return Math.max(rounded, CHALLENGE_SHAPE.minTimeMinutes);
}

/**
 * A counting target.
 *
 * Never below one, never above what the library can supply, and never above the
 * scope's hard cap. Between those rails it rises with the library: where far
 * more is feasible than the nominal ask, the target moves towards a share of
 * what is feasible, and the reward moves with it.
 */
export function deriveCountTarget(
  ctx: TemplateContext,
  nominal: number,
  feasible: number,
  share: keyof typeof CHALLENGE_SHAPE.countShare,
  stretch: boolean,
): number | null {
  const available = Math.floor(feasible);
  if (available < 1) return null;

  const stretched = stretch ? Math.floor(available * CHALLENGE_SHAPE.countShare[share]) : 0;
  const ceiling = Math.min(available, CHALLENGE_SHAPE.maxCountTarget[ctx.scope]);
  return Math.max(1, Math.min(Math.max(nominal, stretched), ceiling));
}

/**
 * What a challenge pays.
 *
 * The scope's baseline reward, moved by how the template stands against that
 * baseline and by how far the derived target ended up from its nominal ask, then
 * bounded so a generous library can never turn a daily into a jackpot. There is
 * no path through this function that returns a negative number.
 */
export function rewardFor(
  scope: ChallengeScope,
  effort: ChallengeEffort,
  target: number,
  nominal: number,
): { xpReward: number; seasonXpReward: number } {
  const base = CHALLENGE_CONFIG.rewards[scope];
  const difficulty = nominal > 0 ? target / nominal : 1;
  const raw = CHALLENGE_SHAPE.effortTiers[effort] * difficulty;
  const multiplier = Math.min(
    CHALLENGE_SHAPE.rewardScale.max,
    Math.max(CHALLENGE_SHAPE.rewardScale.min, raw),
  );
  return {
    xpReward: Math.max(0, Math.round(base.careerXp * multiplier)),
    seasonXpReward: Math.max(0, Math.round(base.seasonXp * multiplier)),
  };
}

/** Durations in prose: `30m`, `4h 00m`, `20h 00m`. */
function minutesLabel(minutes: number): string {
  return formatDuration(Math.round(minutes) * 60);
}

// ---------------------------------------------------------------------------
// Template factories
//
// Every template is one of three shapes, so the shapes are written once and the
// declarations below stay readable. Each factory is responsible for the whole
// of "can the library support this?", which is why `isEligible` and `build`
// both go through the same feasibility helpers.
// ---------------------------------------------------------------------------

export type RaceFilter = (race: LibraryRace) => boolean;

/** A narrowing a template applies: a championship, a season, a length of race. */
export interface TemplateFocus {
  /** How the focus is named in the challenge's own description. */
  label: string;
  /** Stored on the row, and read by the Race Strategist. */
  params: ChallengeParams;
  /** The same narrowing, as a predicate, for feasibility work. */
  filter: RaceFilter;
}

interface TimeTemplateSpec {
  key: string;
  scope: ChallengeScope;
  metric: 'REAL_MINUTES' | 'TIMELINE_MINUTES';
  share: keyof typeof CHALLENGE_SHAPE.timeShare;
  effort: ChallengeEffort;
  weight: ChallengeSelectionWeight;
  title: string;
  focus?: (ctx: TemplateContext) => TemplateFocus | null;
  describe: (amount: string, focus: TemplateFocus | null) => string;
}

/**
 * A "spend this much time" template.
 *
 * The nominal ask is a share of the scope's ceiling; the library decides
 * whether that much viewing exists, in the metric's own unit.
 */
function timeTemplate(spec: TimeTemplateSpec): ChallengeTemplate {
  const resolve = (ctx: TemplateContext): { focus: TemplateFocus | null; target: number } | null => {
    const focus = spec.focus === undefined ? null : spec.focus(ctx);
    if (spec.focus !== undefined && focus === null) return null;

    const nominal = ctx.capacityMinutes * CHALLENGE_SHAPE.timeShare[spec.share];
    const available = availableMinutes(ctx, spec.metric, focus?.filter);
    const target = deriveTimeTarget(ctx, nominal, available);
    return target === null ? null : { focus, target };
  };

  return {
    key: spec.key,
    scope: spec.scope,
    metric: spec.metric,
    weight: spec.weight,
    effort: spec.effort,
    isEligible: (ctx) => resolve(ctx) !== null,
    build: (ctx) => {
      const resolved = resolve(ctx);
      if (resolved === null) return null;
      return {
        title: spec.title,
        description: spec.describe(minutesLabel(resolved.target), resolved.focus),
        target: resolved.target,
        nominal: ctx.capacityMinutes * CHALLENGE_SHAPE.timeShare[spec.share],
        params: resolved.focus?.params ?? {},
      };
    },
  };
}

interface CountTemplateSpec {
  key: string;
  scope: ChallengeScope;
  metric: ChallengeMetric;
  /** The nominal ask, read from `CHALLENGE_NOMINALS` or derived from the period. */
  nominal: (ctx: TemplateContext) => number;
  /** How many of this thing the period could plausibly hold. */
  feasible: (ctx: TemplateContext, focus: TemplateFocus | null) => number;
  share: keyof typeof CHALLENGE_SHAPE.countShare;
  /**
   * False for templates whose nominal ask is already the right size — a single
   * stint, a handful of days — so a large library cannot inflate them.
   */
  stretch?: boolean;
  effort: ChallengeEffort;
  weight: ChallengeSelectionWeight;
  title: string;
  focus?: (ctx: TemplateContext) => TemplateFocus | null;
  describe: (target: number, focus: TemplateFocus | null) => string;
}

/** A "do this many of these" template. */
function countTemplate(spec: CountTemplateSpec): ChallengeTemplate {
  const resolve = (ctx: TemplateContext): { focus: TemplateFocus | null; target: number } | null => {
    const focus = spec.focus === undefined ? null : spec.focus(ctx);
    if (spec.focus !== undefined && focus === null) return null;

    const target = deriveCountTarget(
      ctx,
      spec.nominal(ctx),
      spec.feasible(ctx, focus),
      spec.share,
      spec.stretch ?? true,
    );
    return target === null ? null : { focus, target };
  };

  return {
    key: spec.key,
    scope: spec.scope,
    metric: spec.metric,
    weight: spec.weight,
    effort: spec.effort,
    isEligible: (ctx) => resolve(ctx) !== null,
    build: (ctx) => {
      const resolved = resolve(ctx);
      if (resolved === null) return null;
      return {
        title: spec.title,
        description: spec.describe(resolved.target, resolved.focus),
        target: resolved.target,
        nominal: Math.max(1, spec.nominal(ctx)),
        params: resolved.focus?.params ?? {},
      };
    },
  };
}

interface ProgressTemplateSpec {
  key: string;
  scope: ChallengeScope;
  percent: number;
  effort: ChallengeEffort;
  weight: ChallengeSelectionWeight;
  title: string;
  describe: (percent: number) => string;
}

/**
 * A "move one race this far forward" template.
 *
 * Its own shape because the target is a percentage of a single race rather than
 * a quantity of anything, and because feasibility is a yes-or-no question: some
 * race in the library must have that much story left AND fit the period.
 */
function progressTemplate(spec: ProgressTemplateSpec): ChallengeTemplate {
  return {
    key: spec.key,
    scope: spec.scope,
    metric: 'SINGLE_RACE_PROGRESS_PERCENT',
    weight: spec.weight,
    effort: spec.effort,
    isEligible: (ctx) => feasibleSingleRaceProgress(ctx, spec.percent),
    build: (ctx) => {
      if (!feasibleSingleRaceProgress(ctx, spec.percent)) return null;
      return {
        title: spec.title,
        description: spec.describe(spec.percent),
        target: spec.percent,
        nominal: spec.percent,
        params: { percent: spec.percent },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Focuses
// ---------------------------------------------------------------------------

/** The library's major events, when it holds any that are unfinished. */
function majorEventFocus(ctx: TemplateContext): TemplateFocus | null {
  const filter: RaceFilter = (race) => race.isMajorEvent;
  if (openRaces(ctx.library, filter).length === 0) return null;
  return { label: 'a major event', params: { majorEventOnly: true }, filter };
}

/**
 * The championship with the most racing still outstanding in it.
 *
 * Chosen from the library rather than from the PRNG so that a focused challenge
 * points at whatever the user has most of, and so the choice is stable for as
 * long as the library is.
 */
function busiestChampionshipFocus(ctx: TemplateContext): TemplateFocus | null {
  const outstanding = new Map<string, number>();
  for (const race of openRaces(ctx.library)) {
    if (race.championshipId === null) continue;
    const minutes = realMinutesToFinish(race, ctx.library.playbackSpeed);
    outstanding.set(race.championshipId, (outstanding.get(race.championshipId) ?? 0) + minutes);
  }

  let bestId: string | null = null;
  let bestMinutes = -1;
  // Sorted by id first so a tie always resolves the same way.
  for (const [id, minutes] of [...outstanding.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (minutes > bestMinutes) {
      bestMinutes = minutes;
      bestId = id;
    }
  }
  if (bestId === null) return null;

  const focusId = bestId;
  const named =
    ctx.library.championships.find((championship) => championship.id === focusId)?.name ??
    openRaces(ctx.library).find((race) => race.championshipId === focusId)?.championshipName ??
    'one championship';

  return {
    label: named,
    params: { championshipIds: [focusId] },
    filter: (race) => race.championshipId === focusId,
  };
}

/** Races of at least `hours`, when the library holds unfinished ones. */
function longRaceFocus(hours: number): (ctx: TemplateContext) => TemplateFocus | null {
  const minRuntimeSec = Math.round(hours * 3600);
  const filter: RaceFilter = (race) => race.runtimeSec >= minRuntimeSec;
  return (ctx) => {
    if (openRaces(ctx.library, filter).length === 0) return null;
    return { label: `${hours} hours or more`, params: { minRuntimeSec }, filter };
  };
}

/** The season closest to being finished, which is the kindest one to point at. */
function nearestSeasonFocus(ctx: TemplateContext): TemplateFocus | null {
  const candidates = ctx.library.seasons
    .filter((season) => season.completable && season.remainingRaceCount > 0)
    .sort((a, b) => a.remainingRealMinutes - b.remainingRealMinutes || a.id.localeCompare(b.id));

  const season = candidates[0];
  if (season === undefined) return null;
  return {
    label: season.label,
    params: { seasonIds: [season.id] },
    filter: (race) => race.seasonId === season.id,
  };
}

/** Is there anything at all to watch? The floor under every template. */
function hasSomethingToWatch(ctx: TemplateContext): boolean {
  return availableMinutes(ctx, 'REAL_MINUTES') > 0;
}

/**
 * Stints the period could plausibly hold.
 *
 * Bounded three ways: by the period's budget at a minimum stint apiece, by the
 * scope's hard cap, and — for someone who has been watching recently — by how
 * many stints they actually log in a period this long. The third bound only
 * ever lowers the figure, so a quiet fortnight makes the next board gentler and
 * never the reverse.
 */
function feasibleSessions(ctx: TemplateContext): number {
  if (!hasSomethingToWatch(ctx)) return 0;
  const fromBudget = feasibleTouches(ctx, CHALLENGE_SHAPE.maxCountTarget[ctx.scope]);
  const fromHabit = Math.ceil(
    ctx.library.paceSessionsPerDay * ctx.periodDays * CHALLENGE_SHAPE.paceStretch,
  );
  return fromHabit > 0 ? Math.min(fromBudget, fromHabit) : fromBudget;
}

// ---------------------------------------------------------------------------
// The templates
//
// Thirty-three of them across four scopes, so that a board is drawn from a pool
// several times its own size and two consecutive weeks rarely look alike. Every
// number in here is read from `@/lib/config`; the declarations carry the voice,
// the configuration carries the balance.
//
// A template that the library cannot support is simply absent. That is the
// whole anti-impossibility mechanism: there is no "sorry, you cannot do this"
// state because an undoable challenge is never generated in the first place.
// ---------------------------------------------------------------------------

export const CHALLENGE_TEMPLATES: readonly ChallengeTemplate[] = [
  // -- Daily ---------------------------------------------------------------
  timeTemplate({
    key: 'daily_real_minutes',
    scope: 'DAILY',
    metric: 'REAL_MINUTES',
    share: 'gentle',
    effort: 'baseline',
    weight: 'common',
    title: 'Today’s Stint',
    describe: (amount) => `Spend ${amount} with a race today.`,
  }),
  timeTemplate({
    key: 'daily_timeline_minutes',
    scope: 'DAILY',
    metric: 'TIMELINE_MINUTES',
    share: 'gentle',
    effort: 'light',
    weight: 'standard',
    title: 'Ground Covered',
    describe: (amount) => `Move ${amount} along a race clock today. Played at any speed you like.`,
  }),
  countTemplate({
    key: 'daily_resume_race',
    scope: 'DAILY',
    metric: 'RACES_RESUMED',
    nominal: () => CHALLENGE_NOMINALS.daily.resumedRaces,
    feasible: (ctx) => feasibleTouches(ctx, openRaces(ctx.library).filter((race) => race.started).length),
    share: 'gentle',
    stretch: false,
    effort: 'baseline',
    weight: 'common',
    title: 'Pick It Back Up',
    describe: (target) =>
      target === 1
        ? 'Add something to a race you had already started.'
        : `Add something to ${target} races you had already started.`,
  }),
  countTemplate({
    key: 'daily_two_races',
    scope: 'DAILY',
    metric: 'DISTINCT_RACES_PROGRESSED',
    nominal: () => CHALLENGE_NOMINALS.daily.distinctRaces,
    feasible: (ctx) => feasibleTouches(ctx, openRaces(ctx.library).length),
    share: 'gentle',
    stretch: false,
    effort: 'baseline',
    weight: 'standard',
    title: 'Two Stories Moving',
    describe: (target) => `Make progress in ${target} separate races today.`,
  }),
  countTemplate({
    key: 'daily_one_session',
    scope: 'DAILY',
    metric: 'SESSION_COUNT',
    nominal: () => CHALLENGE_NOMINALS.daily.sessions,
    feasible: (ctx) => feasibleSessions(ctx),
    share: 'gentle',
    stretch: false,
    effort: 'light',
    weight: 'standard',
    title: 'Lights Out',
    describe: (target) => (target === 1 ? 'Log a stint today, however short.' : `Log ${target} stints today.`),
  }),
  countTemplate({
    key: 'daily_story_complete',
    scope: 'DAILY',
    metric: 'STORY_COMPLETES',
    nominal: () => CHALLENGE_NOMINALS.daily.storyCompletes,
    feasible: (ctx) => feasibleStoryCompletes(ctx),
    share: 'gentle',
    effort: 'demanding',
    weight: 'rare',
    title: 'Chequered Flag Today',
    describe: (target) =>
      target === 1 ? 'Story Complete a race today.' : `Story Complete ${target} races today.`,
  }),
  timeTemplate({
    key: 'daily_major_event_time',
    scope: 'DAILY',
    metric: 'REAL_MINUTES',
    share: 'gentle',
    effort: 'baseline',
    weight: 'rare',
    title: 'Time at the Big One',
    focus: majorEventFocus,
    describe: (amount, focus) => `Spend ${amount} with ${focus?.label ?? 'a major event'} today.`,
  }),
  timeTemplate({
    key: 'daily_championship_time',
    scope: 'DAILY',
    metric: 'REAL_MINUTES',
    share: 'gentle',
    effort: 'light',
    weight: 'standard',
    title: 'Championship Focus',
    focus: busiestChampionshipFocus,
    describe: (amount, focus) => `Spend ${amount} with ${focus?.label ?? 'one championship'} today.`,
  }),

  // -- Weekly --------------------------------------------------------------
  timeTemplate({
    key: 'weekly_real_minutes',
    scope: 'WEEKLY',
    metric: 'REAL_MINUTES',
    share: 'standard',
    effort: 'baseline',
    weight: 'common',
    title: 'The Week’s Running',
    describe: (amount) => `Watch ${amount} of racing this week.`,
  }),
  countTemplate({
    key: 'weekly_story_complete',
    scope: 'WEEKLY',
    metric: 'STORY_COMPLETES',
    nominal: () => CHALLENGE_NOMINALS.weekly.storyCompletes,
    feasible: (ctx) => feasibleStoryCompletes(ctx),
    share: 'gentle',
    effort: 'demanding',
    weight: 'common',
    title: 'One Story Finished',
    describe: (target) =>
      target === 1
        ? 'Reach Story Complete on one race this week.'
        : `Reach Story Complete on ${target} races this week.`,
  }),
  countTemplate({
    key: 'weekly_sessions',
    scope: 'WEEKLY',
    metric: 'SESSION_COUNT',
    nominal: () => CHALLENGE_NOMINALS.weekly.sessions,
    feasible: (ctx) => feasibleSessions(ctx),
    share: 'gentle',
    stretch: false,
    effort: 'baseline',
    weight: 'common',
    title: 'Regular Stints',
    describe: (target) => `Watch across ${target} separate sessions this week.`,
  }),
  progressTemplate({
    key: 'weekly_single_race_progress',
    scope: 'WEEKLY',
    percent: CHALLENGE_SHAPE.progressPercent.weekly,
    effort: 'demanding',
    weight: 'standard',
    title: 'Deep Into One',
    describe: (percent) => `Move a single race forward by at least ${percent}% of its runtime.`,
  }),
  countTemplate({
    key: 'weekly_resume_races',
    scope: 'WEEKLY',
    metric: 'RACES_RESUMED',
    nominal: () => CHALLENGE_NOMINALS.weekly.resumedRaces,
    feasible: (ctx) => feasibleTouches(ctx, openRaces(ctx.library).filter((race) => race.started).length),
    share: 'gentle',
    effort: 'baseline',
    weight: 'standard',
    title: 'Back to the Unfinished',
    describe: (target) => `Continue ${target} races you had already started.`,
  }),
  countTemplate({
    key: 'weekly_days_active',
    scope: 'WEEKLY',
    metric: 'DISTINCT_DAYS_ACTIVE',
    nominal: (ctx) => Math.max(1, Math.round(ctx.periodDays * CHALLENGE_SHAPE.activeDaysShare.WEEKLY)),
    feasible: (ctx) => (hasSomethingToWatch(ctx) ? feasibleTouches(ctx, Math.floor(ctx.periodDays)) : 0),
    share: 'gentle',
    stretch: false,
    effort: 'baseline',
    weight: 'standard',
    title: 'Spread Across the Week',
    describe: (target) => `Watch on ${target} different days this week, whichever days suit.`,
  }),
  countTemplate({
    key: 'weekly_two_championships',
    scope: 'WEEKLY',
    metric: 'DISTINCT_CHAMPIONSHIPS_STORIED',
    nominal: () => CHALLENGE_NOMINALS.weekly.championships,
    feasible: (ctx) => feasibleChampionshipsStoried(ctx),
    share: 'gentle',
    effort: 'demanding',
    weight: 'rare',
    title: 'Two Paddocks',
    describe: (target) => `Story Complete races from ${target} different championships this week.`,
  }),
  timeTemplate({
    key: 'weekly_timeline_minutes',
    scope: 'WEEKLY',
    metric: 'TIMELINE_MINUTES',
    share: 'standard',
    effort: 'light',
    weight: 'standard',
    title: 'Timeline Covered',
    describe: (amount) => `Cover ${amount} of race timeline this week.`,
  }),
  timeTemplate({
    key: 'weekly_long_race_time',
    scope: 'WEEKLY',
    metric: 'REAL_MINUTES',
    share: 'standard',
    effort: 'baseline',
    weight: 'rare',
    title: 'Long-Haul Hours',
    focus: longRaceFocus(CHALLENGE_SHAPE.longRaceHours.monthly),
    describe: (amount, focus) => `Spend ${amount} on races of ${focus?.label ?? 'any length'}.`,
  }),

  // -- Monthly -------------------------------------------------------------
  countTemplate({
    key: 'monthly_stories',
    scope: 'MONTHLY',
    metric: 'STORY_COMPLETES',
    nominal: () => CHALLENGE_NOMINALS.monthly.storyCompletes,
    feasible: (ctx) => feasibleStoryCompletes(ctx),
    share: 'standard',
    effort: 'demanding',
    weight: 'common',
    title: 'Stories Completed',
    describe: (target) => `Story Complete ${target} races this month.`,
  }),
  timeTemplate({
    key: 'monthly_real_minutes',
    scope: 'MONTHLY',
    metric: 'REAL_MINUTES',
    share: 'committed',
    effort: 'baseline',
    weight: 'common',
    title: 'The Month’s Running',
    describe: (amount) => `Watch ${amount} of racing this month.`,
  }),
  countTemplate({
    key: 'monthly_championships',
    scope: 'MONTHLY',
    metric: 'DISTINCT_CHAMPIONSHIPS_STORIED',
    nominal: () => CHALLENGE_NOMINALS.monthly.championships,
    feasible: (ctx) => feasibleChampionshipsStoried(ctx),
    share: 'standard',
    effort: 'demanding',
    weight: 'common',
    title: 'Across the Championships',
    describe: (target) => `Complete races from ${target} different championships this month.`,
  }),
  countTemplate({
    key: 'monthly_long_race',
    scope: 'MONTHLY',
    metric: 'LONG_RACE_STORY_COMPLETE',
    nominal: () => CHALLENGE_NOMINALS.monthly.longRaces,
    feasible: (ctx, focus) => feasibleStoryCompletes(ctx, focus?.filter),
    share: 'gentle',
    effort: 'headline',
    weight: 'standard',
    title: 'The Long Way Round',
    focus: longRaceFocus(CHALLENGE_SHAPE.longRaceHours.monthly),
    describe: (target, focus) =>
      target === 1
        ? `Finish a race of ${focus?.label ?? 'real length'}.`
        : `Finish ${target} races of ${focus?.label ?? 'real length'}.`,
  }),
  countTemplate({
    key: 'monthly_days_active',
    scope: 'MONTHLY',
    metric: 'DISTINCT_DAYS_ACTIVE',
    nominal: (ctx) => Math.max(1, Math.round(ctx.periodDays * CHALLENGE_SHAPE.activeDaysShare.MONTHLY)),
    feasible: (ctx) => (hasSomethingToWatch(ctx) ? feasibleTouches(ctx, Math.floor(ctx.periodDays)) : 0),
    share: 'gentle',
    stretch: false,
    effort: 'baseline',
    weight: 'standard',
    title: 'A Month of Stints',
    describe: (target) => `Watch on ${target} different days this month.`,
  }),
  countTemplate({
    key: 'monthly_resume_races',
    scope: 'MONTHLY',
    metric: 'RACES_RESUMED',
    nominal: () => CHALLENGE_NOMINALS.monthly.resumedRaces,
    feasible: (ctx) => feasibleTouches(ctx, openRaces(ctx.library).filter((race) => race.started).length),
    share: 'gentle',
    effort: 'baseline',
    weight: 'standard',
    title: 'Unfinished Stories',
    describe: (target) => `Return to ${target} races you had already begun.`,
  }),
  progressTemplate({
    key: 'monthly_single_race_progress',
    scope: 'MONTHLY',
    percent: CHALLENGE_SHAPE.progressPercent.monthly,
    effort: 'demanding',
    weight: 'rare',
    title: 'Most of One Race',
    describe: (percent) => `Move a single race forward by at least ${percent}% of its runtime.`,
  }),
  countTemplate({
    key: 'monthly_season_push',
    scope: 'MONTHLY',
    metric: 'STORY_COMPLETES',
    nominal: () => CHALLENGE_NOMINALS.monthly.seasonStories,
    feasible: (ctx, focus) => feasibleStoryCompletes(ctx, focus?.filter),
    share: 'gentle',
    effort: 'demanding',
    weight: 'rare',
    title: 'Season Push',
    focus: nearestSeasonFocus,
    describe: (target, focus) =>
      `Story Complete ${target} ${target === 1 ? 'race' : 'races'} from ${focus?.label ?? 'one season'}.`,
  }),

  // -- Seasonal ------------------------------------------------------------
  countTemplate({
    key: 'seasonal_stories',
    scope: 'SEASONAL',
    metric: 'STORY_COMPLETES',
    nominal: () => CHALLENGE_NOMINALS.seasonal.storyCompletes,
    feasible: (ctx) => feasibleStoryCompletes(ctx),
    share: 'standard',
    effort: 'demanding',
    weight: 'common',
    title: 'A Quarter of Stories',
    describe: (target) => `Complete ${target} race stories before the quarter closes.`,
  }),
  timeTemplate({
    key: 'seasonal_real_minutes',
    scope: 'SEASONAL',
    metric: 'REAL_MINUTES',
    share: 'expedition',
    effort: 'demanding',
    weight: 'common',
    title: 'The Quarter’s Running',
    describe: (amount) => `Watch ${amount} of racing this quarter.`,
  }),
  countTemplate({
    key: 'seasonal_championships',
    scope: 'SEASONAL',
    metric: 'DISTINCT_CHAMPIONSHIPS_STORIED',
    nominal: () => CHALLENGE_NOMINALS.seasonal.championships,
    feasible: (ctx) => feasibleChampionshipsStoried(ctx),
    share: 'standard',
    effort: 'headline',
    weight: 'common',
    title: 'Around the Championships',
    describe: (target) => `Story Complete races from ${target} different championships this quarter.`,
  }),
  countTemplate({
    key: 'seasonal_long_race',
    scope: 'SEASONAL',
    metric: 'LONG_RACE_STORY_COMPLETE',
    nominal: () => CHALLENGE_NOMINALS.seasonal.longRaces,
    feasible: (ctx, focus) => feasibleStoryCompletes(ctx, focus?.filter),
    share: 'gentle',
    effort: 'headline',
    weight: 'standard',
    title: 'Round the Clock',
    focus: longRaceFocus(CHALLENGE_SHAPE.longRaceHours.seasonal),
    describe: (target, focus) =>
      target === 1
        ? `Complete one race of ${focus?.label ?? 'real length'}. Take it in as many stints as you like.`
        : `Complete ${target} races of ${focus?.label ?? 'real length'}.`,
  }),
  countTemplate({
    key: 'seasonal_season_complete',
    scope: 'SEASONAL',
    metric: 'SEASON_COMPLETED',
    nominal: () => CHALLENGE_NOMINALS.seasonal.seasonsCompleted,
    feasible: (ctx) => feasibleSeasonCompletions(ctx),
    share: 'gentle',
    effort: 'headline',
    weight: 'standard',
    title: 'A Season Finished',
    describe: (target) =>
      target === 1
        ? 'Finish an entire championship season.'
        : `Finish ${target} entire championship seasons.`,
  }),
  countTemplate({
    key: 'seasonal_days_active',
    scope: 'SEASONAL',
    metric: 'DISTINCT_DAYS_ACTIVE',
    nominal: (ctx) => Math.max(1, Math.round(ctx.periodDays * CHALLENGE_SHAPE.activeDaysShare.SEASONAL)),
    feasible: (ctx) => (hasSomethingToWatch(ctx) ? feasibleTouches(ctx, Math.floor(ctx.periodDays)) : 0),
    share: 'gentle',
    stretch: false,
    effort: 'baseline',
    weight: 'standard',
    title: 'A Quarter of Stints',
    describe: (target) => `Watch on ${target} different days this quarter.`,
  }),
  countTemplate({
    key: 'seasonal_major_events',
    scope: 'SEASONAL',
    metric: 'STORY_COMPLETES',
    nominal: () => CHALLENGE_NOMINALS.seasonal.majorEventStories,
    feasible: (ctx, focus) => feasibleStoryCompletes(ctx, focus?.filter),
    share: 'gentle',
    effort: 'headline',
    weight: 'rare',
    title: 'The Big Occasions',
    focus: majorEventFocus,
    describe: (target) =>
      target === 1
        ? 'Story Complete a race you have marked as a major event.'
        : `Story Complete ${target} races you have marked as major events.`,
  }),
  timeTemplate({
    key: 'seasonal_timeline_minutes',
    scope: 'SEASONAL',
    metric: 'TIMELINE_MINUTES',
    share: 'expedition',
    effort: 'baseline',
    weight: 'rare',
    title: 'Timeline of the Quarter',
    describe: (amount) => `Cover ${amount} of race timeline this quarter.`,
  }),
];

// ---------------------------------------------------------------------------
// Generation (pure)
// ---------------------------------------------------------------------------

/**
 * The challenges a scope offers for one period.
 *
 * Pure and deterministic: the same library, period and seed always produce the
 * same board, which is what makes `ensureChallenges` idempotent and what lets
 * the whole generator be tested without a database.
 *
 * Selection uses the Efraimidis-Spirakis trick — raise a per-template unit
 * value to the power of one over its weight and keep the largest — so a
 * "common" template is likelier than a "rare" one without ever being certain,
 * and without needing a running PRNG stream whose output would depend on how
 * many templates were examined before it.
 */
export function buildChallengesForScope(
  scope: ChallengeScope,
  library: LibrarySnapshot,
  period: Period,
  seed: string,
): GeneratedChallenge[] {
  const ctx = templateContext(scope, library, period);

  const candidates: { template: ChallengeTemplate; built: BuiltChallenge; priority: number }[] = [];
  for (const template of CHALLENGE_TEMPLATES) {
    if (template.scope !== scope) continue;
    if (!template.isEligible(ctx)) continue;

    const built = template.build(ctx);
    if (built === null || built.target <= 0) continue;

    const weight = CHALLENGE_SHAPE.selectionWeights[template.weight];
    const unit = Math.max(deterministicUnit(seed, template.key), Number.EPSILON);
    candidates.push({ template, built, priority: Math.pow(unit, 1 / weight) });
  }

  candidates.sort((a, b) => b.priority - a.priority || a.template.key.localeCompare(b.template.key));

  return candidates
    .slice(0, CHALLENGE_CONFIG.counts[scope])
    .map(({ template, built }) => ({
      templateKey: template.key,
      scope,
      metric: template.metric,
      title: built.title,
      description: built.description,
      target: built.target,
      params: built.params,
      ...rewardFor(scope, template.effort, built.target, built.nominal),
      periodStart: period.start,
      periodEnd: period.end,
    }))
    // A stable output order, so a caller can compare two boards directly.
    .sort((a, b) => a.templateKey.localeCompare(b.templateKey));
}

// ---------------------------------------------------------------------------
// Evaluation (pure)
// ---------------------------------------------------------------------------

/** One race, reduced to what evaluation needs. */
export interface EvaluationRace {
  id: string;
  championshipId: string | null;
  seasonId: string | null;
  runtimeSec: number;
  isMajorEvent: boolean;
  storyCompletedAt: Date | null;
  /**
   * Earliest stint on this race, recomputed from the session history rather
   * than read from `Race.startedAt`. The cached column is maintained by the
   * race engine and would be right anyway; recomputing keeps this module's
   * answers independent of anyone else's cache.
   */
  firstSessionAt: Date | null;
}

/** One stint, reduced to what evaluation needs. */
export interface EvaluationSession {
  raceId: string;
  watchedAt: Date;
  /** Wall-clock seconds. Never mixed with the timeline figure below. */
  realSeconds: number;
  /** Seconds played on the race clock, re-watched sections included. */
  timelineSeconds: number;
  /** How much of the above had never been seen before. */
  newCoverageSeconds: number;
}

/** One season, reduced to the single question the metric asks of it. */
export interface EvaluationSeason {
  id: string;
  /** The moment it became complete, or null while it is not. */
  completedAt: Date | null;
}

export interface ChallengeEvaluationSource {
  races: ReadonlyMap<string, EvaluationRace>;
  sessions: readonly EvaluationSession[];
  seasons: readonly EvaluationSeason[];
}

/** Does this race satisfy the challenge's narrowing? */
function matchesParams(race: EvaluationRace | undefined, params: ChallengeParams): boolean {
  if (race === undefined) return false;
  if (params.raceIds !== undefined && params.raceIds.length > 0 && !params.raceIds.includes(race.id)) {
    return false;
  }
  if (params.championshipIds !== undefined && params.championshipIds.length > 0) {
    if (race.championshipId === null || !params.championshipIds.includes(race.championshipId)) return false;
  }
  if (params.seasonIds !== undefined && params.seasonIds.length > 0) {
    if (race.seasonId === null || !params.seasonIds.includes(race.seasonId)) return false;
  }
  if (params.minRuntimeSec !== undefined && race.runtimeSec < params.minRuntimeSec) return false;
  if (params.majorEventOnly === true && !race.isMajorEvent) return false;
  return true;
}

/** Local calendar day of a moment, as a comparable number. */
function localDayKey(moment: Date): number {
  return new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime();
}

/**
 * The value of one metric over one window.
 *
 * Pure, and recomputed from the raw rows every time rather than accumulated, so
 * that evaluating a challenge twice can never double count and evaluating it
 * late can never miss anything. `[start, end)` is half-open, exactly like the
 * watched intervals it is spiritually related to.
 */
export function evaluateChallengeMetric(
  metric: ChallengeMetric,
  params: ChallengeParams,
  window: { start: Date; end: Date },
  source: ChallengeEvaluationSource,
): number {
  const from = window.start.getTime();
  const to = window.end.getTime();
  const inWindow = (moment: Date | null): boolean =>
    moment !== null && moment.getTime() >= from && moment.getTime() < to;

  const sessions = source.sessions.filter(
    (session) => inWindow(session.watchedAt) && matchesParams(source.races.get(session.raceId), params),
  );

  /** Races whose story was completed inside the window, after narrowing. */
  const storied = (): EvaluationRace[] =>
    [...source.races.values()].filter(
      (race) => inWindow(race.storyCompletedAt) && matchesParams(race, params),
    );

  switch (metric) {
    case 'REAL_MINUTES':
      return sessions.reduce((sum, session) => sum + Math.max(0, session.realSeconds), 0) / 60;

    case 'TIMELINE_MINUTES':
      return sessions.reduce((sum, session) => sum + Math.max(0, session.timelineSeconds), 0) / 60;

    case 'SESSION_COUNT':
      return sessions.length;

    case 'DISTINCT_RACES_PROGRESSED':
      // "Progressed" means timeline that had never been seen before. A
      // re-watch is a fine way to spend an evening and it earns XP, but it is
      // not progress, and this application does not pretend otherwise.
      return new Set(
        sessions.filter((session) => session.newCoverageSeconds > 0).map((session) => session.raceId),
      ).size;

    case 'RACES_RESUMED': {
      const resumed = new Set<string>();
      for (const session of sessions) {
        if (session.newCoverageSeconds <= 0) continue;
        const race = source.races.get(session.raceId);
        if (race?.firstSessionAt !== null && race?.firstSessionAt !== undefined && race.firstSessionAt.getTime() < from) {
          resumed.add(session.raceId);
        }
      }
      return resumed.size;
    }

    case 'DISTINCT_DAYS_ACTIVE':
      return new Set(sessions.map((session) => localDayKey(session.watchedAt))).size;

    case 'SINGLE_RACE_PROGRESS_PERCENT': {
      // Summed per race, because a race moved forward across four stints has
      // been moved forward just as far as one moved in a single sitting.
      const added = new Map<string, number>();
      for (const session of sessions) {
        added.set(session.raceId, (added.get(session.raceId) ?? 0) + Math.max(0, session.newCoverageSeconds));
      }
      let best = 0;
      for (const [raceId, seconds] of added) {
        const race = source.races.get(raceId);
        if (race === undefined || race.runtimeSec <= 0) continue;
        best = Math.max(best, (seconds / race.runtimeSec) * 100);
      }
      return best;
    }

    case 'STORY_COMPLETES':
      return storied().length;

    case 'LONG_RACE_STORY_COMPLETE':
      // The length itself lives in `params.minRuntimeSec`, so the two story
      // metrics differ only in what the template put in the parameters.
      return storied().length;

    case 'DISTINCT_CHAMPIONSHIPS_STORIED':
      return new Set(
        storied()
          .map((race) => race.championshipId)
          .filter((id): id is string => id !== null),
      ).size;

    case 'SEASON_COMPLETED':
      return source.seasons.filter((season) => inWindow(season.completedAt)).length;
  }
}

/** Narrow a metric name read back from the database. */
export function asChallengeMetric(value: string): ChallengeMetric | null {
  return CHALLENGE_METRICS.find((metric) => metric === value) ?? null;
}

/**
 * Narrow a `params` JSON column.
 *
 * Nothing here throws. A row written by an older build simply loses the parts
 * this build does not understand, which at worst widens the challenge — it can
 * never make one harder after the fact.
 */
export function readChallengeParams(value: unknown): ChallengeParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;

  const params: ChallengeParams = {};
  const raceIds = readStringArray(record.raceIds);
  if (raceIds.length > 0) params.raceIds = raceIds;
  const championshipIds = readStringArray(record.championshipIds);
  if (championshipIds.length > 0) params.championshipIds = championshipIds;
  const seasonIds = readStringArray(record.seasonIds);
  if (seasonIds.length > 0) params.seasonIds = seasonIds;
  if (typeof record.minRuntimeSec === 'number' && Number.isFinite(record.minRuntimeSec)) {
    params.minRuntimeSec = record.minRuntimeSec;
  }
  if (record.majorEventOnly === true) params.majorEventOnly = true;
  if (typeof record.percent === 'number' && Number.isFinite(record.percent)) {
    params.percent = record.percent;
  }
  return params;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

// ---------------------------------------------------------------------------
// Loading from the database
// ---------------------------------------------------------------------------

/**
 * Read the library the generator will work from.
 *
 * `db` may be a transaction client, so a caller that has just written a session
 * sees it. Nothing here writes anything.
 */
export async function loadLibrarySnapshot(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<LibrarySnapshot> {
  const paceFrom = new Date(now.getTime() - CHALLENGE_SHAPE.paceWindowDays * 86_400_000);

  const [races, seasonRows, championships, lifetimeTotals, paceTotals] = await Promise.all([
    db.race.findMany({
      where: { userId },
      select: {
        id: true, name: true, championshipId: true, seasonId: true, runtimeSec: true,
        coverageSec: true, isMajorEvent: true, storyCompletedAt: true, status: true,
        championship: { select: { name: true } },
      },
    }),
    db.championshipSeason.findMany({
      where: { championship: { userId } },
      select: {
        id: true, year: true, label: true, plannedRaceCount: true, championshipId: true,
        championship: { select: { name: true, shortName: true } },
        races: {
          select: {
            runtimeSec: true, coverageSec: true, storyCompletedAt: true, status: true,
          },
        },
      },
    }),
    db.championship.findMany({ where: { userId }, select: { id: true, name: true } }),
    db.raceViewingSession.aggregate({
      where: { userId },
      _sum: { timelineSeconds: true, realSeconds: true },
    }),
    db.raceViewingSession.aggregate({
      where: { userId, watchedAt: { gte: paceFrom, lt: now } },
      _sum: { realSeconds: true },
      _count: true,
    }),
  ]);

  // The career-wide speed, so an untouched race can still be costed in real
  // time. Timeline and real seconds are never added together — only divided.
  const playbackSpeed = averagePlaybackSpeed([
    {
      timelineSeconds: lifetimeTotals._sum.timelineSeconds ?? 0,
      realSeconds: lifetimeTotals._sum.realSeconds ?? 0,
    },
  ]);

  const libraryRaces: LibraryRace[] = races.map((race) => ({
    id: race.id,
    name: race.name,
    championshipId: race.championshipId,
    championshipName: race.championship?.name ?? null,
    seasonId: race.seasonId,
    runtimeSec: race.runtimeSec,
    coverageSec: race.coverageSec,
    isMajorEvent: race.isMajorEvent,
    storyComplete: race.storyCompletedAt !== null,
    started: race.coverageSec > 0,
    setAside: race.status === 'ABANDONED' || race.status === 'ARCHIVED',
  }));

  const seasons: LibrarySeason[] = seasonRows.map((season) => {
    const target = season.plannedRaceCount ?? season.races.length;
    const completedCount = season.races.filter(
      (race) => race.storyCompletedAt !== null || race.status === 'COMPLETED',
    ).length;
    const outstanding = season.races.filter(
      (race) =>
        race.storyCompletedAt === null &&
        race.status !== 'COMPLETED' &&
        race.status !== 'ABANDONED' &&
        race.status !== 'ARCHIVED',
    );

    const remainingRealMinutes = outstanding.reduce(
      (sum, race) =>
        sum + Math.max(0, race.runtimeSec - race.coverageSec) / clampSpeed(playbackSpeed) / 60,
      0,
    );

    const championshipLabel = season.championship.shortName ?? season.championship.name;
    return {
      id: season.id,
      label: season.label ?? `${season.year} ${championshipLabel}`,
      championshipId: season.championshipId,
      target,
      completedCount,
      remainingRaceCount: Math.max(0, target - completedCount),
      remainingRealMinutes,
      // A season the user has declared larger than the races they have filed
      // cannot be finished from the library as it stands, so nothing may ask
      // for it. This is a statement about the data, not about the user.
      completable: season.races.length >= target && target > 0,
    };
  });

  const paceDays = CHALLENGE_SHAPE.paceWindowDays;
  return {
    races: libraryRaces,
    seasons,
    championships,
    playbackSpeed,
    paceRealMinutesPerDay: (paceTotals._sum.realSeconds ?? 0) / 60 / paceDays,
    paceSessionsPerDay: paceTotals._count / paceDays,
  };
}

/**
 * Read everything the metrics are computed from.
 *
 * One query set for the whole board rather than one per challenge: the
 * challenges on a board overlap heavily, and they must all agree about what
 * happened.
 */
export async function loadEvaluationSource(
  db: Tx,
  userId: string,
  from: Date,
): Promise<ChallengeEvaluationSource> {
  const [races, sessions, firstSessions, seasonRows] = await Promise.all([
    db.race.findMany({
      where: { userId },
      select: {
        id: true, championshipId: true, seasonId: true, runtimeSec: true,
        isMajorEvent: true, storyCompletedAt: true,
      },
    }),
    // No upper bound: the pure evaluator applies each challenge's own window,
    // and a stint logged with a slightly optimistic timestamp should still be
    // visible to the period it actually falls in.
    db.raceViewingSession.findMany({
      where: { userId, watchedAt: { gte: from } },
      select: {
        raceId: true, watchedAt: true, realSeconds: true, timelineSeconds: true,
        newCoverageSeconds: true,
      },
      orderBy: { watchedAt: 'asc' },
    }),
    db.raceViewingSession.groupBy({
      by: ['raceId'],
      where: { userId },
      _min: { watchedAt: true },
    }),
    db.championshipSeason.findMany({
      where: { championship: { userId } },
      select: {
        id: true,
        plannedRaceCount: true,
        races: { select: { storyCompletedAt: true, completedAt: true, status: true } },
      },
    }),
  ]);

  const firstByRace = new Map<string, Date | null>(
    firstSessions.map((row) => [row.raceId, row._min.watchedAt ?? null]),
  );

  const raceMap = new Map<string, EvaluationRace>(
    races.map((race) => [
      race.id,
      {
        id: race.id,
        championshipId: race.championshipId,
        seasonId: race.seasonId,
        runtimeSec: race.runtimeSec,
        isMajorEvent: race.isMajorEvent,
        storyCompletedAt: race.storyCompletedAt,
        firstSessionAt: firstByRace.get(race.id) ?? null,
      },
    ]),
  );

  const seasons: EvaluationSeason[] = seasonRows.map((season) => {
    const target = season.plannedRaceCount ?? season.races.length;
    // The moment a season became complete is the moment its TARGET-th race was
    // finished, not the moment its most recent one was. Reading it that way is
    // what stops a later race re-completing an already-complete season and
    // handing the same challenge a second qualifying event.
    const moments = season.races
      .filter((race) => race.storyCompletedAt !== null || race.status === 'COMPLETED')
      .map((race) => race.storyCompletedAt ?? race.completedAt)
      .filter((moment): moment is Date => moment !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    const completedAt = target > 0 && moments.length >= target ? moments[target - 1] ?? null : null;
    return { id: season.id, completedAt };
  });

  return { races: raceMap, sessions, seasons };
}

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

/**
 * Make sure every scope has its board for the period `now` falls in.
 *
 * Idempotent by construction. `(userId, scope, templateKey, periodStart)` is
 * unique in the database and generation is deterministic for a period, so the
 * second call of a day writes nothing and returns exactly what the first one
 * did. `createMany({ skipDuplicates })` makes that a single statement rather
 * than a read-then-write race.
 *
 * Unlike the engines the session engine orchestrates, this one is not part of
 * the atomic stint write — it is housekeeping, run on a page load or before a
 * stint — so it does not demand a transaction client. It accepts one all the
 * same, for a caller that would rather have generation and evaluation land
 * together.
 */
export async function ensureChallenges(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<Challenge[]> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { weekStart: true } });
  const library = await loadLibrarySnapshot(userId, now, db);

  const periods = SCOPES.map((scope) => ({ scope, period: periodForScope(scope, now, user.weekStart) }));

  const generated = periods.flatMap(({ scope, period }) =>
    buildChallengesForScope(scope, library, period, `${userId}:${scope}:${period.key}`),
  );

  if (generated.length > 0) {
    await createManySkippingDuplicates(
      db.challenge,
      generated.map((challenge) => ({
        userId,
        scope: challenge.scope,
        templateKey: challenge.templateKey,
        title: challenge.title,
        description: challenge.description,
        metric: challenge.metric,
        target: challenge.target,
        params: challenge.params,
        xpReward: challenge.xpReward,
        seasonXpReward: challenge.seasonXpReward,
        periodStart: challenge.periodStart,
        periodEnd: challenge.periodEnd,
      })),
    );
  }

  const rows = await db.challenge.findMany({
    where: {
      userId,
      OR: periods.map(({ scope, period }) => ({ scope, periodStart: period.start })),
    },
  });

  // Every challenge carries an ACTIVE progress row from the moment it exists,
  // so the board, the budget engine and the strategist all see the same state
  // without having to treat "no row yet" as a special case.
  const withProgress = await db.challengeProgress.findMany({
    where: { challengeId: { in: rows.map((row) => row.id) } },
    select: { challengeId: true },
  });
  const known = new Set(withProgress.map((row) => row.challengeId));
  const missing = rows.filter((row) => !known.has(row.id));
  if (missing.length > 0) {
    await createManySkippingDuplicates(
      db.challengeProgress,
      missing.map((row) => ({ challengeId: row.id, value: 0, state: 'ACTIVE' as const })),
    );
  }

  return rows.sort(
    (a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.templateKey.localeCompare(b.templateKey),
  );
}

/**
 * Re-evaluate every open challenge and return the ones that just completed.
 *
 * Takes the caller's transaction client, because completing a challenge awards
 * XP and one logged session must be one atomic write. Safe to call as often as
 * you like: values are recomputed from source rows, a completion is written
 * once, and the XP behind it is guarded by a unique `dedupeKey`, so a second
 * run grants nothing and reports nothing.
 *
 * Challenges already COMPLETED are left alone entirely. Nothing in this
 * application takes a completion back.
 */
export async function evaluateChallenges(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<ChallengeCompletion[]> {
  const open = await tx.challenge.findMany({
    where: { userId, periodStart: { lte: now }, periodEnd: { gt: now } },
    include: { progress: true },
  });

  const pending = open.filter((challenge) => (challenge.progress?.state ?? 'ACTIVE') === 'ACTIVE');
  if (pending.length === 0) return [];

  let earliest = pending[0]?.periodStart ?? now;
  for (const challenge of pending) {
    if (challenge.periodStart < earliest) earliest = challenge.periodStart;
  }

  const source = await loadEvaluationSource(tx, userId, earliest);
  const completions: ChallengeCompletion[] = [];

  for (const challenge of pending) {
    const metric = asChallengeMetric(challenge.metric);
    if (metric === null) continue; // A row from a build this one does not know. Left untouched.

    const value = evaluateChallengeMetric(
      metric,
      readChallengeParams(challenge.params),
      { start: challenge.periodStart, end: challenge.periodEnd },
      source,
    );
    const reached = challenge.target > 0 && value >= challenge.target;

    await tx.challengeProgress.upsert({
      where: { challengeId: challenge.id },
      create: {
        challengeId: challenge.id,
        value,
        state: reached ? 'COMPLETED' : 'ACTIVE',
        completedAt: reached ? now : null,
      },
      update: reached
        ? { value, state: 'COMPLETED', completedAt: challenge.progress?.completedAt ?? now }
        : { value },
    });

    if (!reached) continue;

    // One-shot, so the award carries a stable dedupe key. If the ledger has
    // seen it before, `awardXp` grants nothing and says so — which is success,
    // not an error.
    const award = await awardXp(tx, userId, {
      source: 'CHALLENGE',
      amount: challenge.xpReward,
      seasonAmount: challenge.seasonXpReward,
      description: `Challenge — ${challenge.title}`,
      sourceRef: challenge.id,
      dedupeKey: `challenge:${challenge.id}`,
    });

    completions.push({
      id: challenge.id,
      scope: challenge.scope,
      title: challenge.title,
      xpAwarded: award.granted,
      // Season XP is passed straight through to the caller, which adds it to
      // the quarter's pass alongside the session's own. It is never deducted.
      seasonXpAwarded: award.duplicate ? 0 : challenge.seasonXpReward,
    });
  }

  return completions;
}

/**
 * Record that closed windows have closed.
 *
 * This is bookkeeping and nothing else. No XP moves, no level moves, no
 * statistic moves, and the user is told about it in the words of
 * `EXPIRED_CHALLENGE_NOTE`. Returns how many rows changed state, which is
 * useful to a maintenance script and to nobody else.
 */
export async function expireStaleChallenges(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<number> {
  const closed = await db.challenge.findMany({
    where: { userId, periodEnd: { lte: now } },
    select: { id: true, progress: { select: { state: true } } },
  });

  const toExpire = closed
    .filter((challenge) => challenge.progress !== null && challenge.progress.state === 'ACTIVE')
    .map((challenge) => challenge.id);
  const toRecord = closed.filter((challenge) => challenge.progress === null);

  let changed = 0;

  if (toExpire.length > 0) {
    const result = await db.challengeProgress.updateMany({
      where: { challengeId: { in: toExpire }, state: 'ACTIVE' },
      data: { state: 'EXPIRED', expiredAt: now },
    });
    changed += result.count;
  }

  if (toRecord.length > 0) {
    changed += await createManySkippingDuplicates(
      db.challengeProgress,
      toRecord.map((challenge) => ({
        challengeId: challenge.id,
        value: 0,
        state: 'EXPIRED' as const,
        expiredAt: now,
      })),
    );
  }

  return changed;
}

/**
 * The board, with live progress and the time left in each window.
 *
 * Read-only, so it goes through `prisma` by default. Every value is recomputed
 * from the source rows rather than read from `ChallengeProgress.value`, so a
 * board is correct even if it is opened between a stint and the next
 * evaluation.
 *
 * Challenges already completed in the current window are included: the board
 * is a record of the period, and a finished challenge is the best part of it.
 */
export async function getActiveChallenges(
  userId: string,
  now: Date = new Date(),
  db: Tx = prisma,
): Promise<ChallengeView[]> {
  const rows = await db.challenge.findMany({
    where: { userId, periodStart: { lte: now }, periodEnd: { gt: now } },
    include: { progress: true },
  });
  if (rows.length === 0) return [];

  let earliest = rows[0]?.periodStart ?? now;
  for (const row of rows) {
    if (row.periodStart < earliest) earliest = row.periodStart;
  }

  const source = await loadEvaluationSource(db, userId, earliest);

  return rows
    .map((row): ChallengeView => {
      const metric = asChallengeMetric(row.metric);
      const state: ChallengeState = row.progress?.state ?? 'ACTIVE';
      const value =
        metric === null
          ? row.progress?.value ?? 0
          : evaluateChallengeMetric(
              metric,
              readChallengeParams(row.params),
              { start: row.periodStart, end: row.periodEnd },
              source,
            );
      const msRemaining = Math.max(0, row.periodEnd.getTime() - now.getTime());

      return {
        id: row.id,
        scope: row.scope,
        templateKey: row.templateKey,
        title: row.title,
        description: row.description,
        metric,
        target: row.target,
        value,
        progress: row.target > 0 ? Math.min(1, Math.max(0, value / row.target)) : 1,
        state,
        xpReward: row.xpReward,
        seasonXpReward: row.seasonXpReward,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        msRemaining,
        remainingLabel: windowRemainingLabel(msRemaining),
        completedAt: row.progress?.completedAt ?? null,
        note: state === 'EXPIRED' ? EXPIRED_CHALLENGE_NOTE : null,
      };
    })
    .sort(
      (a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.templateKey.localeCompare(b.templateKey),
    );
}

/**
 * How long a window is open for, in words.
 *
 * Phrased as availability rather than as a countdown. Nothing is running out;
 * a window is simply open, and then it is not.
 */
export function windowRemainingLabel(msRemaining: number): string {
  if (msRemaining <= 0) return 'This window has closed.';
  const days = msRemaining / 86_400_000;
  if (days >= 2) return `Open for another ${Math.floor(days)} days.`;
  return `Open for another ${formatDuration(msRemaining / 1000)}.`;
}
