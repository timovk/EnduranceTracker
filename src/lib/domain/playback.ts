/**
 * Real-world time versus race-timeline time.
 *
 * A six-hour race watched at 1.5x costs four real hours. Four hours is what
 * comes out of the viewing budget; six hours is what the race timeline
 * records. The application never conflates the two, and this module is where
 * the conversion lives.
 */

/** Playback speeds offered in the UI. Any positive value is accepted. */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export const MIN_PLAYBACK_SPEED = 0.1;
export const MAX_PLAYBACK_SPEED = 8;

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, speed));
}

/** Wall-clock seconds needed to play `timelineSeconds` at `speed`. */
export function realSecondsFor(timelineSeconds: number, speed: number): number {
  return Math.round(Math.max(0, timelineSeconds) / clampSpeed(speed));
}

/** Timeline seconds advanced by spending `realSeconds` at `speed`. */
export function timelineSecondsFor(realSeconds: number, speed: number): number {
  return Math.round(Math.max(0, realSeconds) * clampSpeed(speed));
}

/**
 * Weighted average playback speed across sessions.
 *
 * Weighted by timeline seconds, not by session count, so a two-minute stint at
 * 3x does not drag the average of a six-hour race.
 */
export function averagePlaybackSpeed(
  sessions: readonly { timelineSeconds: number; realSeconds: number }[],
): number {
  const timeline = sessions.reduce((sum, s) => sum + Math.max(0, s.timelineSeconds), 0);
  const real = sessions.reduce((sum, s) => sum + Math.max(0, s.realSeconds), 0);
  if (real <= 0 || timeline <= 0) return 1;
  return Math.round((timeline / real) * 1000) / 1000;
}

/**
 * Everything the race detail view needs to answer "where am I and what is
 * left", given coverage and a chosen playback speed.
 */
export interface RemainingEstimate {
  /** Unique timeline seconds still unwatched. */
  timelineRemainingSec: number;
  /** Wall-clock seconds that will cost at the given speed. */
  realRemainingSec: number;
  /** Coverage as a percentage, 0-100, rounded to one decimal. */
  completionPercent: number;
}

export function estimateRemaining(
  coverageSec: number,
  runtimeSec: number,
  speed: number,
): RemainingEstimate {
  const safeRuntime = Math.max(0, runtimeSec);
  const covered = Math.min(Math.max(0, coverageSec), safeRuntime);
  const timelineRemainingSec = Math.max(0, safeRuntime - covered);
  return {
    timelineRemainingSec,
    realRemainingSec: realSecondsFor(timelineRemainingSec, speed),
    completionPercent: safeRuntime === 0 ? 0 : Math.round((covered / safeRuntime) * 1000) / 10,
  };
}

/**
 * Split a long race into suggested stints.
 *
 * Used by the planner so a 24-hour race is presented as an expedition made of
 * manageable pieces, never as something to attempt in one sitting. Returns
 * timeline windows over the *unwatched* parts of the race.
 */
export function suggestStints(
  gaps: readonly { start: number; end: number }[],
  stintRealMinutes: number,
  speed: number,
): { start: number; end: number; realSeconds: number }[] {
  const stintTimelineSec = timelineSecondsFor(stintRealMinutes * 60, speed);
  if (stintTimelineSec <= 0) return [];

  const stints: { start: number; end: number; realSeconds: number }[] = [];
  for (const gap of gaps) {
    let cursor = gap.start;
    while (cursor < gap.end) {
      const end = Math.min(cursor + stintTimelineSec, gap.end);
      stints.push({ start: cursor, end, realSeconds: realSecondsFor(end - cursor, speed) });
      cursor = end;
    }
  }
  return stints;
}
