/**
 * Race Expeditions (0.4.0): the long races worth following as a journey.
 *
 * A race of 10 hours or more is an Expedition automatically, and any race can
 * be switched on or off by hand (owner decision 3). Being an Expedition is a
 * way of presenting a race — its checkpoints, its timeline, its summary — and
 * it works for a race of any length. Checkpoint XP is a separate question,
 * answered by the runtime alone: only races of six hours or more pay it.
 *
 * Checkpoints follow coverage, exactly as the Story Complete bonus does. Each
 * is keyed by race and percentage, with no amount in the key, so it is held at
 * most once however often it is crossed, and a re-balance can never pay one
 * twice.
 *
 * Pure. The strategist never imports this module, so it still cannot see XP.
 */

import { EXPEDITION_CONFIG, EXPEDITION_SHAPE } from '@/lib/config';
import type { RaceHistory } from './career-timeline';
import { coverageCrossing } from './career-timeline';
import { furthestPoint, gapsIn, resumePoint } from './intervals';
import { estimateRemaining } from './playback';
import { storyCompleteBonus } from './progression';
import { formatCoveragePercent } from './time';
import type { Interval } from './types';

/**
 * Whether a race is followed as an Expedition.
 *
 * Switched on is on and switched off is off, for any race. Otherwise it is
 * decided by the scheduled length, the race's advertised format, so a 10-hour
 * race shortened by a red flag is still one.
 */
export function isExpedition(race: { scheduledDurationSec: number; expeditionMode: boolean | null }): boolean {
  if (race.expeditionMode !== null) return race.expeditionMode;
  return race.scheduledDurationSec >= EXPEDITION_SHAPE.autoThresholdHours * 3600;
}

/** Whether a race's checkpoints pay XP: from six hours of runtime. */
export function checkpointsPayXp(runtimeSec: number): boolean {
  return runtimeSec >= EXPEDITION_SHAPE.checkpointXpMinimumHours * 3600;
}

/**
 * Each checkpoint and what it pays for a race of this runtime.
 *
 * The pool is a share of the race's non-major Story Complete bonus, split by
 * `EXPEDITION_CONFIG.checkpoints` and rounded to a clean step. Below six
 * hours every checkpoint is still listed, at 0 XP.
 */
export function checkpointSchedule(runtimeSec: number): { percent: number; xp: number }[] {
  const pays = checkpointsPayXp(runtimeSec);
  const pool = pays ? storyCompleteBonus(runtimeSec, false).careerXp * EXPEDITION_CONFIG.checkpointPoolShare : 0;
  const step = EXPEDITION_CONFIG.roundingStep;
  return EXPEDITION_CONFIG.checkpoints.map((checkpoint) => ({
    percent: checkpoint.percent,
    xp: pays ? Math.round((pool * checkpoint.poolShare) / step) * step : 0,
  }));
}

/**
 * The checkpoints a coverage figure has reached. Compared in integers, the same
 * way `coverageCrossing` dates them, so the two always agree.
 */
export function checkpointsSatisfied(coverageSec: number, runtimeSec: number): number[] {
  if (!(runtimeSec > 0)) return [];
  return EXPEDITION_CONFIG.checkpoints
    .map((checkpoint) => checkpoint.percent)
    .filter((percent) => coverageSec * 100 >= percent * runtimeSec);
}

/** The ledger key of one checkpoint of one race. No amount in it, on purpose. */
export function expeditionDedupeKey(raceId: string, percent: number): string {
  return `expedition:${raceId}:${percent}`;
}

export interface ExpeditionFigures {
  runtimeSec: number;
  coverageSec: number;
  /** `formatCoveragePercent`: never "100%" while any second is uncovered. */
  completionPercentText: string;
  remainingTimelineSec: number;
  /** The remaining timeline at the race's average speed so far. */
  remainingRealSec: number;
  resumeAtSec: number;
  creditedSeconds: number;
  rewatchSeconds: number;
  sessions: number;
  /** The window start of the first stint. */
  startedAt: Date | null;
  /** From the start to completion (or to now), never less than the time credited. */
  elapsedSeconds: number | null;
  storyCompletedAt: Date | null;
  checkpoints: { percent: number; xp: number; reachedAt: Date | null; sessionId: string | null; held: boolean }[];
  fragments: { watched: Interval[]; gaps: Interval[]; furthestSec: number };
}

/**
 * The live figures of an Expedition, from one race's replay.
 *
 * `held` lists the checkpoints whose XP the ledger holds for this race; the
 * replay alone cannot know that, and a checkpoint reached while Expedition
 * Mode was off is reached without being held.
 */
export function expeditionFigures(
  history: RaceHistory,
  avgSpeed: number,
  now: Date,
  held: ReadonlySet<number> = new Set(),
): ExpeditionFigures {
  const runtimeSec = history.race.runtimeSec;
  const coverageSec = history.coverageSeconds;
  const remaining = estimateRemaining(coverageSec, runtimeSec, avgSpeed);

  let elapsedSeconds: number | null = null;
  if (history.startedAt !== null) {
    const completing = history.completingSessionId === null
      ? null
      : history.stints.find((stint) => stint.sessionId === history.completingSessionId) ?? null;
    const end = history.storyCompletedAt ?? now;
    const credited = completing?.raceCreditedAfterSeconds ?? history.creditedSeconds;
    elapsedSeconds = Math.round(Math.max(0, (end.getTime() - history.startedAt.getTime()) / 1000, credited));
  }

  return {
    runtimeSec,
    coverageSec,
    completionPercentText: formatCoveragePercent(coverageSec, runtimeSec),
    remainingTimelineSec: remaining.timelineRemainingSec,
    remainingRealSec: remaining.realRemainingSec,
    resumeAtSec: resumePoint(history.intervals, runtimeSec),
    creditedSeconds: history.creditedSeconds,
    rewatchSeconds: history.rewatchCreditedSeconds,
    sessions: history.sessionCount,
    startedAt: history.startedAt,
    elapsedSeconds,
    storyCompletedAt: history.storyCompletedAt,
    checkpoints: checkpointSchedule(runtimeSec).map((checkpoint) => {
      const crossing = coverageCrossing(history, checkpoint.percent);
      return {
        percent: checkpoint.percent,
        xp: checkpoint.xp,
        reachedAt: crossing?.at ?? null,
        sessionId: crossing?.sessionId ?? null,
        held: held.has(checkpoint.percent),
      };
    }),
    fragments: {
      watched: history.intervals,
      gaps: gapsIn(history.intervals, runtimeSec),
      furthestSec: furthestPoint(history.intervals),
    },
  };
}
