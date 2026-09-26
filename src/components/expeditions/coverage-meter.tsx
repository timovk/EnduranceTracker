/**
 * The coverage meter of an Expedition: a bar of the race's unique coverage
 * with a tick at every checkpoint.
 *
 * Unique coverage, not the furthest point reached: a race watched to the end
 * with an hour skipped in the middle fills the bar to where it really is. The
 * figure it reads out is `formatCoveragePercent`, which never says "100%"
 * while any second is still to watch.
 */

import { formatCoveragePercent } from '@/lib/domain/time';
import { TimingBar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export function CoverageMeter({
  coverageSec, runtimeSec, ticks, accent, className, height = 'h-2.5',
}: {
  coverageSec: number;
  runtimeSec: number;
  /** Every checkpoint, in order, and whether the coverage reaches it. */
  ticks: { percent: number; reached: boolean }[];
  accent?: string | null;
  className?: string;
  height?: string;
}) {
  const text = formatCoveragePercent(coverageSec, runtimeSec);
  const share = runtimeSec > 0 ? Math.min(100, (coverageSec / runtimeSec) * 100) : 0;

  return (
    <div className={cn('w-full', className)}>
      <TimingBar
        value={share}
        height={height}
        color={accent ?? undefined}
        label="Unique coverage"
        valueText={`${text} of the story watched`}
      >
        {ticks.map((tick) => (
          <span
            key={tick.percent}
            aria-hidden
            className={cn('absolute inset-y-0 w-px', tick.reached ? 'bg-void/60' : 'bg-ink/35')}
            style={{ left: `${tick.percent}%` }}
          />
        ))}
      </TimingBar>
      <div className="relative mt-1 h-3.5 text-[0.625rem] text-ink-faint" aria-hidden>
        {ticks.map((tick) => (
          <span
            key={tick.percent}
            className={cn('timing absolute -translate-x-1/2', tick.reached && 'text-ink-muted')}
            style={{ left: `${tick.percent}%` }}
          >
            {tick.percent}%
          </span>
        ))}
      </div>
    </div>
  );
}
