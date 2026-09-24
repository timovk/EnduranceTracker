/**
 * The career replay (0.4.0): one canonical fold over every stint ever logged.
 *
 * The Chronicle, Career Statistics, Personal Records, Event Legacy, Race
 * Expeditions and the dates of Career Milestones all read history from here,
 * so they cannot disagree with one another. Everything is derived from the
 * canonical sources — the stints and the races they belong to — and nothing
 * here reads a cached counter, because the caches go stale the moment a stint
 * is deleted.
 *
 * The replay answers three questions per stint:
 *
 *   - How much did it add? Stints are folded per race in canonical order with
 *     the same `addInterval` the race page uses, clamped to the race's current
 *     runtime and with the same 20-second gap tolerance, so the replay's
 *     coverage is the race page's coverage.
 *   - How much time does it credit? `creditedSeconds`: real time, but never
 *     more than the timeline at the slowest speed XP credits (0.75×). Every
 *     hour figure in 0.4.0 uses it, so very slow playback cannot inflate one.
 *   - When did it happen? A stint's instant is its `watchedAt` — when it was
 *     logged, effectively its end. Its window reaches back by its credited time
 *     but never before the previous stint's instant, so windows never overlap
 *     and every time interpolated along them runs forwards.
 *
 * Pure and deterministic. Never throws on empty input: an empty career is an
 * empty timeline.
 */

import { CAREER_STATS_SHAPE, STORY_CONFIG, TIMELINE_SHAPE, XP_CONFIG } from '@/lib/config';
import type { LocalWindow } from './calendar';
import { clipToWindow } from './calendar';
import { addInterval, isStoryComplete } from './intervals';
import type { Interval, RaceType } from './types';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One stint, as the loader reads it from `RaceViewingSession`. */
export interface TimelineSessionRow {
  id: string;
  raceId: string;
  startTimestampSec: number;
  endTimestampSec: number;
  playbackSpeed: number;
  timelineSeconds: number;
  realSeconds: number;
  watchedAt: Date;
  createdAt: Date;
}

/** One race, with what the history pages need to group and label it. */
export interface TimelineRaceRow {
  id: string;
  name: string;
  runtimeSec: number;
  scheduledDurationSec: number;
  raceDate: Date | null;
  seasonYear: number | null;
  /** Precomputed by the loader with `editionYear` from `./edition`. */
  editionYear: number | null;
  championshipId: string | null;
  championshipName: string | null;
  championshipAccent: string | null;
  /** The recurring event (`RaceMastery`): its id, its permanent key, and its display name. */
  eventId: string | null;
  eventKey: string | null;
  eventName: string | null;
  circuit: string | null;
  circuitSlug: string | null;
  country: string | null;
  raceType: RaceType;
  isMajorEvent: boolean;
  expeditionMode: boolean | null;
}

export interface TimelineOptions {
  /** `STORY_CONFIG.gapToleranceSeconds`. */
  gapToleranceSeconds: number;
  storyThresholds: { coverageRatio: number; maxUncoveredSeconds: number };
  /** `XP_CONFIG.xpMinSpeed`. */
  xpMinSpeed: number;
  experienced: { minimumCreditedSeconds: number; coverageShare: number; coverageEnoughSeconds: number };
  /** `TIMELINE_SHAPE.reliableWindowShare`. */
  reliableWindowShare: number;
}

export const DEFAULT_TIMELINE_OPTIONS: TimelineOptions = {
  gapToleranceSeconds: STORY_CONFIG.gapToleranceSeconds,
  storyThresholds: {
    coverageRatio: STORY_CONFIG.coverageRatio,
    maxUncoveredSeconds: STORY_CONFIG.maxUncoveredSeconds,
  },
  xpMinSpeed: XP_CONFIG.xpMinSpeed,
  experienced: {
    minimumCreditedSeconds: CAREER_STATS_SHAPE.experiencedMinimumCreditedMinutes * 60,
    coverageShare: CAREER_STATS_SHAPE.experiencedCoverageShare,
    coverageEnoughSeconds: CAREER_STATS_SHAPE.experiencedCoverageEnoughMinutes * 60,
  },
  reliableWindowShare: TIMELINE_SHAPE.reliableWindowShare,
};

// ---------------------------------------------------------------------------
// The shared definitions
// ---------------------------------------------------------------------------

/**
 * Real seconds a stint is credited with: its real time, but never more than
 * its timeline at the slowest speed XP credits.
 *
 *     creditedSeconds = max(0, min(realSeconds, round(timelineSeconds / xpMinSpeed)))
 *
 * For any speed of 0.75× or above this is simply the real time. Below it, it
 * is the real time XP itself credits (`xpForSession`), so a stint logged at
 * 0.1× cannot make ten hours out of one.
 */
export function creditedSeconds(
  row: { realSeconds: number; timelineSeconds: number },
  xpMinSpeed: number = XP_CONFIG.xpMinSpeed,
): number {
  const cap = Math.round(Math.max(0, row.timelineSeconds) / xpMinSpeed);
  return Math.max(0, Math.min(Math.round(row.realSeconds), cap));
}

/**
 * Whether a race has been experienced rather than glimpsed: ten credited
 * minutes, and a tenth of the race covered — or an hour of it, whichever is
 * less, so an hour of a 24-hour race counts.
 *
 * The same predicate serves race rows (mastery, metrics) and the replay, so
 * the two can never disagree about a race.
 */
export function isRaceExperienced(
  race: { coverageSec: number; runtimeSec: number; creditedSec: number },
  options: TimelineOptions['experienced'] = DEFAULT_TIMELINE_OPTIONS.experienced,
): boolean {
  if (!(race.runtimeSec > 0)) return false;
  if (race.creditedSec < options.minimumCreditedSeconds) return false;
  const coverageNeeded = Math.min(Math.ceil(race.runtimeSec * options.coverageShare), options.coverageEnoughSeconds);
  return race.coverageSec >= coverageNeeded;
}

/**
 * Canonical order: `watchedAt`, then `createdAt`, then `id`. Every replay and
 * every "which stint crossed it" question uses it, so two stints logged at the
 * same instant always come out the same way round.
 */
export function compareCanonical(
  a: { watchedAt: Date; createdAt: Date; id: string },
  b: { watchedAt: Date; createdAt: Date; id: string },
): number {
  const byWatched = a.watchedAt.getTime() - b.watchedAt.getTime();
  if (byWatched !== 0) return byWatched;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface StintEvent {
  sessionId: string;
  raceId: string;
  /** 0-based position in the career's canonical order. */
  ordinal: number;
  /** 0-based position within its race. */
  raceOrdinal: number;
  /** When the stint was logged: its instant. */
  watchedAt: Date;
  /** The start of its window: its nominal start, cut at the previous stint's instant. */
  startsAt: Date;
  /** `watchedAt` minus its credited time. */
  nominalStartsAt: Date;
  /** The window kept enough of its nominal length for times inside it to be interpolated. */
  windowReliable: boolean;
  playbackSpeed: number;
  startTimestampSec: number;
  endTimestampSec: number;
  creditedSeconds: number;
  timelineSeconds: number;
  /** Timeline played inside the race's current runtime. */
  timelineInRuntimeSeconds: number;
  /** Timeline seen for the first time, clamped to the runtime. */
  addedCoverageSeconds: number;
  /** Credited seconds spent on timeline already seen. */
  rewatchCreditedSeconds: number;
  /** Race coverage before and after this stint, clamped to the runtime. */
  coverageBeforeSeconds: number;
  coverageAfterSeconds: number;
  /** Race credited seconds up to and including this stint. */
  raceCreditedAfterSeconds: number;
  /** Career credited seconds before this stint. */
  cumulativeCreditedBefore: number;
  /** Career sum of race coverage before this stint. */
  cumulativeCoverageBefore: number;
  /** The first stint of its race. */
  startsRace: boolean;
  /** This stint made the race experienced. */
  experiencesRace: boolean;
  /** This stint made the race Story Complete. */
  completesStory: boolean;
}

export interface RaceHistory {
  race: TimelineRaceRow;
  /** Canonical order. */
  stints: readonly StintEvent[];
  /** The final merged coverage, clamped to the runtime. */
  intervals: Interval[];
  coverageSeconds: number;
  creditedSeconds: number;
  rewatchCreditedSeconds: number;
  timelineSeconds: number;
  sessionCount: number;
  /** Credited seconds of the longest stint. */
  longestStintSeconds: number;
  /** The first stint's `startsAt`. */
  startedAt: Date | null;
  /** The first and last stints' `watchedAt`. */
  firstStintAt: Date | null;
  lastStintAt: Date | null;
  experiencedAt: Date | null;
  experiencingSessionId: string | null;
  storyCompletedAt: Date | null;
  completingSessionId: string | null;
}

/** A fact that happened with one stint. */
export interface TimelineEvent {
  at: Date;
  sessionId: string;
  raceId: string;
  ordinal: number;
}

/** When something was reached, and how exactly that is known. */
export interface InstantResult {
  at: Date;
  precision: 'INTERPOLATED' | 'STINT';
  sessionId: string;
  raceId: string;
}

export interface CareerTimeline {
  /** Every stint, canonical order. */
  stints: readonly StintEvent[];
  /** Every race, with or without stints. */
  races: ReadonlyMap<string, RaceHistory>;
  racesById: ReadonlyMap<string, TimelineRaceRow>;
  totalCreditedSeconds: number;
}

/** `StintEvent` while it is being built; exposed read-only. */
type MutableStint = { -readonly [K in keyof StintEvent]: StintEvent[K] };
type MutableHistory = Omit<RaceHistory, 'stints'> & { stints: MutableStint[] };

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

/**
 * One race's stints, already in canonical order, folded into its history.
 *
 * The window fields (`startsAt`, `windowReliable`) and the career running
 * totals are filled from this race alone; `buildCareerTimeline` overwrites
 * them with the career-wide values.
 */
function replaySorted(
  race: TimelineRaceRow,
  sessions: readonly TimelineSessionRow[],
  options: TimelineOptions,
): MutableHistory {
  const runtime = Math.max(0, race.runtimeSec);
  const stints: MutableStint[] = [];
  let intervals: Interval[] = [];
  let coverage = 0;
  let credited = 0;
  let rewatch = 0;
  let timeline = 0;
  let longest = 0;
  let experiencedAt: Date | null = null;
  let experiencingSessionId: string | null = null;
  let storyCompletedAt: Date | null = null;
  let completingSessionId: string | null = null;
  let previousWatchedAt: Date | null = null;

  for (const session of sessions) {
    const stintCredited = creditedSeconds(session, options.xpMinSpeed);
    const merged = addInterval(
      intervals,
      { start: session.startTimestampSec, end: session.endTimestampSec },
      { limit: runtime, gapTolerance: options.gapToleranceSeconds },
    );
    intervals = merged.intervals;
    const added = merged.addedSeconds;
    const coverageBefore = coverage;
    coverage += added;

    const inRuntime = Math.max(
      0,
      Math.min(session.endTimestampSec, runtime) - Math.min(session.startTimestampSec, runtime),
    );
    const stintRewatch = session.timelineSeconds > 0
      ? (stintCredited * Math.max(0, inRuntime - Math.min(added, inRuntime))) / session.timelineSeconds
      : 0;

    credited += stintCredited;
    rewatch += stintRewatch;
    timeline += Math.max(0, session.timelineSeconds);
    longest = Math.max(longest, stintCredited);

    const experiences = experiencedAt === null
      && isRaceExperienced({ coverageSec: coverage, runtimeSec: runtime, creditedSec: credited }, options.experienced);
    if (experiences) {
      experiencedAt = session.watchedAt;
      experiencingSessionId = session.id;
    }
    // Coverage never shrinks within a replay, so the first stint after which
    // the story is complete is the only one that completes it.
    const completes = storyCompletedAt === null && isStoryComplete(intervals, runtime, options.storyThresholds);
    if (completes) {
      storyCompletedAt = session.watchedAt;
      completingSessionId = session.id;
    }

    const nominalStartsAt = new Date(session.watchedAt.getTime() - stintCredited * 1000);
    const startsAt = previousWatchedAt !== null && previousWatchedAt > nominalStartsAt ? previousWatchedAt : nominalStartsAt;
    stints.push({
      sessionId: session.id,
      raceId: race.id,
      ordinal: stints.length,
      raceOrdinal: stints.length,
      watchedAt: session.watchedAt,
      startsAt,
      nominalStartsAt,
      windowReliable: isReliable(startsAt, session.watchedAt, stintCredited, options.reliableWindowShare),
      playbackSpeed: session.playbackSpeed,
      startTimestampSec: session.startTimestampSec,
      endTimestampSec: session.endTimestampSec,
      creditedSeconds: stintCredited,
      timelineSeconds: session.timelineSeconds,
      timelineInRuntimeSeconds: inRuntime,
      addedCoverageSeconds: added,
      rewatchCreditedSeconds: stintRewatch,
      coverageBeforeSeconds: coverageBefore,
      coverageAfterSeconds: coverage,
      raceCreditedAfterSeconds: credited,
      cumulativeCreditedBefore: credited - stintCredited,
      cumulativeCoverageBefore: coverageBefore,
      startsRace: stints.length === 0,
      experiencesRace: experiences,
      completesStory: completes,
    });
    previousWatchedAt = session.watchedAt;
  }

  const first = stints[0];
  const last = stints[stints.length - 1];
  return {
    race,
    stints,
    intervals,
    coverageSeconds: coverage,
    creditedSeconds: credited,
    rewatchCreditedSeconds: rewatch,
    timelineSeconds: timeline,
    sessionCount: stints.length,
    longestStintSeconds: longest,
    startedAt: first?.startsAt ?? null,
    firstStintAt: first?.watchedAt ?? null,
    lastStintAt: last?.watchedAt ?? null,
    experiencedAt,
    experiencingSessionId,
    storyCompletedAt,
    completingSessionId,
  };
}

/** A window is reliable when it kept at least `share` of its nominal length (R6). */
function isReliable(startsAt: Date, endsAt: Date, credited: number, share: number): boolean {
  return endsAt.getTime() - startsAt.getTime() >= share * credited * 1000;
}

/**
 * One race on its own, for the paths that need a single race (Expeditions).
 *
 * Sessions of other races are ignored. Windows are cut at this race's own
 * previous stint only, which is all the Expedition figures need: they date
 * nothing by interpolation.
 */
export function replayRace(
  race: TimelineRaceRow,
  sessions: readonly TimelineSessionRow[],
  options: TimelineOptions = DEFAULT_TIMELINE_OPTIONS,
): RaceHistory {
  const own = sessions.filter((session) => session.raceId === race.id).sort(compareCanonical);
  return replaySorted(race, own, options);
}

/**
 * The whole career: every race replayed, then one walk over every stint in
 * canonical order for the fields that depend on the stints of other races —
 * the career ordinal, the window cut at the previous stint whatever its race,
 * and the career running totals.
 *
 * A stint whose race is missing is skipped. Cascades make that impossible,
 * but a replay must never be the thing that fails.
 */
export function buildCareerTimeline(
  sessions: readonly TimelineSessionRow[],
  races: readonly TimelineRaceRow[],
  options: TimelineOptions = DEFAULT_TIMELINE_OPTIONS,
): CareerTimeline {
  const racesById = new Map<string, TimelineRaceRow>();
  for (const race of races) racesById.set(race.id, race);

  const ordered = sessions.filter((session) => racesById.has(session.raceId)).sort(compareCanonical);
  const byRace = new Map<string, TimelineSessionRow[]>();
  for (const session of ordered) {
    const list = byRace.get(session.raceId);
    if (list) list.push(session);
    else byRace.set(session.raceId, [session]);
  }

  const histories = new Map<string, MutableHistory>();
  for (const race of races) histories.set(race.id, replaySorted(race, byRace.get(race.id) ?? [], options));

  // Both orders are canonical, so the k-th stint of a race in the career walk
  // is the k-th stint of that race's own replay.
  const cursor = new Map<string, number>();
  const stints: MutableStint[] = [];
  let runningCredited = 0;
  let runningCoverage = 0;
  let previousWatchedAt: Date | null = null;

  for (const session of ordered) {
    const history = histories.get(session.raceId)!;
    const index = cursor.get(session.raceId) ?? 0;
    cursor.set(session.raceId, index + 1);
    const stint = history.stints[index]!;

    stint.ordinal = stints.length;
    stint.startsAt = previousWatchedAt !== null && previousWatchedAt > stint.nominalStartsAt
      ? previousWatchedAt
      : stint.nominalStartsAt;
    stint.windowReliable = isReliable(stint.startsAt, stint.watchedAt, stint.creditedSeconds, options.reliableWindowShare);
    stint.cumulativeCreditedBefore = runningCredited;
    stint.cumulativeCoverageBefore = runningCoverage;
    runningCredited += stint.creditedSeconds;
    runningCoverage += stint.addedCoverageSeconds;
    previousWatchedAt = stint.watchedAt;
    stints.push(stint);
  }

  for (const history of histories.values()) {
    history.startedAt = history.stints[0]?.startsAt ?? null;
  }

  return {
    stints,
    races: histories,
    racesById,
    totalCreditedSeconds: runningCredited,
  };
}

// ---------------------------------------------------------------------------
// Questions asked of a replay
// ---------------------------------------------------------------------------

/** A race's coverage after the last of its stints with `watchedAt ≤ at`. */
export function coverageAt(history: RaceHistory, at: Date): number {
  const stints = history.stints;
  const target = at.getTime();
  let low = 0;
  let high = stints.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (stints[middle]!.watchedAt.getTime() <= target) low = middle + 1;
    else high = middle;
  }
  return low === 0 ? 0 : stints[low - 1]!.coverageAfterSeconds;
}

function eventsWhere(
  timeline: CareerTimeline,
  happened: (stint: StintEvent) => boolean,
  include?: (race: TimelineRaceRow) => boolean,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const stint of timeline.stints) {
    if (!happened(stint)) continue;
    if (include) {
      const race = timeline.racesById.get(stint.raceId);
      if (!race || !include(race)) continue;
    }
    events.push({ at: stint.watchedAt, sessionId: stint.sessionId, raceId: stint.raceId, ordinal: stint.ordinal });
  }
  return events;
}

/** Every Story Complete, in canonical order. */
export function storyCompleteEvents(timeline: CareerTimeline, include?: (race: TimelineRaceRow) => boolean): TimelineEvent[] {
  return eventsWhere(timeline, (stint) => stint.completesStory, include);
}

/** Every race's first stint, in canonical order. */
export function raceStartEvents(timeline: CareerTimeline, include?: (race: TimelineRaceRow) => boolean): TimelineEvent[] {
  return eventsWhere(timeline, (stint) => stint.startsRace, include);
}

/** Every stint that made its race experienced, in canonical order. */
export function raceExperiencedEvents(timeline: CareerTimeline, include?: (race: TimelineRaceRow) => boolean): TimelineEvent[] {
  return eventsWhere(timeline, (stint) => stint.experiencesRace, include);
}

/** The n-th event (1-based), at the instant of its stint. */
export function nthEvent(events: readonly TimelineEvent[], n: number): InstantResult | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const event = events[n - 1];
  if (!event) return null;
  return { at: event.at, precision: 'STINT', sessionId: event.sessionId, raceId: event.raceId };
}

/**
 * When a running total first reached `thresholdSeconds`.
 *
 * The crossing stint is the one whose amount takes the total from below the
 * threshold to at or above it. Inside it the instant is interpolated along its
 * window, in proportion to how much of its amount was needed — unless its
 * window was cut too short by batch logging to say, in which case the stint's
 * own instant is used and the precision says so.
 *
 * With `within`, only the part of each window inside it counts, which is how a
 * calendar-year total is crossed inside the part of a stint in that year.
 */
export function cumulativeCrossing(
  stints: readonly StintEvent[],
  thresholdSeconds: number,
  amountOf: (stint: StintEvent) => number,
  within?: LocalWindow,
): InstantResult | null {
  let before = 0;
  for (const stint of stints) {
    const full = amountOf(stint);
    if (!(full > 0)) continue;

    let segmentStart = stint.startsAt;
    let segmentEnd = stint.watchedAt;
    let amount = full;
    if (within) {
      const clipped = clipToWindow(stint.startsAt, stint.watchedAt, within);
      if (!clipped) continue;
      segmentStart = clipped.startsAt;
      segmentEnd = clipped.endsAt;
      amount = full * clipped.fraction;
      if (!(amount > 0)) continue;
    }

    if (before < thresholdSeconds && thresholdSeconds <= before + amount) {
      if (!stint.windowReliable) {
        return { at: stint.watchedAt, precision: 'STINT', sessionId: stint.sessionId, raceId: stint.raceId };
      }
      const span = segmentEnd.getTime() - segmentStart.getTime();
      const at = span > 0
        ? new Date(segmentStart.getTime() + Math.round(((thresholdSeconds - before) / amount) * span))
        : segmentEnd;
      return { at, precision: 'INTERPOLATED', sessionId: stint.sessionId, raceId: stint.raceId };
    }
    before += amount;
  }
  return null;
}

/**
 * The stint after which a race's coverage first reached `percent` of its
 * runtime. Compared in integers, so 50% of a race is exactly half of it.
 */
export function coverageCrossing(history: RaceHistory, percent: number): { at: Date; sessionId: string } | null {
  const runtime = history.race.runtimeSec;
  if (!(runtime > 0)) return null;
  for (const stint of history.stints) {
    if (stint.coverageAfterSeconds * 100 >= percent * runtime) {
      return { at: stint.watchedAt, sessionId: stint.sessionId };
    }
  }
  return null;
}
