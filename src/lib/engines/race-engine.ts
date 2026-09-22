/**
 * Race aggregates.
 *
 * `Race` carries denormalised counters so that list views and statistics do
 * not have to re-merge intervals for every row. Those counters are a CACHE.
 * This module is the only thing allowed to write them, and it always rebuilds
 * them from the two sources of truth:
 *
 *   * `WatchedInterval` — canonical merged timeline coverage
 *   * `RaceViewingSession` — raw, append-only real-world viewing history
 *
 * `scripts/recompute.ts` calls `recomputeAllRaces` to rebuild every race from
 * scratch, which is the safety net if a cache ever drifts.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { STORY_CONFIG } from '@/lib/config';
import { coverageSeconds, fromRows, furthestPoint, isStoryComplete } from '@/lib/domain/intervals';
import { averagePlaybackSpeed } from '@/lib/domain/playback';
import type { RaceStatus } from '@/lib/domain/types';

export interface RaceAggregates {
  coverageSec: number;
  realViewingSec: number;
  timelineWatchedSec: number;
  sessionCount: number;
  furthestTimestampSec: number;
  avgPlaybackSpeed: number;
  startedAt: Date | null;
  lastWatchedAt: Date | null;
  storyCompletedAt: Date | null;
  completedAt: Date | null;
  status: RaceStatus;
  /** True when this recompute is the moment the story became complete. */
  becameStoryComplete: boolean;
}

/**
 * Rebuild one race's cached aggregates from its intervals and sessions.
 *
 * Runs inside the caller's transaction so a session write and the aggregate it
 * implies can never be separated.
 *
 * PRECONDITION: `raceId` belongs to the account the caller is acting for. This
 * takes no user id on purpose — it is also called for a whole library at once
 * — so every caller must have established ownership first. Passing an
 * unchecked id from a form would let one account rewrite another's coverage.
 */
export async function recomputeRaceAggregates(
  tx: Tx,
  raceId: string,
  now: Date = new Date(),
): Promise<RaceAggregates> {
  const race = await tx.race.findUniqueOrThrow({
    where: { id: raceId },
    select: {
      id: true, runtimeSec: true, status: true, storyCompletedAt: true, completedAt: true,
      scheduledDurationSec: true, actualDurationSec: true,
    },
  });

  const [intervalRows, sessions] = await Promise.all([
    tx.watchedInterval.findMany({ where: { raceId }, select: { startSec: true, endSec: true } }),
    tx.raceViewingSession.findMany({
      where: { raceId },
      select: { realSeconds: true, timelineSeconds: true, watchedAt: true },
      orderBy: { watchedAt: 'asc' },
    }),
  ]);

  const runtimeSec = race.actualDurationSec ?? race.scheduledDurationSec;
  const intervals = fromRows(intervalRows);
  const coverageSec = Math.min(coverageSeconds(intervals), runtimeSec);
  const realViewingSec = sessions.reduce((sum, s) => sum + s.realSeconds, 0);
  const timelineWatchedSec = sessions.reduce((sum, s) => sum + s.timelineSeconds, 0);

  const storyComplete = isStoryComplete(intervals, runtimeSec, {
    coverageRatio: STORY_CONFIG.coverageRatio,
    maxUncoveredSeconds: STORY_CONFIG.maxUncoveredSeconds,
  });
  const becameStoryComplete = storyComplete && race.storyCompletedAt === null;

  const firstSession = sessions[0];
  const lastSession = sessions[sessions.length - 1];

  const storyCompletedAt = storyComplete ? (race.storyCompletedAt ?? now) : null;
  const completedAt = storyComplete
    ? (race.completedAt ?? storyCompletedAt ?? now)
    : race.completedAt;

  const status = deriveStatus(race.status, {
    hasSessions: sessions.length > 0,
    storyComplete,
    coverageSec,
    runtimeSec,
  });

  const aggregates: RaceAggregates = {
    coverageSec,
    realViewingSec,
    timelineWatchedSec,
    sessionCount: sessions.length,
    furthestTimestampSec: Math.min(furthestPoint(intervals), runtimeSec),
    avgPlaybackSpeed: averagePlaybackSpeed(sessions),
    startedAt: firstSession?.watchedAt ?? null,
    lastWatchedAt: lastSession?.watchedAt ?? null,
    storyCompletedAt,
    completedAt,
    status,
    becameStoryComplete,
  };

  await tx.race.update({
    where: { id: raceId },
    data: {
      runtimeSec,
      coverageSec: aggregates.coverageSec,
      realViewingSec: aggregates.realViewingSec,
      timelineWatchedSec: aggregates.timelineWatchedSec,
      sessionCount: aggregates.sessionCount,
      furthestTimestampSec: aggregates.furthestTimestampSec,
      avgPlaybackSpeed: aggregates.avgPlaybackSpeed,
      startedAt: aggregates.startedAt,
      lastWatchedAt: aggregates.lastWatchedAt,
      storyCompletedAt: aggregates.storyCompletedAt,
      completedAt: aggregates.completedAt,
      status: aggregates.status,
    },
  });

  return aggregates;
}

/**
 * Derive a race's status from its progress.
 *
 * Statuses the user set deliberately (ARCHIVED, ABANDONED, QUEUED) are
 * respected — the engine never overrides an explicit choice except to record
 * that a story finished.
 */
export function deriveStatus(
  current: RaceStatus,
  facts: { hasSessions: boolean; storyComplete: boolean; coverageSec: number; runtimeSec: number },
): RaceStatus {
  if (facts.storyComplete) return 'COMPLETED';
  if (current === 'ARCHIVED' || current === 'ABANDONED') return current;
  if (!facts.hasSessions) return current === 'QUEUED' ? 'QUEUED' : 'UNWATCHED';
  if (current === 'PAUSED') return 'PAUSED';
  if (current === 'COMPLETED' && facts.coverageSec < facts.runtimeSec) {
    // Coverage was removed (a session was deleted); fall back to in-progress
    // rather than silently claiming the race is still finished.
    return 'WATCHING';
  }
  return 'WATCHING';
}

/** Rebuild every race. The maintenance escape hatch for cache drift. */
export async function recomputeAllRaces(userId: string, now: Date = new Date()): Promise<number> {
  const races = await prisma.race.findMany({ where: { userId }, select: { id: true } });
  for (const race of races) {
    await prisma.$transaction((tx) => recomputeRaceAggregates(tx as Tx, race.id, now));
  }
  return races.length;
}

/** Normalise a circuit name into a stable key for "distinct circuits" counts. */
export function circuitSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? null : slug;
}
