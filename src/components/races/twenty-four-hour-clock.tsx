'use client';

/**
 * The 24-hour clock.
 *
 * Long races are expeditions, not sittings. Progress through one is drawn
 * around a clock face with the 6H / 12H / 18H / 24H markers called out, so the
 * scale of what has been done is legible at a glance.
 */

import { formatDuration } from '@/lib/domain/time';
import { TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import type { Interval } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export function TwentyFourHourClock({
  intervals, runtimeSec, size = 200, className, accent,
}: {
  intervals: Interval[];
  runtimeSec: number;
  size?: number;
  className?: string;
  accent?: string | null;
}) {
  const color = accent ?? 'var(--accent)';
  const stroke = Math.max(8, size * 0.055);
  const radius = (size - stroke * 2) / 2;
  const centre = size / 2;
  const safeRuntime = Math.max(1, runtimeSec);
  const covered = intervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);

  const toPoint = (seconds: number) => {
    const angle = (seconds / safeRuntime) * Math.PI * 2 - Math.PI / 2;
    return { x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle) };
  };

  const arcFor = (interval: Interval) => {
    const from = toPoint(interval.start);
    const to = toPoint(Math.min(interval.end, safeRuntime));
    const large = (interval.end - interval.start) / safeRuntime > 0.5 ? 1 : 0;
    // A full-circle arc degenerates, so draw it as two halves.
    if (interval.end - interval.start >= safeRuntime - 1) {
      return `M ${centre} ${centre - radius} A ${radius} ${radius} 0 1 1 ${centre - 0.01} ${centre - radius}`;
    }
    return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
  };

  const markers = TWENTY_FOUR_HOUR_CONFIG.segmentHours
    .map((hour, index) => ({ hour, label: TWENTY_FOUR_HOUR_CONFIG.segmentLabels[index] ?? `${hour}H`, seconds: hour * 3600 }))
    .filter((m) => m.seconds <= safeRuntime + 60);

  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${Math.round((covered / safeRuntime) * 100)}% of the race watched`}>
        <circle cx={centre} cy={centre} r={radius} fill="none" stroke="#212b36" strokeWidth={stroke} />

        {intervals.map((interval, i) => (
          <path
            key={`arc-${interval.start}-${i}`}
            d={arcFor(interval)}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />
        ))}

        {markers.map((marker) => {
          const outer = toPointAt(marker.seconds, safeRuntime, centre, radius + stroke / 2 + 2);
          const inner = toPointAt(marker.seconds, safeRuntime, centre, radius - stroke / 2 - 2);
          const reached = covered >= marker.seconds;
          return (
            <g key={marker.label}>
              <line
                x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
                stroke={reached ? color : '#31404e'} strokeWidth={1.5}
              />
              <text
                {...toPointAt(marker.seconds, safeRuntime, centre, radius + stroke / 2 + 13)}
                textAnchor="middle" dominantBaseline="middle"
                className="timing"
                fontSize={size * 0.055}
                fill={reached ? color : '#64717e'}
              >
                {marker.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="timing text-2xl text-ink">{Math.round((covered / safeRuntime) * 100)}%</div>
          <div className="mt-0.5 text-[0.6875rem] text-ink-dim">{formatDuration(covered)} watched</div>
        </div>
      </div>
    </div>
  );
}

function toPointAt(seconds: number, runtime: number, centre: number, r: number) {
  const angle = (seconds / runtime) * Math.PI * 2 - Math.PI / 2;
  return { x: centre + r * Math.cos(angle), y: centre + r * Math.sin(angle) };
}
