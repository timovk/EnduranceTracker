/**
 * The remaining dashboard panels: challenges, the season pass, recent unlocks
 * and the career snapshot.
 *
 * Nothing in here nags. Expired challenges are neutral, an untouched backlog
 * is framed as a library of future experiences, and there are no red warning
 * indicators anywhere.
 */

import Link from 'next/link';
import { Award, Check, Clock, Layers, ListChecks, Ticket, Trophy } from 'lucide-react';
import type { ChallengeScope, Rarity } from '@/lib/domain/types';
import { EXPIRED_CHALLENGE_NOTE } from '@/lib/copy/tone';
import {
  Badge, EmptyState, Panel, PanelBody, PanelHeader, RarityBadge, Stat, TimingBar,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { cn, formatHours, formatNumber } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export interface ChallengeRow {
  id: string;
  scope: ChallengeScope;
  title: string;
  description: string;
  value: number;
  target: number;
  completed: boolean;
  expired: boolean;
  xpReward: number;
  endsAt: string;
}

const SCOPE_LABEL: Record<ChallengeScope, string> = {
  DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', SEASONAL: 'Seasonal',
};

export function ChallengesPanel({ challenges }: { challenges: ChallengeRow[] }) {
  const grouped = (['DAILY', 'WEEKLY', 'MONTHLY', 'SEASONAL'] as const)
    .map((scope) => ({ scope, items: challenges.filter((c) => c.scope === scope) }))
    .filter((group) => group.items.length > 0);

  return (
    <Panel>
      <PanelHeader
        title="Challenges"
        icon={<ListChecks size={12} />}
        action={
          <Link href="/challenges" className="text-[0.6875rem] text-ink-dim transition-colors hover:text-ink-muted">
            All challenges
          </Link>
        }
      />

      {grouped.length === 0 ? (
        <EmptyState
          title="No challenges just now"
          body="Challenges are generated from the races in your library. Add a few and some will appear."
        />
      ) : (
        <div className="divide-y divide-hairline">
          {grouped.map((group) => (
            <div key={group.scope} className="px-4 py-3">
              <div className="label mb-2">{SCOPE_LABEL[group.scope]}</div>
              <ul className="space-y-2">
                {group.items.slice(0, 4).map((challenge) => (
                  <ChallengeItem key={challenge.id} challenge={challenge} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="border-t border-hairline px-4 py-2.5 text-[0.6875rem] text-ink-faint">
        Optional, always. Nothing is deducted for letting one pass.
      </p>
    </Panel>
  );
}

function ChallengeItem({ challenge }: { challenge: ChallengeRow }) {
  const progress = challenge.target > 0 ? Math.min(1, challenge.value / challenge.target) : 0;

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn('truncate text-xs', challenge.completed ? 'text-ink-muted' : 'text-ink')}>
          {challenge.completed ? <Check size={11} className="mr-1 inline text-verde" /> : null}
          {challenge.title}
        </span>
        <span className="timing shrink-0 text-[0.6875rem] text-ink-faint">
          {challenge.expired ? 'closed' : `${formatNumber(Math.min(challenge.value, challenge.target), challenge.target % 1 === 0 ? 0 : 1)}/${formatNumber(challenge.target, challenge.target % 1 === 0 ? 0 : 1)}`}
        </span>
      </div>
      <TimingBar
        value={progress * 100}
        className="mt-1.5"
        height="h-1"
        color={challenge.completed ? 'var(--color-verde)' : undefined}
        track={challenge.expired ? 'bg-panel-2' : 'bg-panel-3'}
        label={challenge.title}
      />
      {challenge.expired ? (
        <p className="mt-1 text-[0.625rem] text-ink-faint">{EXPIRED_CHALLENGE_NOTE}</p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Season pass
// ---------------------------------------------------------------------------

export interface SeasonPassSummaryData {
  label: string;
  tier: number;
  tierCount: number;
  seasonXp: number;
  intoTier: number;
  tierCost: number;
  daysRemaining: number;
  nextRewardName: string | null;
  nextRewardRarity: Rarity | null;
}

export function SeasonPassPanel({ pass }: { pass: SeasonPassSummaryData | null }) {
  if (!pass) {
    return (
      <Panel>
        <PanelHeader title="Season pass" icon={<Ticket size={12} />} />
        <EmptyState title="No pass open" body="A new quarterly pass opens automatically." />
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title={`Season pass · ${pass.label}`}
        icon={<Ticket size={12} />}
        action={
          <Link href="/season-pass" className="text-[0.6875rem] text-ink-dim transition-colors hover:text-ink-muted">
            View track
          </Link>
        }
      />
      <PanelBody className="space-y-3.5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="label mb-1">Tier</div>
            <div className="flex items-baseline gap-1.5">
              <span className="timing text-timing text-[var(--accent)]">{pass.tier}</span>
              <span className="timing text-sm text-ink-faint">/ {pass.tierCount}</span>
            </div>
          </div>
          <div className="text-right">
            <Stat label="Season XP" value={formatNumber(pass.seasonXp)} size="sm" tone="muted" />
          </div>
        </div>

        <div>
          <TimingBar
            value={pass.tierCost > 0 ? (pass.intoTier / pass.tierCost) * 100 : 0}
            height="h-1.5"
            label="Progress to the next tier"
          />
          <div className="mt-1.5 flex justify-between text-[0.6875rem] text-ink-faint">
            <span className="timing">{formatNumber(pass.intoTier)} / {formatNumber(pass.tierCost)}</span>
            <span className="inline-flex items-center gap-1">
              <Clock size={10} /> {pass.daysRemaining} days left
            </span>
          </div>
        </div>

        {pass.nextRewardName ? (
          <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3">
            <div className="min-w-0">
              <div className="label mb-0.5">Next up</div>
              <div className="truncate text-xs text-ink-muted">{pass.nextRewardName}</div>
            </div>
            {pass.nextRewardRarity ? <RarityBadge rarity={pass.nextRewardRarity} /> : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Recent unlocks
// ---------------------------------------------------------------------------

export interface UnlockRowData {
  key: string;
  kind: 'achievement' | 'mastery' | 'trophy' | 'hall-of-fame';
  name: string;
  detail: string | null;
  rarity: Rarity | null;
  at: string;
  href: string;
}

const KIND_ICON = {
  achievement: Award,
  mastery: Layers,
  trophy: Trophy,
  'hall-of-fame': Trophy,
} as const;

export function RecentUnlocks({ unlocks }: { unlocks: UnlockRowData[] }) {
  return (
    <Panel>
      <PanelHeader title="Recent unlocks" />
      {unlocks.length === 0 ? (
        <EmptyState
          title="Nothing unlocked yet"
          body="Achievements, mastery nodes and trophies appear here as they arrive."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {unlocks.slice(0, 8).map((unlock) => {
            const Icon = KIND_ICON[unlock.kind];
            return (
              <li key={unlock.key}>
                <Link
                  href={unlock.href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-panel-2/60"
                >
                  <Icon size={13} className="shrink-0 text-ink-dim" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-ink">{unlock.name}</div>
                    {unlock.detail ? (
                      <div className="truncate text-[0.6875rem] text-ink-faint">{unlock.detail}</div>
                    ) : null}
                  </div>
                  {unlock.rarity ? <RarityBadge rarity={unlock.rarity} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Career snapshot
// ---------------------------------------------------------------------------

export interface CareerSnapshotData {
  realHours: number;
  storyCompletes: number;
  seasonsCompleted: number;
  level: number;
  racesInLibrary: number;
  championships: number;
  circuits: number;
  equivalentDays: number;
}

export function CareerSnapshot({ snapshot }: { snapshot: CareerSnapshotData }) {
  return (
    <Panel>
      <PanelHeader
        title="Career snapshot"
        action={
          <Link href="/stats" className="text-[0.6875rem] text-ink-dim transition-colors hover:text-ink-muted">
            Full statistics
          </Link>
        }
      />
      <PanelBody className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        <Stat
          label="Lifetime hours"
          value={formatHours(snapshot.realHours)}
          sub={`${snapshot.equivalentDays.toFixed(1)} days of racing`}
          size="sm"
        />
        <Stat label="Complete stories" value={formatNumber(snapshot.storyCompletes)} size="sm" />
        <Stat label="Seasons completed" value={formatNumber(snapshot.seasonsCompleted)} size="sm" />
        <Stat label="Career level" value={formatNumber(snapshot.level)} size="sm" tone="accent" />
        <Stat label="In the library" value={formatNumber(snapshot.racesInLibrary)} size="sm" tone="muted" />
        <Stat label="Championships" value={formatNumber(snapshot.championships)} size="sm" tone="muted" />
        <Stat label="Circuits" value={formatNumber(snapshot.circuits)} size="sm" tone="muted" />
        <div className="flex items-end">
          <Link href="/hall-of-fame">
            <Button variant="subtle" size="sm">Hall of Fame</Button>
          </Link>
        </div>
      </PanelBody>
    </Panel>
  );
}

/** Badge is re-exported here so dashboard consumers have one import site. */
export { Badge };
