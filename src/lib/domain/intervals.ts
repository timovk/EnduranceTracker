/**
 * Watched-interval arithmetic.
 *
 * This module is the reason a race's completion is honest. Coverage is stored
 * as a set of half-open intervals `[start, end)` over the race timeline, NOT
 * as a furthest-timestamp high-water mark. That distinction is what makes
 * "skipped an hour in the middle" detectable, and what makes re-watching
 * increase real viewing time without inflating unique coverage.
 *
 * Everything here is pure: no dates, no database, no configuration lookups
 * beyond what is passed in. That keeps it exhaustively testable, which matters
 * more than anything else in the application.
 */

import type { Interval } from './types';

/** Normalise one interval: integer bounds, ordered, clamped to [0, limit]. */
export function normalizeInterval(interval: Interval, limit?: number): Interval | null {
  let start = Math.round(interval.start);
  let end = Math.round(interval.end);
  if (start > end) [start, end] = [end, start];
  start = Math.max(0, start);
  end = Math.max(0, end);
  if (limit !== undefined) {
    start = Math.min(start, limit);
    end = Math.min(end, limit);
  }
  if (end <= start) return null;
  return { start, end };
}

/**
 * Merge a list of intervals into a sorted, non-overlapping set.
 *
 * `gapTolerance` closes tiny holes (seek jitter, ad breaks) so they do not
 * block Story Complete on a technicality. It defaults to 0 — callers that want
 * tolerance pass it explicitly, so the raw geometry is never quietly fudged.
 */
export function mergeIntervals(intervals: readonly Interval[], gapTolerance = 0): Interval[] {
  const normalized = intervals
    .map((iv) => normalizeInterval(iv))
    .filter((iv): iv is Interval => iv !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (normalized.length === 0) return [];

  const merged: Interval[] = [{ ...normalized[0]! }];
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end + gapTolerance) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Total unique seconds covered by a set of intervals. */
export function coverageSeconds(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, iv) => sum + (iv.end - iv.start), 0);
}

/**
 * A merged set cut at `limit`: whatever runs past it is dropped, and an
 * interval that lies wholly past it goes altogether.
 *
 * Timeline past a race's runtime is not coverage. A race whose runtime was
 * shortened under 0.3.x can still hold intervals that run past its new end,
 * so coverage is always measured on the set cut at the runtime.
 */
export function clampIntervals(intervals: readonly Interval[], limit: number): Interval[] {
  return mergeIntervals(
    intervals
      .map((iv) => normalizeInterval(iv, limit))
      .filter((iv): iv is Interval => iv !== null),
  );
}

/**
 * Add one interval to an existing merged set.
 *
 * Returns the new merged set plus `addedSeconds` — the amount of timeline that
 * had never been watched before. `addedSeconds` is what the XP engine credits
 * at full rate; the remainder is a re-watch.
 */
export function addInterval(
  existing: readonly Interval[],
  incoming: Interval,
  options: { limit?: number; gapTolerance?: number } = {},
): { intervals: Interval[]; addedSeconds: number } {
  const normalized = normalizeInterval(incoming, options.limit);
  const base = mergeIntervals(existing, options.gapTolerance);
  if (normalized === null) {
    return { intervals: base, addedSeconds: 0 };
  }

  const before = coverageSeconds(base);
  const merged = mergeIntervals([...base, normalized], options.gapTolerance);
  const after = coverageSeconds(merged);

  return { intervals: merged, addedSeconds: Math.max(0, after - before) };
}

/**
 * How much of `incoming` is NOT already covered by `existing`.
 *
 * Equivalent to the `addedSeconds` of `addInterval`, but without building the
 * merged result — used when only the number is wanted.
 */
export function newCoverageOf(existing: readonly Interval[], incoming: Interval): number {
  const normalized = normalizeInterval(incoming);
  if (normalized === null) return 0;
  return coverageSeconds(subtract([normalized], existing));
}

/** `a \ b` — the parts of `a` not covered by `b`. */
export function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const minuend = mergeIntervals(a);
  const subtrahend = mergeIntervals(b);
  const result: Interval[] = [];

  for (const piece of minuend) {
    let cursor = piece.start;
    for (const cut of subtrahend) {
      if (cut.end <= cursor) continue;
      if (cut.start >= piece.end) break;
      if (cut.start > cursor) {
        result.push({ start: cursor, end: Math.min(cut.start, piece.end) });
      }
      cursor = Math.max(cursor, cut.end);
      if (cursor >= piece.end) break;
    }
    if (cursor < piece.end) {
      result.push({ start: cursor, end: piece.end });
    }
  }

  return result;
}

/**
 * The unwatched holes in a race, in order.
 *
 * This is what the race detail view draws as the gaps in the timeline bar, and
 * what the "you still need to watch 01:43:17-03:02:44" prompt is built from.
 */
export function gapsIn(intervals: readonly Interval[], runtimeSec: number): Interval[] {
  if (runtimeSec <= 0) return [];
  return subtract([{ start: 0, end: Math.round(runtimeSec) }], intervals);
}

/** The largest single unwatched hole, in seconds. */
export function largestGap(intervals: readonly Interval[], runtimeSec: number): number {
  return gapsIn(intervals, runtimeSec).reduce((max, gap) => Math.max(max, gap.end - gap.start), 0);
}

/** Coverage as a fraction of the race runtime, clamped to [0, 1]. */
export function coverageRatio(intervals: readonly Interval[], runtimeSec: number): number {
  if (runtimeSec <= 0) return 0;
  return Math.min(1, coverageSeconds(intervals) / runtimeSec);
}

/**
 * The furthest point reached — kept only for display ("you are at 02:47:31").
 * It is deliberately NOT used to decide completion.
 */
export function furthestPoint(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((max, iv) => Math.max(max, iv.end), 0);
}

/**
 * The natural place to resume: the start of the first gap, or the furthest
 * point if there are none. This is what the Resume button uses, and it is why
 * skipping a section keeps quietly pointing you back at it.
 */
export function resumePoint(intervals: readonly Interval[], runtimeSec: number): number {
  const gaps = gapsIn(intervals, runtimeSec);
  if (gaps.length === 0) return Math.min(furthestPoint(intervals), runtimeSec);
  return gaps[0]!.start;
}

/**
 * Whether the timeline is covered well enough to count as Story Complete.
 *
 * Two conditions, both required:
 *   1. coverage ratio >= `coverageRatio` (allows a few trailing seconds of
 *      podium footage to be missing),
 *   2. total uncovered timeline <= `maxUncoveredSeconds` (so "99.5% of a
 *      24-hour race" can never hide a seven-minute skip).
 */
export function isStoryComplete(
  intervals: readonly Interval[],
  runtimeSec: number,
  thresholds: { coverageRatio: number; maxUncoveredSeconds: number },
): boolean {
  if (runtimeSec <= 0) return false;
  const covered = coverageSeconds(intervals);
  const uncovered = Math.max(0, runtimeSec - covered);
  return covered / runtimeSec >= thresholds.coverageRatio && uncovered <= thresholds.maxUncoveredSeconds;
}

/** Serialisation helpers for the `{start,end}` rows stored in the database. */
export function toRows<T extends { startSec: number; endSec: number }>(
  intervals: readonly Interval[],
  map: (iv: Interval) => T,
): T[] {
  return intervals.map(map);
}

export function fromRows(rows: readonly { startSec: number; endSec: number }[]): Interval[] {
  return mergeIntervals(rows.map((r) => ({ start: r.startSec, end: r.endSec })));
}
