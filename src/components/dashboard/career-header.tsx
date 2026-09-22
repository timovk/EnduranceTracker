/**
 * The career header.
 *
 * The first thing on the dashboard, because the career is the point: level,
 * prestige, title, XP and momentum, read like the header of a timing screen.
 */

import { Zap } from 'lucide-react';
import { ProgressRing, Panel, TimingBar } from '@/components/ui/primitives';
import type { MomentumState } from '@/lib/engines/contracts';
import { formatNumber } from '@/lib/utils';

export interface CareerHeaderData {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  progress: number;
  careerXp: number;
  prestige: number;
  prestigeLabel: string;
  title: string;
  nextTitle: { level: number; title: string } | null;
  momentum: MomentumState;
  greeting: string;
}

export function CareerHeader({ data }: { data: CareerHeaderData }) {
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        {/* Level ring */}
        <div className="flex items-center gap-4">
          <ProgressRing
            progress={data.progress}
            size={92}
            stroke={6}
            ariaLabel={`Career level ${data.level}, ${Math.round(data.progress * 100)}% to the next`}
          >
            <div>
              <div className="timing text-2xl leading-none text-ink">{data.level}</div>
              <div className="label mt-0.5 text-[0.5625rem]">Level</div>
            </div>
          </ProgressRing>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-medium text-ink">{data.title}</span>
              {data.prestige > 0 ? (
                <span className="rounded border border-[var(--accent)]/45 bg-[var(--accent-soft)] px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-[var(--accent)]">
                  {data.prestigeLabel}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-dim">
              <Zap size={11} className="text-[var(--accent)]" />
              <span className="timing">{formatNumber(data.careerXp)}</span>
              <span>career XP</span>
            </div>
            <div className="mt-2 w-44">
              <TimingBar value={data.progress * 100} height="h-1" label="Progress to next level" />
              <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
                <span className="timing">{formatNumber(data.xpIntoLevel)}</span>
                <span className="timing">{formatNumber(data.xpForLevel)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Momentum. A gauge, not a demand. */}
        <div className="min-w-0 flex-1">
          <div className="label mb-1.5">Momentum</div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-medium" style={{ color: data.momentum.tierColor }}>
              {data.momentum.tierName}
            </span>
            <span className="timing text-xs text-ink-faint">
              {Math.round(data.momentum.points)}
            </span>
          </div>
          <TimingBar
            value={data.momentum.progressToNext * 100}
            className="mt-2 max-w-xs"
            height="h-1"
            color={data.momentum.tierColor}
            label="Momentum"
          />
          <p className="mt-1.5 text-xs text-ink-dim">{data.momentum.tierBlurb}</p>
        </div>

        {/* The greeting. Warm on return, never a reprimand. */}
        <div className="min-w-0 max-w-xs">
          <div className="label mb-1.5">Paddock</div>
          <p className="text-sm leading-relaxed text-ink-muted">{data.greeting}</p>
          {data.nextTitle ? (
            <p className="mt-1.5 text-xs text-ink-faint">
              {data.nextTitle.title} at level {data.nextTitle.level}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
