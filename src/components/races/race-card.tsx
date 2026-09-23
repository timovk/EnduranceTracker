/**
 * A race card.
 *
 * The unit of the race library and of every collection. A Story Complete race
 * gets a distinct accent border — the visual marker the collection system is
 * built around.
 *
 * Four designs, unlocked through the season pass. They change how a card
 * looks and never what it says: every design shows the same name, the same
 * coverage and the same state, so switching one can never hide a fact.
 *
 *   classic    Clean panel with a coverage bar. Every account has it.
 *   timing     Monospaced, sector-striped. The race is split into three
 *              sectors and each is coloured the way a timing screen colours a
 *              sector: purple when it is fully watched, green when it has been
 *              started, grey when it has not.
 *   telemetry  Trace lines behind the numbers — a speed trace drawn from the
 *              race itself, so every race has its own.
 *   hyperpole  High-contrast, single accent. The championship colour gives way
 *              to the dashboard theme's accent and nothing else.
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

export type RaceCardVariant = 'classic' | 'timing' | 'telemetry' | 'hyperpole';

const VARIANTS: readonly RaceCardVariant[] = ['classic', 'timing', 'telemetry', 'hyperpole'];

/** An unknown key is drawn as Classic rather than as nothing. */
export function raceCardVariantOf(key: string | null | undefined): RaceCardVariant {
  return VARIANTS.find((variant) => variant === key) ?? 'classic';
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

export function RaceCard({
  race, className, compact, variant = 'classic', preview,
}: {
  race: RaceCardData;
  className?: string;
  compact?: boolean;
  variant?: RaceCardVariant;
  /** Draw it without a link, for a preview that is not a real race. */
  preview?: boolean;
}) {
  const accent = variant === 'hyperpole' ? 'var(--accent)' : (race.championshipColor ?? 'var(--color-gold)');
  const precisePercent = race.runtimeSec > 0 ? Math.min(100, (race.coverageSec / race.runtimeSec) * 100) : 0;
  const percent = Math.round(precisePercent);
  const mono = variant === 'timing';

  const shell = cn(
    'group relative block overflow-hidden transition-colors',
    variant === 'classic' && 'panel hover:border-hairline-strong',
    variant === 'timing' && 'rounded-sm border border-hairline-strong bg-[#0d1116] hover:border-ink-faint',
    variant === 'telemetry' && 'panel hover:border-hairline-strong',
    variant === 'hyperpole' && 'rounded-md border border-white/12 bg-[#040506] hover:border-white/25',
    race.storyComplete && 'border-[color-mix(in_oklab,var(--card-accent)_55%,transparent)]',
    className,
  );
  const style = { ['--card-accent' as string]: accent } as React.CSSProperties;

  const body = (
    <>
      {variant === 'timing' ? (
        <SectorStripe race={race} />
      ) : (
        /* Championship colour stripe, the way a timing screen marks a class. */
        <span
          aria-hidden
          className={cn('absolute inset-y-0 left-0', variant === 'hyperpole' ? 'w-1' : 'w-0.5')}
          style={{ background: accent }}
        />
      )}

      {variant === 'telemetry' ? <TelemetryTrace seed={race.id} /> : null}

      <div className={cn('relative pl-4 pr-3.5', compact ? 'py-3' : 'py-3.5', variant === 'timing' && 'pt-4')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {race.isMajorEvent ? (
                <Star size={11} className="shrink-0 text-[var(--card-accent)]" fill="currentColor" aria-label="Major event" />
              ) : null}
              <h3
                className={cn(
                  'truncate leading-snug',
                  variant === 'classic' && 'text-sm font-medium text-ink',
                  variant === 'timing' && 'timing text-[0.8125rem] font-semibold uppercase tracking-wide text-ink',
                  variant === 'telemetry' && 'text-sm font-medium text-ink',
                  variant === 'hyperpole' && 'text-sm font-bold uppercase tracking-[0.06em] text-white',
                )}
              >
                {race.name}
              </h3>
            </div>
            <p
              className={cn(
                'mt-0.5 truncate text-xs',
                mono && 'timing uppercase tracking-wide text-[0.6875rem]',
                variant === 'hyperpole' ? 'text-white/55' : 'text-ink-dim',
              )}
            >
              {[race.championshipName, race.seasonYear, race.circuit].filter(Boolean).join(' · ') || 'Unassigned'}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div
              className={cn(
                'timing tabular-nums',
                variant === 'classic' && 'text-sm text-ink-muted',
                variant === 'timing' && 'text-sm font-semibold text-ink',
                variant === 'telemetry' && 'text-[1rem] font-semibold text-[var(--card-accent)]',
                variant === 'hyperpole' && 'text-[1rem] font-bold text-[var(--accent)]',
              )}
            >
              {mono ? `${precisePercent.toFixed(1).padStart(5, '0')}%` : `${percent}%`}
            </div>
            <div className={cn('mt-0.5 text-[0.625rem]', mono && 'timing', variant === 'hyperpole' ? 'text-white/45' : 'text-ink-faint')}>
              {formatDuration(race.runtimeSec)}
            </div>
          </div>
        </div>

        <RaceTimeline
          intervals={race.intervals}
          runtimeSec={race.runtimeSec}
          height={variant === 'hyperpole' ? 'h-1' : 'h-1.5'}
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
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[0.6875rem]',
                mono && 'timing',
                variant === 'hyperpole' ? 'text-white/50' : 'text-ink-faint',
              )}
            >
              <Clock size={10} />
              {formatDuration(race.realViewingSec)} watched
              {race.sessionCount > 1 ? ` · ${race.sessionCount} sessions` : null}
            </span>
          ) : null}
          {race.raceDate && race.sessionCount === 0 ? (
            <span className={cn('text-[0.6875rem]', variant === 'hyperpole' ? 'text-white/50' : 'text-ink-faint')}>
              {formatDate(race.raceDate)}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  if (preview) {
    return <div className={shell} style={style}>{body}</div>;
  }
  return (
    <Link href={`/races/${race.id}`} className={shell} style={style}>
      {body}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Timing screen: three sectors, coloured by how much of each has been watched
// ---------------------------------------------------------------------------

const SECTOR_COLOURS = {
  complete: '#a46cf0', // purple: the best there is
  started: '#3fbf6f', // green: improved on nothing yet
  untouched: '#2a333d',
} as const;

function sectorCoverage(intervals: Interval[], from: number, to: number): number {
  let covered = 0;
  for (const interval of intervals) {
    covered += Math.max(0, Math.min(interval.end, to) - Math.max(interval.start, from));
  }
  return covered;
}

function SectorStripe({ race }: { race: RaceCardData }) {
  const third = race.runtimeSec / 3;
  const sectors = [0, 1, 2].map((index) => {
    const from = index * third;
    const to = index === 2 ? race.runtimeSec : from + third;
    const covered = third > 0 ? sectorCoverage(race.intervals, from, to) / (to - from) : 0;
    // A sector counts as complete on the same terms as a race — a few seconds
    // of slack for the replay's own jitter, not a rounding error's worth.
    if (covered >= 0.995) return SECTOR_COLOURS.complete;
    if (covered > 0) return SECTOR_COLOURS.started;
    return SECTOR_COLOURS.untouched;
  });

  return (
    <span aria-hidden className="absolute inset-x-0 top-0 grid h-1 grid-cols-3 gap-px bg-[#0d1116]">
      {sectors.map((colour, index) => (
        <span key={index} style={{ background: colour }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Telemetry: a speed trace unique to the race
// ---------------------------------------------------------------------------

/**
 * A speed trace, drawn from a race's id.
 *
 * Deterministic on purpose: this renders on the server and again in the
 * browser, and a trace that changed between the two would be a hydration
 * mismatch — and a card that looked different every time you opened the
 * library.
 */
function tracePath(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const next = () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967295;
  };

  // A lap is straights (full speed) broken by braking zones (a sharp drop and
  // a slower climb back out of the corner). Kept to the lower half of the
  // card, behind the coverage bar, so it never runs through the race's name.
  const points: [number, number][] = [];
  let y = 15;
  for (let x = 0; x <= 100; x += 2.5) {
    const braking = next() < 0.16;
    y = braking ? 23 + next() * 5 : Math.max(14, y - 2 - next() * 2.5);
    points.push([x, Math.min(28, y)]);
  }
  return points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
}

function TelemetryTrace({ seed }: { seed: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {[15, 21.5, 28].map((line) => (
        <line key={line} x1="0" x2="100" y1={line} y2={line} stroke="currentColor" strokeWidth="0.15" className="text-hairline" />
      ))}
      <path
        d={tracePath(seed)}
        fill="none"
        stroke="var(--card-accent)"
        strokeWidth="0.6"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.2"
      />
    </svg>
  );
}
