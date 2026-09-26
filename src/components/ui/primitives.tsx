/**
 * Interface primitives.
 *
 * Every panel, label, value and bar in the application is built from these, so
 * the whole thing reads as one instrument cluster rather than a collection of
 * screens. Nothing here contains business logic.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { Rarity } from '@/lib/domain/types';

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export function Panel({
  className, children, raised, accent, ...props
}: React.HTMLAttributes<HTMLDivElement> & { raised?: boolean; accent?: string | null }) {
  return (
    <div
      className={cn(raised ? 'panel-raised' : 'panel', 'relative overflow-hidden', className)}
      style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

/** Panel header: a small all-caps label on the left, optional action on the right. */
export function PanelHeader({
  title, action, icon, className,
}: { title: string; action?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-ink-dim shrink-0">{icon}</span> : null}
        <h2 className="label truncate">{title}</h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A labelled measurement, the workhorse of the dashboard. */
export function Stat({
  label, value, sub, size = 'md', tone = 'default', className, mono = true,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'accent' | 'positive' | 'muted';
  className?: string;
  mono?: boolean;
}) {
  const sizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-[2.25rem] leading-none',
    xl: 'text-timing-lg',
  } as const;
  const tones = {
    default: 'text-ink',
    accent: 'text-[var(--accent)]',
    positive: 'text-verde',
    muted: 'text-ink-muted',
  } as const;

  return (
    <div className={cn('min-w-0', className)}>
      <div className="label mb-1.5">{label}</div>
      <div className={cn(mono && 'timing', 'tnum truncate', sizes[size], tones[tone])}>{value}</div>
      {sub ? <div className="mt-1 truncate text-xs text-ink-dim">{sub}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bars and rings
// ---------------------------------------------------------------------------

/**
 * A timing bar. `segments` lets a race's coverage be drawn as the real set of
 * watched intervals, gaps and all, rather than as a single filled bar — which
 * is the whole point of tracking intervals.
 */
export function TimingBar({
  value, max = 100, segments, className, height = 'h-2', color, track = 'bg-panel-3', label, valueText, children,
}: {
  value?: number;
  max?: number;
  segments?: { start: number; end: number }[];
  className?: string;
  height?: string;
  color?: string;
  track?: string;
  label?: string;
  /** Read out instead of the rounded value, where rounding would say more than is true ("99.9%", not "100"). */
  valueText?: string;
  /** Drawn over the bar, such as tick marks. */
  children?: React.ReactNode;
}) {
  const accent = color ?? 'var(--accent)';
  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full', height, track, className)}
      role="progressbar"
      aria-valuenow={segments ? undefined : Math.round(value ?? 0)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={valueText}
      aria-label={label}
    >
      {segments
        ? segments.map((seg, i) => (
            <div
              key={`${seg.start}-${seg.end}-${i}`}
              className="absolute inset-y-0 rounded-full transition-[left,width] duration-500"
              style={{
                left: `${(seg.start / max) * 100}%`,
                width: `${Math.max(0.4, ((seg.end - seg.start) / max) * 100)}%`,
                background: accent,
              }}
            />
          ))
        : (
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(0, ((value ?? 0) / max) * 100))}%`, background: accent }}
          />
        )}
      {children}
    </div>
  );
}

/** A progress ring. Used for the career level and the annual fuel tank. */
export function ProgressRing({
  progress, size = 96, stroke = 7, color, track = '#212b36', children, className, ariaLabel,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={ariaLabel}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color ?? 'var(--accent)'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease-out-quint)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

export function Badge({
  children, tone = 'neutral', className, title,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'positive' | 'info' | 'warm' | 'outline';
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: 'bg-panel-3 text-ink-muted border-hairline-strong',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/35',
    positive: 'bg-verde/12 text-verde border-verde/30',
    info: 'bg-azure/12 text-azure border-azure/30',
    warm: 'bg-amber/12 text-amber border-amber/30',
    outline: 'bg-transparent text-ink-dim border-hairline-strong',
  } as const;

  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[0.6875rem] font-medium leading-tight',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const RARITY_COLORS: Record<Rarity, string> = {
  COMMON: 'var(--color-rarity-common)',
  UNCOMMON: 'var(--color-rarity-uncommon)',
  RARE: 'var(--color-rarity-rare)',
  EPIC: 'var(--color-rarity-epic)',
  LEGENDARY: 'var(--color-rarity-legendary)',
  MYTHIC: 'var(--color-rarity-mythic)',
};

export function rarityColor(rarity: Rarity): string {
  return RARITY_COLORS[rarity];
}

export function RarityBadge({ rarity, className }: { rarity: Rarity; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center rounded border px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em]', className)}
      style={{
        color: RARITY_COLORS[rarity],
        borderColor: `color-mix(in oklab, ${RARITY_COLORS[rarity]} 40%, transparent)`,
        background: `color-mix(in oklab, ${RARITY_COLORS[rarity]} 12%, transparent)`,
      }}
    >
      {rarity.toLowerCase()}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

/**
 * Empty states are never scolding. A library with nothing in it is an
 * invitation, not a reprimand.
 */
export function EmptyState({
  title, body, action, icon, className,
}: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? <div className="text-ink-faint">{icon}</div> : null}
      <div className="text-sm font-medium text-ink-muted">{title}</div>
      {body ? <p className="max-w-sm text-sm text-ink-dim">{body}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded', className)} />;
}

/** A thin sector-striped divider. */
export function SectorRule({ className }: { className?: string }) {
  return <div className={cn('sector-rule', className)} />;
}
