'use client';

/**
 * The achievement cabinet.
 *
 * Every achievement shows its progress, locked or not — seeing that you are
 * 18 of 25 circuits into Globe Trotter is most of the pleasure. Secrets keep
 * their name until they unlock but still track quietly underneath.
 *
 * The completion percentage here is scoped to the achievement list itself,
 * never to "endurance racing" as a whole.
 */

import * as React from 'react';
import Link from 'next/link';
import { Lock, Milestone } from 'lucide-react';
import type { AchievementBoard, MilestoneBoard } from '@/lib/engines/achievement-engine';
import {
  Panel, PanelBody, PanelHeader, RarityBadge, rarityColor, Stat, TimingBar,
} from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/controls';
import { cn, formatDate, formatNumber } from '@/lib/utils';

export function AchievementBoardView({
  achievements, milestones,
}: { achievements: AchievementBoard; milestones: MilestoneBoard }) {
  const [tab, setTab] = React.useState<'achievements' | 'milestones'>('achievements');

  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Unlocked"
              value={`${achievements.unlocked}/${achievements.total}`}
              sub={`${achievements.completionPercent.toFixed(1)}% of the cabinet`}
              size="sm"
            />
            <Stat label="From achievements" value={formatNumber(achievements.xpEarned)} sub="career XP" size="sm" tone="accent" />
            <Stat label="Still waiting" value={formatNumber(achievements.xpWaiting)} sub="career XP in the cabinet" size="sm" tone="muted" />
            <Stat
              label="Ladder rungs"
              value={`${milestones.reached}/${milestones.total}`}
              sub={`${milestones.completionPercent.toFixed(1)}%`}
              size="sm"
              tone="muted"
            />
          </div>

          <p className="text-sm text-ink-muted">{achievements.headline}</p>

          <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
            {achievements.byRarity.map((tally) => (
              <div
                key={tally.rarity}
                className="rounded-md border px-2.5 py-1.5"
                style={{
                  borderColor: `color-mix(in oklab, ${rarityColor(tally.rarity)} 30%, transparent)`,
                  background: `color-mix(in oklab, ${rarityColor(tally.rarity)} 8%, transparent)`,
                }}
              >
                <div
                  className="text-[0.625rem] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: rarityColor(tally.rarity) }}
                >
                  {tally.rarity.toLowerCase()}
                </div>
                <div className="timing mt-0.5 text-xs text-ink-muted">
                  {tally.unlocked}/{tally.total}
                </div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      <div className="flex items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'achievements', label: 'Achievements' },
            { value: 'milestones', label: 'Lifetime ladders' },
          ]}
        />
        <Link
          href="/career/milestones"
          className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-dim transition-colors hover:text-ink-muted"
        >
          <Milestone size={13} /> Career Milestones
        </Link>
      </div>

      {tab === 'achievements' ? (
        <>
          {achievements.nearlyThere.length > 0 ? (
            <Panel>
              <PanelHeader title="Close" />
              <PanelBody className="space-y-2.5">
                <p className="text-xs text-ink-dim">{achievements.nearlyThereNote}</p>
                <ul className="space-y-2.5">
                  {achievements.nearlyThere.map((row) => (
                    <AchievementRow key={row.key} row={row} />
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          ) : null}

          {achievements.categories.map((group) => (
            <Panel key={group.category}>
              <PanelHeader
                title={group.label}
                action={
                  <span className="timing text-[0.6875rem] text-ink-faint">
                    {group.unlocked}/{group.total}
                  </span>
                }
              />
              <PanelBody>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {group.rows.map((row) => <AchievementRow key={row.key} row={row} />)}
                </ul>
              </PanelBody>
            </Panel>
          ))}
        </>
      ) : (
        <MilestoneList board={milestones} />
      )}
    </div>
  );
}

function AchievementRow({ row }: { row: AchievementBoard['categories'][number]['rows'][number] }) {
  const color = rarityColor(row.rarity);

  return (
    <li
      className={cn(
        'rounded-md border px-3 py-2.5 transition-colors',
        row.unlocked ? 'bg-panel-2' : 'bg-panel/60',
      )}
      style={{
        borderColor: row.unlocked
          ? `color-mix(in oklab, ${color} 40%, transparent)`
          : 'var(--color-hairline)',
      }}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {!row.revealed ? <Lock size={10} className="shrink-0 text-ink-faint" /> : null}
            <span className={cn('truncate text-xs font-medium', row.unlocked ? 'text-ink' : 'text-ink-muted')}>
              {row.revealed ? row.name : 'Secret'}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-relaxed text-ink-faint">
            {row.revealed ? row.description : 'This one reveals itself when it happens.'}
          </p>
        </div>
        <RarityBadge rarity={row.rarity} />
      </div>

      <div className="mt-2">
        <TimingBar
          value={row.progress * 100}
          height="h-1"
          color={row.unlocked ? color : undefined}
          label={row.revealed ? row.name : 'Secret achievement'}
        />
        <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
          <span className="timing">
            {formatNumber(Math.min(row.value, row.target), row.target % 1 === 0 ? 0 : 1)}
            {' / '}
            {formatNumber(row.target, row.target % 1 === 0 ? 0 : 1)}
          </span>
          <span>{row.unlocked ? formatDate(row.unlockedAt) : `+${formatNumber(row.xpReward)} XP`}</span>
        </div>
      </div>
    </li>
  );
}

function MilestoneList({ board }: { board: MilestoneBoard }) {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="space-y-2">
          <p className="text-sm text-ink-muted">{board.headline}</p>
          <p className="text-xs text-ink-dim">
            The major moments along these ladders, each with the day it happened, are kept on{' '}
            <Link href="/career/milestones" className="text-ink-muted underline-offset-2 hover:underline">
              Career Milestones
            </Link>
            .
          </p>
        </PanelBody>
      </Panel>

      {board.rows.map((row) => (
        <Panel key={row.metric}>
          <PanelHeader
            title={row.label}
            action={
              <span className="timing text-[0.6875rem] text-ink-faint">
                {row.reached}/{row.total}
              </span>
            }
          />
          <PanelBody className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <div className="label mb-1">Now</div>
                <div className="timing text-xl text-ink">
                  {formatNumber(row.value, row.format === 'hours' ? 1 : 0)}
                  <span className="ml-0.5 text-xs text-ink-faint">{row.unit}</span>
                </div>
              </div>
              {row.next ? (
                <div>
                  <div className="label mb-1">Next</div>
                  <div className="timing text-xl text-ink-muted">
                    {formatNumber(row.next.threshold)}
                    <span className="ml-0.5 text-xs text-ink-faint">{row.unit}</span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-[var(--accent)]">Every rung reached.</div>
              )}
              {row.next ? (
                <div className="text-xs text-ink-dim">
                  <span className="timing">{formatNumber(row.next.remaining, row.format === 'hours' ? 1 : 0)}</span>
                  {' '}to go
                </div>
              ) : null}
            </div>

            {row.next ? <TimingBar value={row.next.progress * 100} height="h-1.5" label={row.label} /> : null}

            {/* The whole ladder, so the scale of the thing is visible. */}
            <ol className="flex flex-wrap gap-1.5 border-t border-hairline pt-3">
              {row.thresholds.map((rung) => (
                <li
                  key={rung.threshold}
                  title={rung.reached ? `Reached ${formatDate(rung.reachedAt)}` : `+${formatNumber(rung.xp)} XP`}
                  className={cn(
                    'timing rounded border px-1.5 py-0.5 text-[0.625rem]',
                    rung.reached
                      ? 'border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-hairline bg-panel-2 text-ink-faint',
                  )}
                >
                  {formatNumber(rung.threshold)}
                </li>
              ))}
            </ol>
          </PanelBody>
        </Panel>
      ))}
    </div>
  );
}
