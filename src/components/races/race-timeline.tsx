'use client';

/**
 * The race timeline bar.
 *
 * This is the single most important visualisation in the application: it draws
 * the ACTUAL watched intervals, gaps and all. A race where you skipped an hour
 * in the middle looks visibly different from one you watched straight through,
 * which is exactly the distinction the Story Complete system is built on.
 */

import * as React from 'react';
import { formatCoveragePercent, formatTimestamp, formatDuration } from '@/lib/domain/time';
import type { Interval } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export function RaceTimeline({
  intervals, runtimeSec, height = 'h-3', showHours = true, showGaps = true, className, accent,
}: {
  intervals: Interval[];
  runtimeSec: number;
  height?: string;
  showHours?: boolean;
  showGaps?: boolean;
  className?: string;
  accent?: string | null;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const color = accent ?? 'var(--accent)';
  const safeRuntime = Math.max(1, runtimeSec);

  // Hour ticks, thinned out so a 24-hour race does not become a picket fence.
  const hourCount = Math.floor(safeRuntime / 3600);
  const tickStep = hourCount > 14 ? 6 : hourCount > 8 ? 2 : 1;
  const ticks = showHours
    ? Array.from({ length: hourCount }, (_, i) => i + 1).filter((h) => h % tickStep === 0)
    : [];

  const gaps = showGaps ? gapsBetween(intervals, safeRuntime) : [];

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn('relative w-full overflow-hidden rounded-sm bg-panel-3', height)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setHover(((event.clientX - rect.left) / rect.width) * safeRuntime);
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Timeline coverage: ${describeCoverage(intervals, safeRuntime)}`}
      >
        {/* Unwatched sections read as a subtle hatch rather than as an alarm. */}
        {gaps.map((gap, i) => (
          <div
            key={`gap-${gap.start}-${i}`}
            className="absolute inset-y-0"
            style={{
              left: `${(gap.start / safeRuntime) * 100}%`,
              width: `${((gap.end - gap.start) / safeRuntime) * 100}%`,
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 3px, transparent 3px 7px)',
            }}
          />
        ))}

        {intervals.map((interval, i) => (
          <div
            key={`iv-${interval.start}-${i}`}
            className="absolute inset-y-0 transition-[left,width] duration-500"
            style={{
              left: `${(interval.start / safeRuntime) * 100}%`,
              width: `${Math.max(0.25, ((interval.end - interval.start) / safeRuntime) * 100)}%`,
              background: color,
            }}
          />
        ))}

        {ticks.map((hour) => (
          <div
            key={`tick-${hour}`}
            className="absolute inset-y-0 w-px bg-void/45"
            style={{ left: `${((hour * 3600) / safeRuntime) * 100}%` }}
          />
        ))}

        {hover !== null ? (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-ink/70"
            style={{ left: `${(hover / safeRuntime) * 100}%` }}
          />
        ) : null}
      </div>

      <div className="mt-1 flex items-center justify-between text-[0.6875rem] text-ink-faint">
        <span className="timing">00:00:00</span>
        {hover !== null ? (
          <span className="timing text-ink-muted">{formatTimestamp(hover)}</span>
        ) : (
          <span>{describeCoverage(intervals, safeRuntime)}</span>
        )}
        <span className="timing">{formatTimestamp(safeRuntime)}</span>
      </div>
    </div>
  );
}

/**
 * The list of unwatched sections, shown beneath the bar on a race page so the
 * user can see exactly what is still ahead of them.
 */
export function GapList({
  intervals, runtimeSec, onPick, className,
}: {
  intervals: Interval[];
  runtimeSec: number;
  onPick?: (gap: Interval) => void;
  className?: string;
}) {
  const gaps = gapsBetween(intervals, runtimeSec);
  if (gaps.length === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="label">Still to watch</div>
      <ul className="space-y-1">
        {gaps.map((gap, i) => (
          <li key={`${gap.start}-${i}`}>
            <button
              type="button"
              onClick={onPick ? () => onPick(gap) : undefined}
              disabled={!onPick}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded border border-hairline bg-panel-2 px-2.5 py-1.5 text-left text-xs',
                onPick && 'transition-colors hover:border-hairline-strong hover:bg-panel-3',
              )}
            >
              <span className="timing text-ink-muted">
                {formatTimestamp(gap.start)} – {formatTimestamp(gap.end)}
              </span>
              <span className="text-ink-dim">{formatDuration(gap.end - gap.start)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function gapsBetween(intervals: Interval[], runtimeSec: number): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const interval of sorted) {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < runtimeSec) gaps.push({ start: cursor, end: runtimeSec });
  return gaps;
}

function describeCoverage(intervals: Interval[], runtimeSec: number): string {
  const covered = intervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  // Floored, so a race with a gap never reads "100% watched".
  return `${formatCoveragePercent(covered, runtimeSec)} watched`;
}
