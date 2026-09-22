/**
 * A race card.
 *
 * The unit of the race library and of every collection. A Story Complete race
 * gets a distinct accent border — the visual marker the collection system is
 * built around.
 */

import Link from 'next/link';
import { Star, Clock } from 'lucide-react';
import { formatDuration } from '@/lib/domain/time';
import type { Interval, RacePriority, RaceStatus } from '@/lib/domain/types';
import { cn, formatDate } from '@/lib/utils';
import { RaceTimeline } from './race-timeline';
import { Badge } from '@/components/ui/primitives';

export interface RaceCardData {
  id: string;
  name: string;
  championshipName: string | null;
  championshipColor: string | null;
  seasonYear: number | null;
  circuit: string | null;
  country: string | null;
  raceDate: string | null;
  runtimeSec: number;
  coverageSec: number;
  realViewingSec: number;
  sessionCount: number;
  status: RaceStatus;
  priority: RacePriority;
  excitement: number;
  isMajorEvent: boolean;
  storyComplete: boolean;
  intervals: Interval[];
}

const STATUS_LABEL: Record<RaceStatus, string> = {
  UNWATCHED: 'Unwatched',
  QUEUED: 'Queued',
  WATCHING: 'Watching',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ABANDONED: 'Set aside',
  ARCHIVED: 'Archived',
};

export function RaceCard({ race, className, compact }: { race: RaceCardData; className?: string; compact?: boolean }) {
  const accent = race.championshipColor ?? 'var(--color-gold)';
  const percent = race.runtimeSec > 0 ? Math.round((race.coverageSec / race.runtimeSec) * 100) : 0;

  return (
    <Link
      href={`/races/${race.id}`}
      className={cn(
        'group panel relative block transition-colors hover:border-hairline-strong',
        race.storyComplete && 'border-[color-mix(in_oklab,var(--card-accent)_55%,transparent)]',
        className,
      )}
      style={{ ['--card-accent' as string]: accent } as React.CSSProperties}
    >
      {/* Championship colour stripe, the way a timing screen marks a class. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5" style={{ background: accent }} />

      <div className={cn('pl-4 pr-3.5', compact ? 'py-3' : 'py-3.5')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {race.isMajorEvent ? (
                <Star size={11} className="shrink-0 text-[var(--card-accent)]" fill="currentColor" aria-label="Major event" />
              ) : null}
              <h3 className="truncate text-sm font-medium leading-snug text-ink group-hover:text-ink">
                {race.name}
              </h3>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-dim">
              {[race.championshipName, race.seasonYear, race.circuit].filter(Boolean).join(' · ') || 'Unassigned'}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="timing text-sm tabular-nums text-ink-muted">{percent}%</div>
            <div className="mt-0.5 text-[0.625rem] text-ink-faint">{formatDuration(race.runtimeSec)}</div>
          </div>
        </div>

        <RaceTimeline
          intervals={race.intervals}
          runtimeSec={race.runtimeSec}
          height="h-1.5"
          showHours={!compact}
          className="mt-3"
          accent={accent}
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {race.storyComplete ? (
            <Badge tone="accent">Story Complete</Badge>
          ) : (
            <Badge tone="outline">{STATUS_LABEL[race.status]}</Badge>
          )}
          {race.sessionCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-ink-faint">
              <Clock size={10} />
              {formatDuration(race.realViewingSec)} watched
              {race.sessionCount > 1 ? ` · ${race.sessionCount} sessions` : null}
            </span>
          ) : null}
          {race.raceDate && race.sessionCount === 0 ? (
            <span className="text-[0.6875rem] text-ink-faint">{formatDate(race.raceDate)}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
