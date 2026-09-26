'use client';

/**
 * The race timeline bar.
 *
 * This is the single most important visualisation in the application: it draws
 * the ACTUAL watched intervals, gaps and all. A race where you skipped an hour
 * in the middle looks visibly different from one you watched straight through,
 * which is exactly the distinction the Story Complete system is built on.
 *
 * The Expedition timeline (0.4.0) builds on it: the same bar with the resume
 * point and the furthest point marked, every stint on a lane of its own under
 * it, a sentence that names every stretch still to watch, and the list of
 * them. Reaching the end is never drawn as having watched it all: the furthest
 * point says in words that it is not the same as watched.
 */

import * as React from 'react';
import { EXPEDITION_SHAPE } from '@/lib/config';
import { describeFragments } from '@/lib/copy/tone';
import { stintLanes } from '@/lib/domain/stint-lanes';
import { formatCoveragePercent, formatTimestamp, formatDuration } from '@/lib/domain/time';
import type { Interval } from '@/lib/domain/types';
import { cn, formatDate } from '@/lib/utils';

/** A point on the timeline worth naming: where to resume, and how far the race has been reached. */
export interface TimelineMarker {
  atSec: number;
  label: string;
  kind: 'resume' | 'furthest';
}

export function RaceTimeline({
  intervals, runtimeSec, height = 'h-3', showHours = true, showGaps = true, className, accent, markers = [],
}: {
  intervals: Interval[];
  runtimeSec: number;
  height?: string;
  showHours?: boolean;
  showGaps?: boolean;
  className?: string;
  accent?: string | null;
  /** Drawn on the bar, and named in a line under it so they can be read without a pointer. */
  markers?: TimelineMarker[];
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

        {markers.map((marker) => (
          <div
            key={`${marker.kind}-${marker.atSec}`}
            title={`${marker.label} ${formatTimestamp(marker.atSec)}`}
            className={cn(
              'pointer-events-none absolute inset-y-0 w-0.5',
              marker.kind === 'resume' ? 'bg-ink' : 'border-l-2 border-dotted border-ink/80 bg-transparent',
            )}
            style={{ left: `calc(${(Math.min(marker.atSec, safeRuntime) / safeRuntime) * 100}% - 1px)` }}
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

      {markers.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-ink-dim">
          {markers.map((marker) => (
            <li key={`${marker.kind}-${marker.atSec}`} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'inline-block h-2.5 w-0.5',
                  marker.kind === 'resume' ? 'bg-ink' : 'border-l-2 border-dotted border-ink/80',
                )}
              />
              {marker.label} <span className="timing text-ink-muted">{formatTimestamp(marker.atSec)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One stint as the expedition timeline draws it. */
export interface TimelineStint {
  sessionId: string;
  startTimestampSec: number;
  endTimestampSec: number;
  watchedAt: Date;
  playbackSpeed: number;
  creditedSeconds: number;
}

/**
 * The Expedition timeline: the coverage bar with the resume and furthest
 * points marked, each stint as a thin bar at the part of the race it played —
 * on a lane of its own where it overlaps another, so a re-watch sits under
 * the first viewing — paler for older stints and full for the latest, a
 * sentence naming every stretch still to watch, and the list of them.
 */
export function ExpeditionTimeline({
  runtimeSec, intervals, stints, resumeAtSec, furthestSec, accent,
}: {
  runtimeSec: number;
  intervals: Interval[];
  /** Every stint, in canonical order. */
  stints: TimelineStint[];
  resumeAtSec: number;
  furthestSec: number;
  accent?: string | null;
}) {
  const color = accent ?? 'var(--accent)';
  const safeRuntime = Math.max(1, runtimeSec);
  const { lanes, hidden } = stintLanes(stints, EXPEDITION_SHAPE.stintLaneLimit);
  const order = new Map(stints.map((stint, index) => [stint.sessionId, index]));
  const latest = Math.max(1, stints.length - 1);

  const markers: TimelineMarker[] = [];
  if (resumeAtSec < runtimeSec) markers.push({ atSec: resumeAtSec, label: 'Resume at', kind: 'resume' });
  if (furthestSec > 0) markers.push({ atSec: furthestSec, label: 'Furthest point reached — not the same as watched:', kind: 'furthest' });

  return (
    <div className="space-y-3">
      <RaceTimeline intervals={intervals} runtimeSec={runtimeSec} accent={accent} height="h-4" markers={markers} />

      {lanes.length > 0 ? (
        <div>
          <div className="label mb-1.5">Stints, oldest palest</div>
          <div className="space-y-1" role="list" aria-label="Stints on the race timeline">
            {lanes.map((lane, laneIndex) => (
              <div key={laneIndex} className="relative h-1.5 w-full rounded-sm bg-panel-2">
                {lane.map((stint) => {
                  const age = (order.get(stint.sessionId) ?? 0) / latest;
                  const width = ((stint.endTimestampSec - stint.startTimestampSec) / safeRuntime) * 100;
                  const title = `${formatDate(stint.watchedAt, 'long')}: ${formatTimestamp(stint.startTimestampSec)} → ` +
                    `${formatTimestamp(stint.endTimestampSec)} at ${stint.playbackSpeed}×, ${formatDuration(stint.creditedSeconds)}`;
                  return (
                    <div
                      key={stint.sessionId}
                      role="listitem"
                      title={title}
                      aria-label={title}
                      className="absolute inset-y-0 rounded-sm"
                      style={{
                        left: `${(Math.min(stint.startTimestampSec, safeRuntime) / safeRuntime) * 100}%`,
                        width: `${Math.max(0.4, width)}%`,
                        background: color,
                        opacity: stints.length === 1 ? 1 : 0.3 + 0.7 * age,
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {hidden > 0 ? (
            <p className="mt-1 text-[0.6875rem] text-ink-faint">
              +{hidden} more {hidden === 1 ? 'stint' : 'stints'} over parts already drawn; every stint is in the table below.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs leading-relaxed text-ink-muted">{describeFragments(intervals, runtimeSec)}</p>
      <GapList intervals={intervals} runtimeSec={runtimeSec} />
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

/** The unwatched stretches of a race, in timeline order. */
export function gapsBetween(intervals: Interval[], runtimeSec: number): Interval[] {
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

/** The bar's caption: "62.4% watched", floored so a race with a gap never reads 100%. */
export function describeCoverage(intervals: Interval[], runtimeSec: number): string {
  const covered = intervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  // Floored, so a race with a gap never reads "100% watched".
  return `${formatCoveragePercent(covered, runtimeSec)} watched`;
}
