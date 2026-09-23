/**
 * The season pass while it is closed (0.3.1).
 *
 * Says when the pass opens and what the pass that opens will offer. Every
 * reward, tier and count on this screen comes from `seasonPassClosure`, which
 * derives them from the same configuration that builds the pass when it opens,
 * so the preview cannot disagree with the track that follows it.
 */

import { Ticket } from 'lucide-react';
import type { SeasonPassClosure, SeasonPassRewardPreview } from '@/lib/engines/season-pass-engine';
import { seasonPassClosedHeadline, seasonPassClosedNote } from '@/lib/copy/tone';
import {
  Panel, PanelBody, PanelHeader, RarityBadge, rarityColor, Stat,
} from '@/components/ui/primitives';
import { formatDate, formatNumber } from '@/lib/utils';
import { REWARD_TYPE_LABEL } from './reward-labels';

export function SeasonPassClosed({ closure }: { closure: SeasonPassClosure }) {
  const opensOn = formatDate(closure.reopensAt, 'long');
  const otherTiers = closure.tierCount - closure.milestones.length;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title={seasonPassClosedHeadline(opensOn)}
          icon={<Ticket size={12} />}
          action={<span className="timing text-[0.6875rem] text-ink-faint">{closure.label}</span>}
        />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Opens" value={formatDate(closure.reopensAt)} size="sm" tone="accent" />
            <Stat label="Pass" value={closure.label} size="sm" tone="muted" />
            <Stat label="Tiers" value={formatNumber(closure.tierCount)} size="sm" tone="muted" />
            <Stat label="Milestones" value={formatNumber(closure.milestones.length)} size="sm" tone="muted" />
          </div>
          <p className="text-xs leading-relaxed text-ink-dim">{seasonPassClosedNote(closure.label, opensOn)}</p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title={`On the ${closure.label} pass`}
          action={
            <span className="text-[0.6875rem] text-ink-faint">
              {formatNumber(closure.milestones.length)} milestone rewards
            </span>
          }
        />
        <PanelBody className="space-y-3">
          {closure.themes.length > 0 ? (
            <p className="text-xs leading-relaxed text-ink-dim">
              {/* Not "this quarter": the quarter running now is not the one that opens. */}
              Themes:{' '}
              {closure.themes.map((theme, i) => (
                <span key={theme.tier}>
                  {i === 0 ? '' : i === closure.themes.length - 1 ? ' and ' : ', '}
                  <span className="text-ink-muted">{theme.rewardName}</span> at tier {theme.tier}
                </span>
              ))}
              .
            </p>
          ) : null}

          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {closure.milestones.map((reward) => <PreviewCard key={reward.tier} reward={reward} />)}
          </ul>

          {otherTiers > 0 ? (
            <p className="text-[0.6875rem] text-ink-faint">
              Each of the other {formatNumber(otherTiers)} tiers has a smaller reward of its own.
            </p>
          ) : null}
        </PanelBody>
      </Panel>
    </div>
  );
}

/** A milestone reward, drawn like a milestone tier on the open track. */
function PreviewCard({ reward }: { reward: SeasonPassRewardPreview }) {
  const color = rarityColor(reward.rarity);

  return (
    <li
      className="rounded-md border bg-panel/50 px-2.5 py-2 ring-1 ring-inset"
      style={{
        borderColor: 'var(--color-hairline)',
        ['--tw-ring-color' as string]: `color-mix(in oklab, ${color} 22%, transparent)`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="timing text-[0.6875rem] text-ink-faint">Tier {reward.tier}</span>
        <RarityBadge rarity={reward.rarity} />
      </div>
      <div className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug text-ink-muted">{reward.rewardName}</div>
      <div className="mt-0.5 text-[0.625rem] text-ink-faint">{REWARD_TYPE_LABEL[reward.rewardType]}</div>
    </li>
  );
}
