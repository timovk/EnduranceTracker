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
 * `WatchedInterval` is itself derived from the sessions, and
 * `rebuildRaceIntervals` rebuilds it. `db:recompute` (`src/lib/server/recompute.ts`)
 * runs both for every race, which is the safety net if a cache ever drifts.
 */

import type { Tx } from '@/lib/db/client';
import { STORY_CONFIG } from '@/lib/config';
import { creditedSeconds } from '@/lib/domain/career-timeline';
import {
  addInterval, coverageSeconds, furthestPoint, isStoryComplete, mergeIntervals, normalizeInterval,
} from '@/lib/domain/intervals';
import { averagePlaybackSpeed } from '@/lib/domain/playback';
import type { Interval, RaceStatus } from '@/lib/domain/types';

export interface RaceAggregates {
  coverageSec: number;
  realViewingSec: number;
  /**
   * Real seconds credited over the race's stints (0.4.0): real time, but never
   * more than the timeline at the slowest speed XP credits. Every hour figure
   * in 0.4.0 is built from it (`creditedSeconds` in `domain/career-timeline`).
   */
  creditedViewingSec: number;
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

/** The runtime every aggregate is measured against: the actual length when the race ran short, else the scheduled one. */
function runtimeOf(race: { actualDurationSec: number | null; scheduledDurationSec: number }): number {
  return race.actualDurationSec ?? race.scheduledDurationSec;
}

/**
 * Rebuild one race's merged coverage from its stints.
 *
 * `WatchedInterval` is derived: the stints are replayed in canonical order
 * (`watchedAt`, then `createdAt`, then `id`) with the same `addInterval`, gap
 * tolerance and runtime limit the stint path uses, and the result replaces the
 * stored set. Timeline past the race's current runtime is not coverage, so a
 * runtime that was shortened no longer leaves intervals running past the end.
 *
 * The rows carry no `sessionId`: after a rebuild no single stint owns a merged
 * stretch. Returns the rebuilt set.
 *
 * Same PRECONDITION as `recomputeRaceAggregates`: the caller has established
 * that `raceId` belongs to the account it is acting for.
 */
export async function rebuildRaceIntervals(tx: Tx, raceId: string): Promise<Interval[]> {
  const [race, sessions] = await Promise.all([
    tx.race.findUniqueOrThrow({
      where: { id: raceId },
      select: { scheduledDurationSec: true, actualDurationSec: true },
    }),
    tx.raceViewingSession.findMany({
      where: { raceId },
      select: { startTimestampSec: true, endTimestampSec: true },
      orderBy: [{ watchedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const limit = runtimeOf(race);
  let rebuilt: Interval[] = [];
  for (const session of sessions) {
    rebuilt = addInterval(rebuilt, { start: session.startTimestampSec, end: session.endTimestampSec }, {
      limit,
      gapTolerance: STORY_CONFIG.gapToleranceSeconds,
    }).intervals;
  }

  await tx.watchedInterval.deleteMany({ where: { raceId } });
  if (rebuilt.length > 0) {
    await tx.watchedInterval.createMany({
      data: rebuilt.map((interval) => ({ raceId, startSec: interval.start, endSec: interval.end })),
    });
  }
  return rebuilt;
}

/**
 * Rebuild one race's cached aggregates from its intervals and sessions.
 *
 * Runs inside the caller's transaction so a session write and the aggregate it
 * implies can never be separated.
 *
 * The stored intervals are clamped to the runtime before anything is measured.
 * A race whose runtime was shortened under 0.3.x can still hold intervals past
 * its new end, and counting them would call a race with a gap in it complete.
 *
 * `preserveStatus` writes the status and `completedAt` back unchanged. Only the
 * 0.4.0 upgrade's repair of such a race uses it: the repair corrects the
 * coverage, and must not also overrule a status the user chose.
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
  options: { preserveStatus?: boolean } = {},
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
      orderBy: [{ watchedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const runtimeSec = runtimeOf(race);
  const intervals = mergeIntervals(
    intervalRows
      .map((row) => normalizeInterval({ start: row.startSec, end: row.endSec }, runtimeSec))
      .filter((interval): interval is Interval => interval !== null),
  );
  const coverageSec = coverageSeconds(intervals);
  const realViewingSec = sessions.reduce((sum, s) => sum + s.realSeconds, 0);
  const creditedViewingSec = sessions.reduce((sum, s) => sum + creditedSeconds(s), 0);
  const timelineWatchedSec = sessions.reduce((sum, s) => sum + s.timelineSeconds, 0);

  const storyComplete = isStoryComplete(intervals, runtimeSec, {
    coverageRatio: STORY_CONFIG.coverageRatio,
    maxUncoveredSeconds: STORY_CONFIG.maxUncoveredSeconds,
  });
  const becameStoryComplete = storyComplete && race.storyCompletedAt === null;

  const firstSession = sessions[0];
  const lastSession = sessions[sessions.length - 1];

  const storyCompletedAt = storyComplete ? (race.storyCompletedAt ?? now) : null;
  const completedAt = options.preserveStatus
    ? race.completedAt
    : storyComplete
      ? (race.completedAt ?? storyCompletedAt ?? now)
      : race.completedAt;

  const status = options.preserveStatus
    ? race.status
    : deriveStatus(race.status, {
        hasSessions: sessions.length > 0,
        storyComplete,
        coverageSec,
        runtimeSec,
      });

  const aggregates: RaceAggregates = {
    coverageSec,
    realViewingSec,
    creditedViewingSec,
    timelineWatchedSec,
    sessionCount: sessions.length,
    furthestTimestampSec: furthestPoint(intervals),
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
      creditedViewingSec: aggregates.creditedViewingSec,
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
