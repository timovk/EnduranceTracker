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
import { coverageSeconds, fromRows, gapsIn, resumePoint } from '@/lib/domain/intervals';
import { estimateRemaining } from '@/lib/domain/playback';
import type { Interval, RacePriority, RaceStatus, RaceType } from '@/lib/domain/types';
import type { RaceCardData } from '@/components/races/race-card';

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
  status: true, priority: true, excitement: true, isMajorEvent: true, iconicKey: true,
  raceType: true, notes: true, replayUrl: true, posterUrl: true,
  startedAt: true, completedAt: true, lastWatchedAt: true, storyCompletedAt: true,
  championship: { select: { id: true, name: true, shortName: true, accentColor: true } },
  season: { select: { id: true, year: true, label: true, plannedRaceCount: true } },
  intervals: { select: { startSec: true, endSec: true }, orderBy: { startSec: 'asc' } },
} satisfies Prisma.RaceSelect;

/** The race select plus its full session history, for the race detail page. */
const RACE_DETAIL_SELECT = {
  ...RACE_SELECT,
  sessions: {
    select: {
      id: true, startTimestampSec: true, endTimestampSec: true, playbackSpeed: true,
      timelineSeconds: true, realSeconds: true, newCoverageSeconds: true,
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
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' as const } },
              { circuit: { contains: filter.search, mode: 'insensitive' as const } },
              { country: { contains: filter.search, mode: 'insensitive' as const } },
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
  notes: string | null;
  replayUrl: string | null;
  posterUrl: string | null;

  intervals: Interval[];
  gaps: Interval[];
  coverageSec: number;
  coveragePercent: number;
  realViewingSec: number;
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

  sessions: {
    id: string;
    startTimestampSec: number;
    endTimestampSec: number;
    playbackSpeed: number;
    timelineSeconds: number;
    realSeconds: number;
    newCoverageSeconds: number;
    coverageBeforeSec: number;
    coverageAfterSec: number;
    careerXpAwarded: number;
    watchedAt: Date;
    note: string | null;
  }[];
}

export async function getRaceDetail(userId: string, raceId: string): Promise<RaceDetail | null> {
  const race = await prisma.race.findFirst({
    where: { id: raceId, userId },
    select: RACE_DETAIL_SELECT,
  });

  if (!race) return null;

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
    notes: race.notes,
    replayUrl: race.replayUrl,
    posterUrl: race.posterUrl,

    intervals,
    gaps: gapsIn(intervals, race.runtimeSec),
    coverageSec: coverage,
    coveragePercent: estimate.completionPercent,
    realViewingSec: race.realViewingSec,
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

    sessions: race.sessions,
  };
}

/** The race the dashboard shows as "current stint". */
export async function getCurrentStint(userId: string) {
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

/** Distinct iconic-event keys already in use, for the Add Race suggestions. */
export async function getIconicKeysInUse(userId: string): Promise<{ key: string; count: number }[]> {
  const rows = await prisma.race.groupBy({
    by: ['iconicKey'],
    where: { userId, iconicKey: { not: null } },
    _count: true,
  });
  return rows
    .filter((r): r is typeof r & { iconicKey: string } => r.iconicKey !== null)
    .map((r) => ({ key: r.iconicKey, count: r._count }))
    .sort((a, b) => b.count - a.count);
}

export const STORY_COMPLETE_THRESHOLDS = STORY_CONFIG;
