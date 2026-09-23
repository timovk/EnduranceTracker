/**
 * A season-pass badge, drawn.
 *
 * A badge is a hexagonal crest in the badge's own colour with a mark in the
 * middle. The colour comes from the reward definition, so a badge added to the
 * pool later is drawn in its own colour without touching this file; only its
 * mark needs adding here, and until it is, it gets a medal.
 */

import { Flag, Fuel, Medal, Repeat2, Zap, type LucideIcon } from 'lucide-react';
import { MILESTONE_REWARDS, STANDARD_REWARDS } from '@/lib/config';
import { cn } from '@/lib/utils';

const MARKS: Record<string, LucideIcon> = {
  greenflag: Flag,
  pitlane: Fuel,
  doublestint: Repeat2,
  hyperpole: Zap,
};

const FALLBACK_COLOUR = '#c8a45c';

/** The badge's name and colour, from the reward pool. */
export function badgeDefinition(badgeKey: string): { name: string; color: string } {
  const reward = [...STANDARD_REWARDS, ...MILESTONE_REWARDS].find((r) => r.key === `badge_${badgeKey}`);
  return { name: reward?.name ?? 'Badge', color: reward?.color ?? FALLBACK_COLOUR };
}

export function BadgeEmblem({
  badgeKey, size = 36, className,
}: {
  badgeKey: string;
  size?: number;
  className?: string;
}) {
  const { name, color } = badgeDefinition(badgeKey);
  const Mark = MARKS[badgeKey] ?? Medal;

  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size * 1.1 }}
    >
      <svg aria-hidden viewBox="0 0 40 44" className="absolute inset-0 h-full w-full">
        <path
          d="M20 2.5 L36.5 11.5 V32.5 L20 41.5 L3.5 32.5 V11.5 Z"
          strokeWidth="1.5"
          strokeLinejoin="round"
          style={{ fill: `color-mix(in oklab, ${color} 20%, #0b0e12)`, stroke: color }}
        />
        <path
          d="M20 7 L32.5 13.8 V30.2 L20 37 L7.5 30.2 V13.8 Z"
          fill="none"
          strokeWidth="0.75"
          strokeLinejoin="round"
          style={{ stroke: `color-mix(in oklab, ${color} 45%, transparent)` }}
        />
      </svg>
      <Mark aria-hidden size={Math.round(size * 0.4)} strokeWidth={2.2} className="relative" style={{ color }} />
    </span>
  );
}
