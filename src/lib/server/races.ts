/**
 * Race library data access.
 *
 * Read helpers used by the race pages and by the dashboard. Writes live in
 * `src/lib/server/actions.ts`; the session write path lives in the session
 * engine, which is the only thing allowed to touch coverage.
 */

import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/client';
import { STORY_CONFIG } from '@/lib/config';
import { creditedSeconds, replayRace } from '@/lib/domain/career-timeline';
import { editionIdentity, editionYear } from '@/lib/domain/edition';
import {
  checkpointsPayXp, checkpointTicks, isExpedition, nextCheckpoint,
} from '@/lib/domain/expedition';
import { formatCoveragePercent } from '@/lib/domain/time';
import { coverageSeconds, fromRows, gapsIn, resumePoint } from '@/lib/domain/intervals';
import { estimateRemaining } from '@/lib/domain/playback';
import type { Interval, RacePriority, RaceStatus, RaceType } from '@/lib/domain/types';
import { eventDisplayName, eventHref } from '@/lib/engines/mastery-engine';
import { loadRaceTimelineInputs } from '@/lib/engines/career-timeline-engine';
import {
  expeditionModeOf, getExpeditionSummaryForRace, type ExpeditionModeSetting, type ExpeditionSummaryView,
} from '@/lib/engines/expedition-engine';
import type { RaceCardData } from '@/components/races/race-card';
import type { CurrentStintData } from '@/components/dashboard/current-stint';

export interface RaceFilter {
  status?: RaceStatus[];
  championshipId?: string;
  seasonId?: string;
  raceType?: RaceType;
  search?: string;
  majorOnly?: boolean;
  storyCompleteOnly?: boolean;
  unfinishedOnly?: boolean;
  sort?: 'recent' | 'date' | 'name' | 'progress' | 'duration' | 'priority';
}

/** Included on every race read so the timeline bar can be drawn. */
const RACE_SELECT = {
  id: true, name: true, circuit: true, country: true, raceDate: true,
  runtimeSec: true, scheduledDurationSec: true, actualDurationSec: true,
  coverageSec: true, realViewingSec: true, timelineWatchedSec: true,
  sessionCount: true, furthestTimestampSec: true, avgPlaybackSpeed: true,
  status: true, priority: true, excitement: true, isMajorEvent: true, iconicKey: true, expeditionMode: true,
  raceType: true, notes: true, replayUrl: true, posterUrl: true,
  startedAt: true, completedAt: true, lastWatchedAt: true, storyCompletedAt: true,
  championship: { select: { id: true, name: true, shortName: true, accentColor: true } },
  season: { select: { id: true, year: true, label: true, plannedRaceCount: true } },
  intervals: { select: { startSec: true, endSec: true }, orderBy: { startSec: 'asc' } },
} satisfies Prisma.RaceSelect;

/** The race select plus its full session history, for the race detail page. */
const RACE_DETAIL_SELECT = {
  ...RACE_SELECT,
  creditedViewingSec: true,
  raceMastery: { select: { key: true, name: true, displayName: true } },
  sessions: {
    select: {
      id: true, startTimestampSec: true, endTimestampSec: true, playbackSpeed: true,
      timelineSeconds: true, realSeconds: true,
      coverageBeforeSec: true, coverageAfterSec: true, careerXpAwarded: true,
      watchedAt: true, note: true,
    },
    orderBy: { watchedAt: 'desc' },
  },
} satisfies Prisma.RaceSelect;

export async function listRaces(userId: string, filter: RaceFilter = {}): Promise<RaceCardData[]> {
  const races = await prisma.race.findMany({
    where: {
      userId,
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.championshipId ? { championshipId: filter.championshipId } : {}),
      ...(filter.seasonId ? { seasonId: filter.seasonId } : {}),
      ...(filter.raceType ? { raceType: filter.raceType } : {}),
      ...(filter.majorOnly ? { isMajorEvent: true } : {}),
      ...(filter.storyCompleteOnly ? { storyCompletedAt: { not: null } } : {}),
      ...(filter.unfinishedOnly ? { storyCompletedAt: null, status: { notIn: ['ARCHIVED', 'ABANDONED'] } } : {}),
      // SQLite has no `mode: 'insensitive'`, but its LIKE is already
      // case-insensitive for ASCII, which is what `contains` compiles to. So
      // searching for "fuji" still finds "6 Hours of Fuji".
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search } },
              { circuit: { contains: filter.search } },
              { country: { contains: filter.search } },
            ],
          }
        : {}),
    },
    select: RACE_SELECT,
    orderBy: orderFor(filter.sort),
  });

  return races.map(toCardData);
}

function orderFor(sort: RaceFilter['sort']) {
  switch (sort) {
    case 'date': return [{ raceDate: 'desc' as const }, { name: 'asc' as const }];
    case 'name': return [{ name: 'asc' as const }];
    case 'progress': return [{ coverageSec: 'desc' as const }];
    case 'duration': return [{ runtimeSec: 'desc' as const }];
    case 'priority': return [{ priority: 'desc' as const }, { excitement: 'desc' as const }];
    case 'recent':
    default:
      return [{ lastWatchedAt: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];
  }
}

type RaceRow = Prisma.RaceGetPayload<{ select: typeof RACE_SELECT }>;

function toCardData(race: RaceRow): RaceCardData {
  return {
    id: race.id,
    name: race.name,
    championshipName: race.championship?.shortName ?? race.championship?.name ?? null,
    championshipColor: race.championship?.accentColor ?? null,
    seasonYear: race.season?.year ?? null,
    circuit: race.circuit,
    country: race.country,
    raceDate: race.raceDate?.toISOString() ?? null,
    runtimeSec: race.runtimeSec,
    coverageSec: race.coverageSec,
    realViewingSec: race.realViewingSec,
    sessionCount: race.sessionCount,
    status: race.status as RaceStatus,
    priority: race.priority as RacePriority,
    excitement: race.excitement,
    isMajorEvent: race.isMajorEvent,
    isExpedition: isExpedition(race),
    storyComplete: race.storyCompletedAt !== null,
    intervals: race.intervals.map((i) => ({ start: i.startSec, end: i.endSec })),
  };
}

export interface RaceDetail {
  id: string;
  name: string;
  championship: { id: string; name: string; shortName: string | null; accentColor: string } | null;
  season: { id: string; year: number; label: string | null } | null;
  circuit: string | null;
  country: string | null;
  raceDate: Date | null;
  raceType: RaceType;
  runtimeSec: number;
  scheduledDurationSec: number;
  actualDurationSec: number | null;
  status: RaceStatus;
  priority: RacePriority;
  excitement: number;
  isMajorEvent: boolean;
  iconicKey: string | null;
  /**
   * The recurring event this race is an edition of (0.4.0): its key, the
   * name the user sees and the edition's year. Null when it is in none.
   */
  event: { key: string; name: string; editionYear: number | null; href: string } | null;
  notes: string | null;
  replayUrl: string | null;
  posterUrl: string | null;

  intervals: Interval[];
  gaps: Interval[];
  coverageSec: number;
  coveragePercent: number;
  realViewingSec: number;
  /**
   * Real viewing credited the way XP credits it (0.4.0): the race's "Real
   * viewing" figure, so it agrees with every other hour figure. Null only
   * until the 0.4.0 upgrade has filled it.
   */
  creditedViewingSec: number | null;
  timelineWatchedSec: number;
  sessionCount: number;
  avgPlaybackSpeed: number;
  furthestTimestampSec: number;
  resumeAtSec: number;
  timelineRemainingSec: number;
  realRemainingSec: number;
  storyComplete: boolean;
  /** How much timeline is still missing before the story is complete. */
  uncoveredSec: number;

  startedAt: Date | null;
  completedAt: Date | null;
  lastWatchedAt: Date | null;
  storyCompletedAt: Date | null;

  /**
   * The race as an Expedition (0.4.0), from its replay: the mode it is set
   * to, whether it is one, and where its coverage stands against the
   * checkpoints. Every race has it, because any race can be followed as one.
   */
  expedition: {
    mode: ExpeditionModeSetting;
    isExpedition: boolean;
    checkpointsPayXp: boolean;
    coverageSec: number;
    completionText: string;
    ticks: { percent: number; reached: boolean }[];
    nextCheckpoint: { percent: number; xp: number } | null;
    summary: ExpeditionSummaryView | null;
  };

  sessions: {
    id: string;
    startTimestampSec: number;
    endTimestampSec: number;
    playbackSpeed: number;
    timelineSeconds: number;
    realSeconds: number;
    /**
     * The stint's real time credited the way XP credits it (0.4.0): what its
     * row shows as "Real viewing", so the rows add up to the race's figure.
     */
    creditedSeconds: number;
    /**
     * Timeline this stint saw for the first time, from the race's replay
     * (0.4.0): right after an earlier stint is deleted, where the snapshot
     * taken when it was logged would not be.
     */
    newCoverageSeconds: number;
    coverageBeforeSec: number;
    coverageAfterSec: number;
    careerXpAwarded: number;
    watchedAt: Date;
    note: string | null;
  }[];
}

export async function getRaceDetail(userId: string, raceId: string): Promise<RaceDetail | null> {
  const [race, inputs, summary] = await Promise.all([
    prisma.race.findFirst({
      where: { id: raceId, userId },
      select: RACE_DETAIL_SELECT,
    }),
    loadRaceTimelineInputs(prisma, userId, raceId),
    getExpeditionSummaryForRace(userId, raceId),
  ]);

  if (!race || !inputs) return null;

  // The race's own replay: what each stint added, and the coverage the
  // Expedition's checkpoints are measured on.
  const history = replayRace(inputs.race, inputs.sessions);
  const added = new Map(history.stints.map((stint) => [stint.sessionId, stint.addedCoverageSeconds]));

  const intervals = fromRows(race.intervals);
  const coverage = Math.min(coverageSeconds(intervals), race.runtimeSec);
  const speed = race.avgPlaybackSpeed > 0 ? race.avgPlaybackSpeed : 1;
  const estimate = estimateRemaining(coverage, race.runtimeSec, speed);

  return {
    id: race.id,
    name: race.name,
    championship: race.championship,
    season: race.season ? { id: race.season.id, year: race.season.year, label: race.season.label } : null,
    circuit: race.circuit,
    country: race.country,
    raceDate: race.raceDate,
    raceType: race.raceType as RaceType,
    runtimeSec: race.runtimeSec,
    scheduledDurationSec: race.scheduledDurationSec,
    actualDurationSec: race.actualDurationSec,
    status: race.status as RaceStatus,
    priority: race.priority as RacePriority,
    excitement: race.excitement,
    isMajorEvent: race.isMajorEvent,
    iconicKey: race.iconicKey,
    event: race.iconicKey === null
      ? null
      : {
        key: race.iconicKey,
        // The link names the event once it exists; until the next recompute
        // links a key typed by hand, the name is the one derived from the key.
        name: race.raceMastery !== null && race.raceMastery.key === race.iconicKey
          ? (race.raceMastery.displayName ?? race.raceMastery.name)
          : eventDisplayName(race.iconicKey),
        editionYear: editionYear({ raceDate: race.raceDate, seasonYear: race.season?.year ?? null }),
        href: eventHref(race.iconicKey),
      },
    notes: race.notes,
    replayUrl: race.replayUrl,
    posterUrl: race.posterUrl,

    intervals,
    gaps: gapsIn(intervals, race.runtimeSec),
    coverageSec: coverage,
    coveragePercent: estimate.completionPercent,
    realViewingSec: race.realViewingSec,
    creditedViewingSec: race.creditedViewingSec,
    timelineWatchedSec: race.timelineWatchedSec,
    sessionCount: race.sessionCount,
    avgPlaybackSpeed: speed,
    furthestTimestampSec: race.furthestTimestampSec,
    resumeAtSec: resumePoint(intervals, race.runtimeSec),
    timelineRemainingSec: estimate.timelineRemainingSec,
    realRemainingSec: estimate.realRemainingSec,
    storyComplete: race.storyCompletedAt !== null,
    uncoveredSec: Math.max(0, race.runtimeSec - coverage),

    startedAt: race.startedAt,
    completedAt: race.completedAt,
    lastWatchedAt: race.lastWatchedAt,
    storyCompletedAt: race.storyCompletedAt,

    expedition: {
      mode: expeditionModeOf(race.expeditionMode),
      isExpedition: isExpedition(race),
      checkpointsPayXp: checkpointsPayXp(race.runtimeSec),
      coverageSec: history.coverageSeconds,
      completionText: formatCoveragePercent(history.coverageSeconds, race.runtimeSec),
      ticks: checkpointTicks(history.coverageSeconds, race.runtimeSec),
      nextCheckpoint: nextCheckpoint(history.coverageSeconds, race.runtimeSec),
      summary,
    },

    sessions: race.sessions.map((session) => ({
      ...session,
      creditedSeconds: creditedSeconds(session),
      newCoverageSeconds: added.get(session.id) ?? 0,
    })),
  };
}

/** The race the dashboard shows as "current stint". */
export async function getCurrentStint(userId: string): Promise<CurrentStintData | null> {
  const race = await prisma.race.findFirst({
    where: {
      userId,
      storyCompletedAt: null,
      coverageSec: { gt: 0 },
      status: { notIn: ['ARCHIVED', 'ABANDONED'] },
    },
    select: RACE_SELECT,
    orderBy: [{ lastWatchedAt: { sort: 'desc', nulls: 'last' } }],
  });

  if (!race) return null;

  const intervals = fromRows(race.intervals);
  const coverage = Math.min(coverageSeconds(intervals), race.runtimeSec);
  const speed = race.avgPlaybackSpeed > 0 ? race.avgPlaybackSpeed : 1;
  const estimate = estimateRemaining(coverage, race.runtimeSec, speed);

  return {
    raceId: race.id,
    raceName: race.name,
    championshipName: race.championship?.name ?? null,
    championshipColor: race.championship?.accentColor ?? null,
    runtimeSec: race.runtimeSec,
    coverageSec: coverage,
    intervals,
    resumeAtSec: resumePoint(intervals, race.runtimeSec),
    completionPercent: estimate.completionPercent,
    realRemainingSec: estimate.realRemainingSec,
    playbackSpeed: Math.round(speed * 100) / 100,
    // One line when the race is followed as an Expedition: how far, and
    // which checkpoint is next (null once all five are behind it).
    expedition: isExpedition(race)
      ? {
        completionText: formatCoveragePercent(coverage, race.runtimeSec),
        nextCheckpointPercent: nextCheckpoint(coverage, race.runtimeSec)?.percent ?? null,
      }
      : null,
  };
}

/** Championships and their seasons, for the Add Race form and filters. */
export async function getChampionshipOptions(userId: string) {
  return prisma.championship.findMany({
    where: { userId },
    select: {
      id: true, name: true, shortName: true, accentColor: true, slug: true, isCustom: true,
      seasons: {
        select: { id: true, year: true, label: true, plannedRaceCount: true, _count: { select: { races: true } } },
        orderBy: { year: 'desc' },
      },
      _count: { select: { races: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

/** One of the account's recurring events, for the race forms' event list. */
export interface EventOption {
  key: string;
  name: string;
  /** Editions of it in the library: races, with two of one year counted once. */
  editions: number;
}

/**
 * The account's active events (neither archived nor merged), by name, for the
 * "Recurring event" list of the race forms and the Events page's merge
 * dialog.
 */
export async function getEventOptions(userId: string): Promise<EventOption[]> {
  const [events, races] = await Promise.all([
    prisma.raceMastery.findMany({
      where: { userId, archivedAt: null, mergedIntoId: null },
      select: { key: true, name: true, displayName: true },
    }),
    prisma.race.findMany({
      where: { userId, iconicKey: { not: null } },
      select: { id: true, iconicKey: true, raceDate: true, season: { select: { year: true } } },
    }),
  ]);

  const editions = new Map<string, Set<string>>();
  for (const race of races) {
    if (race.iconicKey === null) continue;
    const identity = editionIdentity({ id: race.id, raceDate: race.raceDate, seasonYear: race.season?.year ?? null });
    const set = editions.get(race.iconicKey) ?? new Set<string>();
    set.add(identity);
    editions.set(race.iconicKey, set);
  }

  return events
    .map((event) => ({ key: event.key, name: event.displayName ?? event.name, editions: editions.get(event.key)?.size ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export const STORY_COMPLETE_THRESHOLDS = STORY_CONFIG;
