/**
 * Career metrics — the one place lifetime numbers are computed.
 *
 * Achievements, milestones, mastery nodes and the statistics pages all measure
 * themselves against this object, so a metric is defined exactly once and
 * every system agrees about it.
 *
 * Metric names used in configuration (`achievements.ts`, `milestones.ts`,
 * `MASTERY_CONFIG`) are keys of `CareerMetrics`.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { STORY_CONFIG } from '@/lib/config';

export interface CareerMetrics {
  // -- Time ----------------------------------------------------------------
  /** Real-world hours in front of the screen, including re-watches. */
  realHours: number;
  /** Unique race-timeline hours covered. Re-watching does not increase this. */
  timelineHours: number;
  /** Timeline hours played including re-watches, for the "time on screen" stat. */
  playedTimelineHours: number;

  // -- Races ---------------------------------------------------------------
  racesInLibrary: number;
  racesStarted: number;
  racesCompleted: number;
  storyCompletes: number;
  racesAbandoned: number;

  // -- Long races ----------------------------------------------------------
  stories8h: number;
  stories10h: number;
  stories12h: number;
  stories24h: number;
  majorEventStories: number;

  // -- Breadth -------------------------------------------------------------
  championships: number;
  championshipsCompleted: number;
  seasonsCompleted: number;
  seasonsStoryComplete: number;
  circuits: number;
  countries: number;
  distinctRaceTypesStoried: number;

  // -- Sessions ------------------------------------------------------------
  sessions: number;
  longestSessionHours: number;
  averageSessionMinutes: number;
  averagePlaybackSpeed: number;
  maxSessionsForOneStory: number;
  puristStories: number;

  // -- Career --------------------------------------------------------------
  level: number;
  prestige: number;
  careerXp: number;
  careerXpMillions: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lifetimeActiveDays: number;
  lifetimeActiveWeeks: number;

  // -- Systems -------------------------------------------------------------
  achievementsUnlocked: number;
  masteryNodesUnlocked: number;
  masteryTreesCompleted: number;
  seasonPassesCompleted: number;
  challengesCompleted: number;
  trophies: number;
  hallOfFameEntries: number;

  // -- Recurring events ----------------------------------------------------
  longestConsecutiveEditions: number;
  maxEditionsOfOneEvent: number;

  // -- Kind little counters ------------------------------------------------
  /** Times a race was picked back up after a break of 30+ days. */
  longBreakReturns: number;
}

const EMPTY: CareerMetrics = {
  realHours: 0, timelineHours: 0, playedTimelineHours: 0,
  racesInLibrary: 0, racesStarted: 0, racesCompleted: 0, storyCompletes: 0, racesAbandoned: 0,
  stories8h: 0, stories10h: 0, stories12h: 0, stories24h: 0, majorEventStories: 0,
  championships: 0, championshipsCompleted: 0, seasonsCompleted: 0, seasonsStoryComplete: 0,
  circuits: 0, countries: 0, distinctRaceTypesStoried: 0,
  sessions: 0, longestSessionHours: 0, averageSessionMinutes: 0, averagePlaybackSpeed: 1,
  maxSessionsForOneStory: 0, puristStories: 0,
  level: 1, prestige: 0, careerXp: 0, careerXpMillions: 0,
  currentStreakDays: 0, longestStreakDays: 0, lifetimeActiveDays: 0, lifetimeActiveWeeks: 0,
  achievementsUnlocked: 0, masteryNodesUnlocked: 0, masteryTreesCompleted: 0,
  seasonPassesCompleted: 0, challengesCompleted: 0, trophies: 0, hallOfFameEntries: 0,
  longestConsecutiveEditions: 0, maxEditionsOfOneEvent: 0, longBreakReturns: 0,
};

export function emptyMetrics(): CareerMetrics {
  return { ...EMPTY };
}

/**
 * Compute every lifetime metric for a user.
 *
 * Deliberately one pass over a handful of queries rather than a metric-per-
 * query fan-out: it runs after every session, and the numbers have to be
 * mutually consistent.
 *
 * `db` MUST be the active transaction client when this is called mid-session.
 * Reading through the global client inside an interactive transaction would
 * not see the session that was just written, and every achievement and
 * milestone would then be evaluated one session behind.
 */
export async function computeCareerMetrics(userId: string, db: Tx = prisma): Promise<CareerMetrics> {
  const [races, sessionAgg, sessions, profile, counts, seasons, masteryTrees, passes] =
    await Promise.all([
      db.race.findMany({
        where: { userId },
        select: {
          id: true, status: true, runtimeSec: true, coverageSec: true, realViewingSec: true,
          timelineWatchedSec: true, storyCompletedAt: true, completedAt: true, startedAt: true,
          isMajorEvent: true, iconicKey: true, circuitSlug: true, country: true, raceType: true,
          championshipId: true, seasonId: true, sessionCount: true, avgPlaybackSpeed: true,
          raceDate: true,
        },
      }),
      db.raceViewingSession.aggregate({
        where: { userId },
        _sum: { realSeconds: true, timelineSeconds: true },
        _max: { realSeconds: true },
        _count: true,
      }),
      db.raceViewingSession.findMany({
        where: { userId },
        select: { raceId: true, watchedAt: true, realSeconds: true },
        orderBy: { watchedAt: 'asc' },
      }),
      db.careerProfile.findUnique({ where: { userId } }),
      Promise.all([
        db.achievementProgress.count({ where: { userId, unlockedAt: { not: null } } }),
        db.masteryProgress.count({ where: { userId, unlockedAt: { not: null } } }),
        db.challengeProgress.count({ where: { challenge: { userId }, state: 'COMPLETED' } }),
        db.trophy.count({ where: { userId } }),
        db.hallOfFameEntry.count({ where: { userId } }),
        db.championship.count({ where: { userId } }),
      ]),
      db.championshipSeason.findMany({
        where: { championship: { userId } },
        select: {
          id: true, isComplete: true, plannedRaceCount: true, championshipId: true,
          races: { select: { storyCompletedAt: true, status: true } },
        },
      }),
      db.masteryTree.findMany({
        where: { userId },
        select: { id: true, nodes: { select: { id: true, progress: { where: { userId }, select: { unlockedAt: true } } } } },
      }),
      db.seasonPass.findMany({ where: { userId }, select: { tier: true } }),
    ]);

  const m = emptyMetrics();
  const [achievementsUnlocked, masteryNodesUnlocked, challengesCompleted, trophies, hofEntries, championshipCount] = counts;

  m.realHours = round1((sessionAgg._sum.realSeconds ?? 0) / 3600);
  m.playedTimelineHours = round1((sessionAgg._sum.timelineSeconds ?? 0) / 3600);
  m.sessions = sessionAgg._count;
  m.longestSessionHours = round2((sessionAgg._max.realSeconds ?? 0) / 3600);
  m.averageSessionMinutes = m.sessions === 0 ? 0 : round1((sessionAgg._sum.realSeconds ?? 0) / m.sessions / 60);
  m.averagePlaybackSpeed =
    (sessionAgg._sum.realSeconds ?? 0) > 0
      ? round2((sessionAgg._sum.timelineSeconds ?? 0) / (sessionAgg._sum.realSeconds ?? 1))
      : 1;

  const circuits = new Set<string>();
  const countries = new Set<string>();
  const storiedTypes = new Set<string>();
  const completedChampionships = new Set<string>();
  const editionsByEvent = new Map<string, number[]>();

  let timelineSec = 0;
  m.racesInLibrary = races.length;

  for (const race of races) {
    timelineSec += Math.min(race.coverageSec, race.runtimeSec);
    const storied = race.storyCompletedAt !== null;
    const completed = storied || race.status === 'COMPLETED';

    if (race.startedAt !== null) m.racesStarted += 1;
    if (race.status === 'ABANDONED') m.racesAbandoned += 1;
    if (completed) {
      m.racesCompleted += 1;
      if (race.circuitSlug) circuits.add(race.circuitSlug);
      if (race.country) countries.add(race.country.trim().toLowerCase());
      if (race.championshipId) completedChampionships.add(race.championshipId);
    }
    if (storied) {
      m.storyCompletes += 1;
      storiedTypes.add(race.raceType);
      const hours = race.runtimeSec / 3600;
      if (hours >= 7.5) m.stories8h += 1;
      if (hours >= 9.5) m.stories10h += 1;
      if (hours >= 11.5) m.stories12h += 1;
      if (hours >= 23) m.stories24h += 1;
      if (race.isMajorEvent) m.majorEventStories += 1;
      if (race.sessionCount > m.maxSessionsForOneStory) m.maxSessionsForOneStory = race.sessionCount;
      if (Math.abs(race.avgPlaybackSpeed - 1) < 0.02) m.puristStories += 1;
      if (race.iconicKey) {
        const year = race.raceDate?.getFullYear();
        const list = editionsByEvent.get(race.iconicKey) ?? [];
        if (year !== undefined) list.push(year);
        editionsByEvent.set(race.iconicKey, list);
      }
    }
  }

  m.timelineHours = round1(timelineSec / 3600);
  m.circuits = circuits.size;
  m.countries = countries.size;
  m.distinctRaceTypesStoried = storiedTypes.size;
  m.championships = championshipCount;
  m.championshipsCompleted = completedChampionships.size;

  for (const season of seasons) {
    const target = season.plannedRaceCount ?? season.races.length;
    if (target === 0) continue;
    const completedRaces = season.races.filter((r) => r.storyCompletedAt !== null || r.status === 'COMPLETED').length;
    const storiedRaces = season.races.filter((r) => r.storyCompletedAt !== null).length;
    if (completedRaces >= target) m.seasonsCompleted += 1;
    if (storiedRaces >= target) m.seasonsStoryComplete += 1;
  }

  for (const [, years] of editionsByEvent) {
    m.maxEditionsOfOneEvent = Math.max(m.maxEditionsOfOneEvent, years.length);
    m.longestConsecutiveEditions = Math.max(m.longestConsecutiveEditions, longestRun(years));
  }

  m.masteryNodesUnlocked = masteryNodesUnlocked;
  m.masteryTreesCompleted = masteryTrees.filter(
    (t) => t.nodes.length > 0 && t.nodes.every((n) => n.progress.some((p) => p.unlockedAt !== null)),
  ).length;
  m.achievementsUnlocked = achievementsUnlocked;
  m.challengesCompleted = challengesCompleted;
  m.trophies = trophies;
  m.hallOfFameEntries = hofEntries;
  m.seasonPassesCompleted = passes.filter((p) => p.tier >= 100).length;

  if (profile) {
    m.level = profile.level;
    m.prestige = profile.prestige;
    m.careerXp = Number(profile.careerXp);
    m.careerXpMillions = round2(m.careerXp / 1_000_000);
    m.currentStreakDays = profile.currentStreakDays;
    m.longestStreakDays = profile.longestStreakDays;
    m.lifetimeActiveDays = profile.lifetimeActiveDays;
    m.lifetimeActiveWeeks = profile.lifetimeActiveWeeks;
  }

  m.longBreakReturns = countLongBreakReturns(sessions);

  return m;
}

/** Longest run of consecutive integers in a list of years. */
export function longestRun(years: readonly number[]): number {
  const unique = [...new Set(years)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < unique.length; i += 1) {
    run = i > 0 && unique[i]! === unique[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * How many times a race was resumed after 30+ days away.
 *
 * Used only to unlock a warm, secret achievement. Nothing anywhere counts
 * breaks against the user.
 */
export function countLongBreakReturns(
  sessions: readonly { raceId: string; watchedAt: Date }[],
): number {
  const lastSeen = new Map<string, number>();
  let returns = 0;
  const THIRTY_DAYS = 30 * 24 * 3600 * 1000;
  for (const session of sessions) {
    const previous = lastSeen.get(session.raceId);
    const at = session.watchedAt.getTime();
    if (previous !== undefined && at - previous >= THIRTY_DAYS) returns += 1;
    lastSeen.set(session.raceId, at);
  }
  return returns;
}

/** Story Complete thresholds, exported so every engine agrees on them. */
export const STORY_THRESHOLDS = {
  coverageRatio: STORY_CONFIG.coverageRatio,
  maxUncoveredSeconds: STORY_CONFIG.maxUncoveredSeconds,
};

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
