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
import { MASTERY_SHAPE, STORY_CONFIG } from '@/lib/config';
import { creditedSeconds, isRaceExperienced } from '@/lib/domain/career-timeline';
import { editionIdentityOf, longestConsecutiveRun } from '@/lib/domain/edition';
import {
  loadTimelineSessions,
  TIMELINE_RACE_SELECT,
  toTimelineRaceRow,
  type TimelineInputs,
} from './career-timeline-engine';

export interface CareerMetrics {
  // -- Time ----------------------------------------------------------------
  /**
   * Real-world hours in front of the screen, including re-watches, credited
   * the way XP credits them: a stint played slower than 0.75× counts no more
   * than its timeline at 0.75× (`creditedSeconds`).
   */
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
  /**
   * Races experienced rather than glimpsed: ten credited minutes and a tenth
   * of the race (or an hour of it) covered — `isRaceExperienced`.
   */
  racesExperienced: number;

  // -- Long races ----------------------------------------------------------
  stories6h: number;
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
  /** The longest stint, in credited hours. */
  longestSessionHours: number;
  /** Credited minutes per stint. */
  averageSessionMinutes: number;
  /** Timeline played over real time spent: about playback, so not credited. */
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
  /** The longest run of consecutive years with a Story Complete edition, in one event. */
  longestConsecutiveEditions: number;
  /** The most Story Complete editions of one event. Two races of one year are one edition. */
  maxEditionsOfOneEvent: number;
  /** The most experienced editions of one event. */
  maxEditionsExperiencedOfOneEvent: number;

  // -- Kind little counters ------------------------------------------------
  /** Times a race was picked back up after a break of 30+ days. */
  longBreakReturns: number;
}

const EMPTY: CareerMetrics = {
  realHours: 0, timelineHours: 0, playedTimelineHours: 0,
  racesInLibrary: 0, racesStarted: 0, racesCompleted: 0, storyCompletes: 0, racesAbandoned: 0,
  racesExperienced: 0,
  stories6h: 0, stories8h: 0, stories10h: 0, stories12h: 0, stories24h: 0, majorEventStories: 0,
  championships: 0, championshipsCompleted: 0, seasonsCompleted: 0, seasonsStoryComplete: 0,
  circuits: 0, countries: 0, distinctRaceTypesStoried: 0,
  sessions: 0, longestSessionHours: 0, averageSessionMinutes: 0, averagePlaybackSpeed: 1,
  maxSessionsForOneStory: 0, puristStories: 0,
  level: 1, prestige: 0, careerXp: 0, careerXpMillions: 0,
  currentStreakDays: 0, longestStreakDays: 0, lifetimeActiveDays: 0, lifetimeActiveWeeks: 0,
  achievementsUnlocked: 0, masteryNodesUnlocked: 0, masteryTreesCompleted: 0,
  seasonPassesCompleted: 0, challengesCompleted: 0, trophies: 0, hallOfFameEntries: 0,
  longestConsecutiveEditions: 0, maxEditionsOfOneEvent: 0, maxEditionsExperiencedOfOneEvent: 0,
  longBreakReturns: 0,
};

export function emptyMetrics(): CareerMetrics {
  return { ...EMPTY };
}

/**
 * The race fields the metrics read, besides what the replay reads. One query
 * selects both (`computeCareerMetricsWithHistory`).
 */
const METRICS_RACE_SELECT = {
  status: true, coverageSec: true, storyCompletedAt: true, startedAt: true,
  sessionCount: true, avgPlaybackSpeed: true,
} as const;

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
  return (await computeCareerMetricsWithHistory(userId, db)).metrics;
}

/**
 * The lifetime metrics, and the career history they were computed from.
 *
 * The stint path needs both — the metrics for achievements and milestones,
 * the history for everything dated from the replay — and both come from the
 * same two reads: every stint, and every race with the union of the fields
 * the metrics and the replay need. Nothing is read twice.
 */
export async function computeCareerMetricsWithHistory(
  userId: string,
  db: Tx = prisma,
): Promise<{ metrics: CareerMetrics; history: TimelineInputs }> {
  const [raceRows, sessions, profile, counts, seasons, masteryTrees, passes] =
    await Promise.all([
      db.race.findMany({
        where: { userId },
        select: { ...TIMELINE_RACE_SELECT, ...METRICS_RACE_SELECT },
      }),
      loadTimelineSessions(db, userId),
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

  const races = raceRows.map((row) => ({ row, timeline: toTimelineRaceRow(row) }));
  const m = emptyMetrics();
  const [achievementsUnlocked, masteryNodesUnlocked, challengesCompleted, trophies, hofEntries, championshipCount] = counts;

  // Every hour figure is credited time, the way XP credits it. Playback speed
  // is the one exception: it is about how the timeline was played, so it keeps
  // real seconds.
  let credited = 0;
  let longest = 0;
  let real = 0;
  let timeline = 0;
  const creditedByRace = new Map<string, number>();
  for (const session of sessions) {
    const stint = creditedSeconds(session);
    credited += stint;
    longest = Math.max(longest, stint);
    real += session.realSeconds;
    timeline += session.timelineSeconds;
    creditedByRace.set(session.raceId, (creditedByRace.get(session.raceId) ?? 0) + stint);
  }

  m.realHours = round1(credited / 3600);
  m.playedTimelineHours = round1(timeline / 3600);
  m.sessions = sessions.length;
  m.longestSessionHours = round2(longest / 3600);
  m.averageSessionMinutes = m.sessions === 0 ? 0 : round1(credited / m.sessions / 60);
  m.averagePlaybackSpeed = real > 0 ? round2(timeline / real) : 1;

  const circuits = new Set<string>();
  const countries = new Set<string>();
  const storiedTypes = new Set<string>();
  const completedChampionships = new Set<string>();
  /** Per event: the distinct Story Complete editions, and the dated years among them. */
  const storiedEditions = new Map<string, { editions: Set<string>; years: number[] }>();
  /** Per event: the distinct experienced editions. */
  const experiencedEditions = new Map<string, Set<string>>();

  let timelineSec = 0;
  m.racesInLibrary = races.length;

  for (const { row: race, timeline: replayRow } of races) {
    const coverageSec = Math.min(race.coverageSec, race.runtimeSec);
    timelineSec += coverageSec;
    const storied = race.storyCompletedAt !== null;
    const completed = storied || race.status === 'COMPLETED';
    const experienced = isRaceExperienced({
      coverageSec,
      runtimeSec: race.runtimeSec,
      creditedSec: creditedByRace.get(race.id) ?? 0,
    });
    // Events are grouped the way the replay groups them, so a figure here and
    // the same figure on a history page can never disagree.
    const eventKey = replayRow.eventKey;
    const edition = editionIdentityOf(race.id, replayRow.editionYear);

    if (race.startedAt !== null) m.racesStarted += 1;
    if (race.status === 'ABANDONED') m.racesAbandoned += 1;
    if (experienced) {
      m.racesExperienced += 1;
      if (eventKey !== null) {
        const editions = experiencedEditions.get(eventKey) ?? new Set<string>();
        editions.add(edition);
        experiencedEditions.set(eventKey, editions);
      }
    }
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
      if (hours >= MASTERY_SHAPE.stories6hMinHours) m.stories6h += 1;
      if (hours >= MASTERY_SHAPE.stories8hMinHours) m.stories8h += 1;
      if (hours >= MASTERY_SHAPE.stories10hMinHours) m.stories10h += 1;
      if (hours >= MASTERY_SHAPE.stories12hMinHours) m.stories12h += 1;
      if (hours >= MASTERY_SHAPE.stories24hMinHours) m.stories24h += 1;
      if (race.isMajorEvent) m.majorEventStories += 1;
      if (race.sessionCount > m.maxSessionsForOneStory) m.maxSessionsForOneStory = race.sessionCount;
      if (Math.abs(race.avgPlaybackSpeed - 1) < 0.02) m.puristStories += 1;
      if (eventKey !== null) {
        const event = storiedEditions.get(eventKey) ?? { editions: new Set<string>(), years: [] };
        event.editions.add(edition);
        if (replayRow.editionYear !== null) event.years.push(replayRow.editionYear);
        storiedEditions.set(eventKey, event);
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

  for (const event of storiedEditions.values()) {
    m.maxEditionsOfOneEvent = Math.max(m.maxEditionsOfOneEvent, event.editions.size);
    m.longestConsecutiveEditions = Math.max(m.longestConsecutiveEditions, longestRun(event.years));
  }
  for (const editions of experiencedEditions.values()) {
    m.maxEditionsExperiencedOfOneEvent = Math.max(m.maxEditionsExperiencedOfOneEvent, editions.size);
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

  return { metrics: m, history: { sessions, races: races.map((race) => race.timeline) } };
}

/** Longest run of consecutive integers in a list of years. Repeats count once. */
export function longestRun(years: readonly number[]): number {
  return longestConsecutiveRun(years)?.length ?? 0;
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
