'use client';

/**
 * The season pass track.
 *
 * A hundred tiers, browsable from the first, with milestone tiers called out.
 * An archived quarter is shown exactly as it finished — that is the point of a
 * real deadline — and the note beneath it explains, without any edge to it,
 * why nothing permanent depends on it.
 */

import * as React from 'react';
import Link from 'next/link';
import { Clock, Lock } from 'lucide-react';
import type { SeasonPassSummary, SeasonPassTierView, SeasonPassView } from '@/lib/engines/season-pass-engine';
import type { RewardType } from '@/lib/domain/types';
import {
  Panel, PanelBody, PanelHeader, RarityBadge, rarityColor, Stat, TimingBar,
} from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/controls';
import { cn, formatDate, formatNumber } from '@/lib/utils';

const REWARD_LABEL: Record<RewardType, string> = {
  BADGE: 'Badge',
  TITLE: 'Title',
  THEME: 'Theme',
  RACE_CARD: 'Race card',
  TROPHY_ITEM: 'Trophy',
  PATCH: 'Patch',
  EMBLEM: 'Emblem',
  BANNER: 'Banner',
  POSTER: 'Poster',
  XP_BONUS: 'XP bonus',
  HALL_OF_FAME_COLLECTIBLE: 'Hall of Fame',
};

export function SeasonPassTrack({
  pass, history,
}: { pass: SeasonPassView; history: SeasonPassSummary[] }) {
  const [view, setView] = React.useState<'track' | 'history'>('track');

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={pass.label}
          action={
            pass.isArchived ? (
              <span className="text-[0.6875rem] uppercase tracking-[0.1em] text-ink-faint">archived</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-ink-faint">
                <Clock size={10} /> {pass.daysRemaining} days left
              </span>
            )
          }
        />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Tier"
              value={`${pass.tier}`}
              sub={`of ${pass.tierCount}`}
              size="lg"
              tone="accent"
            />
            <Stat label="Season XP" value={formatNumber(pass.seasonXp)} size="sm" tone="muted" />
            <Stat label="Tiers unlocked" value={`${pass.tiersUnlocked}`} size="sm" tone="muted" />
            <Stat label="Milestones" value={`${pass.milestonesUnlocked}`} size="sm" tone="muted" />
          </div>

          <div>
            <TimingBar
              value={pass.progress * 100}
              height="h-1.5"
              label={`Progress towards tier ${pass.tier + 1}`}
            />
            <div className="mt-1.5 flex justify-between text-[0.6875rem] text-ink-faint">
              <span className="timing">
                {formatNumber(pass.intoTier)} / {formatNumber(pass.tierCost)} to tier {Math.min(pass.tier + 1, pass.tierCount)}
              </span>
              <span>{formatDate(pass.startsAt)} – {formatDate(pass.endsAt)}</span>
            </div>
          </div>

          {pass.note ? (
            <p className="rounded-md border border-hairline bg-panel-2 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
              {pass.note}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-ink-dim">
              Entirely free, with no paid track. Everything on it is cosmetic, statistical or
              collectible, so whatever the quarter does or does not reach, your permanent career is
              untouched by it.
            </p>
          )}
        </PanelBody>
      </Panel>

      {pass.nextTiers.length > 0 && !pass.isArchived ? (
        <Panel>
          <PanelHeader title="Next up" />
          <PanelBody>
            <ul className="grid gap-2 sm:grid-cols-3">
              {pass.nextTiers.slice(0, 3).map((tier) => <TierCard key={tier.tier} tier={tier} />)}
            </ul>
          </PanelBody>
        </Panel>
      ) : null}

      {history.length > 1 ? (
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'track', label: 'The track' },
            { value: 'history', label: 'Past quarters' },
          ]}
        />
      ) : null}

      {view === 'track' ? (
        <Panel>
          <PanelHeader
            title="All one hundred tiers"
            action={
              <span className="timing text-[0.6875rem] text-ink-faint">
                {pass.tiersUnlocked}/{pass.tierCount}
              </span>
            }
          />
          <PanelBody>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {pass.track.map((tier) => <TierCard key={tier.tier} tier={tier} compact />)}
            </ul>
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title="Past quarters" />
          <ul className="divide-y divide-hairline">
            {history.map((quarter) => (
              <li key={quarter.id}>
                <Link
                  href={`/season-pass?year=${quarter.year}&quarter=${quarter.quarter}`}
                  className={cn(
                    'flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-panel-2/60',
                    quarter.isCurrent && 'bg-panel-2/40',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink">{quarter.label}</span>
                      {quarter.isCurrent ? (
                        <span className="text-[0.625rem] uppercase tracking-[0.12em] text-[var(--accent)]">open</span>
                      ) : null}
                      {quarter.isComplete ? (
                        <span className="text-[0.625rem] uppercase tracking-[0.12em] text-verde">complete</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                      {formatDate(quarter.startsAt)} – {formatDate(quarter.endsAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="timing text-sm text-ink-muted">
                      {quarter.tier}/{quarter.tierCount}
                    </div>
                    <div className="timing text-[0.625rem] text-ink-faint">
                      {formatNumber(quarter.seasonXp)} XP
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function TierCard({ tier, compact }: { tier: SeasonPassTierView; compact?: boolean }) {
  const color = rarityColor(tier.rarity);

  return (
    <li
      className={cn(
        'rounded-md border px-2.5 py-2',
        tier.isUnlocked ? 'bg-panel-2' : 'bg-panel/50',
        tier.isMilestone && 'ring-1 ring-inset',
      )}
      style={{
        borderColor: tier.isUnlocked
          ? `color-mix(in oklab, ${color} 45%, transparent)`
          : 'var(--color-hairline)',
        ...(tier.isMilestone
          ? { ['--tw-ring-color' as string]: `color-mix(in oklab, ${color} 22%, transparent)` }
          : {}),
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="timing text-[0.6875rem] text-ink-faint">{tier.tier}</span>
            {!tier.isUnlocked ? <Lock size={9} className="shrink-0 text-ink-faint" /> : null}
          </div>
          <div className={cn('mt-0.5 line-clamp-2 text-[0.6875rem] leading-snug', tier.isUnlocked ? 'text-ink' : 'text-ink-muted')}>
            {tier.rewardName}
          </div>
          {!compact ? (
            <div className="mt-0.5 text-[0.625rem] text-ink-faint">{REWARD_LABEL[tier.rewardType]}</div>
          ) : null}
        </div>
        {tier.isMilestone || !compact ? <RarityBadge rarity={tier.rarity} /> : null}
      </div>

      <div className="mt-1.5 text-[0.5625rem] text-ink-faint">
        {tier.isUnlocked ? (
          <span>{formatDate(tier.unlockedAt)}</span>
        ) : (
          <span className="timing">{formatNumber(tier.xpRemaining)} XP to go</span>
        )}
      </div>
    </li>
  );
}
