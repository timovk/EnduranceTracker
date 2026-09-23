'use client';

/**
 * The stint summary.
 *
 * Watching only 25 minutes should still feel worthwhile, so every logged
 * session gets a summary — but the presentation is deliberately graded. An
 * ordinary stint gets a quiet, satisfying panel. The full-screen treatment is
 * reserved for the rare things: a completed 24-hour race, a finished season, a
 * major career milestone. Over-celebrating the ordinary is what turns a hobby
 * into homework.
 */

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Award, Check, Layers, ListChecks, Ticket, Trophy, Zap } from 'lucide-react';
import type { SessionOutcome } from '@/lib/engines/contracts';
import { formatDuration } from '@/lib/domain/time';
import { seasonClosedStintNote } from '@/lib/copy/tone';
import { Panel, RarityBadge, SectorRule, TimingBar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { cn, formatDate, formatHours, formatNumber } from '@/lib/utils';

export function StintSummary({
  outcome, onDismiss, nextHref = '/planner',
}: {
  outcome: SessionOutcome;
  onDismiss?: () => void;
  nextHref?: string;
}) {
  const spectacular = outcome.celebrate === 'SPECTACULAR';

  return (
    <div className={cn('animate-[rise_0.42s_var(--ease-out-quint)_both]', spectacular && 'space-y-4')}>
      <Panel raised={spectacular} className={cn(spectacular && 'border-[var(--accent)]/45')}>
        {/* Heading. The words change with the length of the stint, never the tone. */}
        <div className="relative px-5 pb-4 pt-5">
          {spectacular ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-24"
              style={{ background: 'linear-gradient(180deg, var(--accent-soft), transparent)' }}
            />
          ) : null}

          <div className="relative flex flex-wrap items-baseline justify-between gap-2">
            <h2
              className={cn(
                'font-semibold uppercase tracking-[0.18em]',
                spectacular ? 'text-lg text-[var(--accent)]' : 'text-sm text-ink-muted',
              )}
            >
              {outcome.storyCompleted ? 'Story Complete' : outcome.heading}
            </h2>
            <span className="text-xs text-ink-dim">{outcome.raceName}</span>
          </div>

          <div className="relative mt-4 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            <Figure label="Watched" value={formatDuration(outcome.realSeconds)} big={spectacular} />
            <Figure label="Race progress" value={`+${formatDuration(outcome.timelineSeconds)}`} big={spectacular} />
            <Figure
              label="Completion"
              value={`${outcome.coverageBeforePercent.toFixed(0)}% → ${outcome.coverageAfterPercent.toFixed(0)}%`}
              big={spectacular}
            />
            <Figure label="Playback" value={`${outcome.playbackSpeed}×`} big={spectacular} />
          </div>

          <TimingBar
            value={outcome.coverageAfterPercent}
            className="mt-4"
            height="h-1.5"
            label="Race completion"
          />
        </div>

        <SectorRule />

        {/* XP. Ordinary watching is the main source, and it reads that way. */}
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="label mb-1 flex items-center gap-1"><Zap size={11} /> Career XP</div>
              <div className="timing text-2xl text-[var(--accent)]">
                +{formatNumber(outcome.careerXpAwarded)}
              </div>
            </div>
            {/* While the season pass is closed there is no season XP to show,
                and a "+0" would read as something withheld. */}
            {outcome.seasonClosure ? null : (
              <div>
                <div className="label mb-1">Season XP</div>
                <div className="timing text-2xl text-ink-muted">+{formatNumber(outcome.seasonXpAwarded)}</div>
              </div>
            )}
            {outcome.levelsGained > 0 ? (
              <div>
                <div className="label mb-1">Career level</div>
                <div className="timing text-2xl text-verde">
                  {outcome.levelBefore} → {outcome.levelAfter}
                </div>
              </div>
            ) : null}
            {outcome.newTitle ? (
              <div className="min-w-0">
                <div className="label mb-1">New title</div>
                <div className="truncate text-sm text-ink">{outcome.newTitle}</div>
              </div>
            ) : null}
          </div>

          {outcome.seasonClosure ? (
            <p className="mt-2 text-xs text-ink-faint">
              {seasonClosedStintNote(formatDate(outcome.seasonClosure.reopensAt, 'long'))}
            </p>
          ) : null}

          {outcome.xpBreakdown.length > 1 ? (
            <ul className="mt-3 space-y-1 border-t border-hairline pt-3">
              {outcome.xpBreakdown.map((line, i) => (
                <li key={`${line.label}-${i}`} className="flex items-baseline justify-between gap-4 text-xs">
                  <span className="truncate text-ink-dim">{line.label}</span>
                  <span className="timing shrink-0 text-ink-muted">+{formatNumber(line.amount)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Everything the stint unlocked. Sections only appear when non-empty. */}
        {hasUnlocks(outcome) ? (
          <>
            <SectorRule />
            <div className="space-y-3 px-5 py-4">
              <UnlockGroup icon={<Award size={12} />} title="Achievements">
                {outcome.achievements.map((a) => (
                  <UnlockRow key={a.key} name={a.name} detail={a.description} xp={a.xpAwarded}>
                    <RarityBadge rarity={a.rarity} />
                  </UnlockRow>
                ))}
              </UnlockGroup>

              <UnlockGroup icon={<Layers size={12} />} title="Mastery">
                {outcome.mastery.map((m) => (
                  <UnlockRow
                    key={`${m.treeKey}:${m.nodeKey}`}
                    name={`${m.treeName} — ${m.nodeName}`}
                    detail={m.treeCompleted ? 'Mastery tree complete' : `${Math.round(m.treeProgress * 100)}% of the tree`}
                    xp={m.xpAwarded}
                  />
                ))}
              </UnlockGroup>

              <UnlockGroup icon={<ListChecks size={12} />} title="Challenges">
                {outcome.challenges.map((c) => (
                  <UnlockRow key={c.id} name={c.title} detail={c.scope.toLowerCase()} xp={c.xpAwarded} />
                ))}
              </UnlockGroup>

              <UnlockGroup icon={<Zap size={12} />} title="Milestones">
                {outcome.milestones.map((m) => (
                  <UnlockRow
                    key={`${m.metric}:${m.threshold}`}
                    name={milestoneLabel(m.threshold, m.label)}
                    xp={m.xpAwarded}
                  />
                ))}
              </UnlockGroup>

              <UnlockGroup icon={<Ticket size={12} />} title="Season pass">
                {outcome.seasonPassTiers.map((t) => (
                  <UnlockRow key={t.tier} name={`Tier ${t.tier} — ${t.rewardName}`}>
                    <RarityBadge rarity={t.rarity} />
                  </UnlockRow>
                ))}
              </UnlockGroup>

              <UnlockGroup icon={<Trophy size={12} />} title="Trophies">
                {outcome.trophies.map((t) => (
                  <UnlockRow key={t.key} name={t.name} detail={t.description}>
                    <RarityBadge rarity={t.rarity} />
                  </UnlockRow>
                ))}
              </UnlockGroup>

              <UnlockGroup icon={<Trophy size={12} />} title="Hall of Fame">
                {outcome.hallOfFame.map((h) => (
                  <UnlockRow key={h.key} name={h.title} detail={h.subtitle ?? undefined} />
                ))}
              </UnlockGroup>

              {outcome.collections.completedCollections.map((c) => (
                <div key={c.key} className="rounded-md border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-3 py-2.5">
                  <div className="label text-[var(--accent)]">Season Complete</div>
                  <div className="mt-0.5 text-sm text-ink">{c.name}</div>
                  <div className="mt-0.5 text-xs text-ink-dim">
                    {c.storyCompleteCount}/{c.itemCount} races Story Complete
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* Where you stand afterwards. Information, never a demand. */}
        <SectorRule />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 text-xs text-ink-dim">
          {outcome.weekRecommendedHours > 0 ? (
            <span>
              This week{' '}
              <span className="timing text-ink-muted">
                {formatHours(outcome.weekActualHours)} / {formatHours(outcome.weekRecommendedHours)}
              </span>
            </span>
          ) : null}
          {outcome.championshipMastery ? (
            <span>
              {outcome.championshipMastery.name} mastery{' '}
              <span className="timing text-ink-muted">{Math.round(outcome.championshipMastery.percent)}%</span>
            </span>
          ) : null}
          <span>
            Momentum <span className="text-ink-muted">{outcome.momentum.tierName}</span>
          </span>
          {outcome.streak.currentDays > 1 ? (
            <span>
              <span className="timing text-ink-muted">{outcome.streak.currentDays}</span> day streak
            </span>
          ) : null}
        </div>
      </Panel>

      {/* After a completion, the application asks where the career goes next. */}
      {outcome.storyCompleted ? (
        <Panel className="px-5 py-4">
          <p className="text-sm text-ink-muted">Where does your endurance career go next?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={nextHref}>
              <Button variant="primary" size="sm">
                Ask the Race Strategist <ArrowRight size={13} />
              </Button>
            </Link>
            <Link href="/races">
              <Button variant="subtle" size="sm">Back to the library</Button>
            </Link>
          </div>
        </Panel>
      ) : null}

      {onDismiss ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onDismiss}>Close</Button>
        </div>
      ) : null}
    </div>
  );
}

function Figure({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label mb-1">{label}</div>
      <div className={cn('timing truncate text-ink', big ? 'text-xl sm:text-2xl' : 'text-[1rem] sm:text-lg')}>
        {value}
      </div>
    </div>
  );
}

function UnlockGroup({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div>
      <div className="label mb-1.5 flex items-center gap-1.5">{icon}{title}</div>
      <ul className="space-y-1">{items}</ul>
    </div>
  );
}

function UnlockRow({
  name, detail, xp, children,
}: { name: string; detail?: string; xp?: number; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 rounded-md border border-hairline bg-panel-2 px-2.5 py-1.5">
      <Check size={12} className="shrink-0 text-verde" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-ink">{name}</div>
        {detail ? <div className="truncate text-[0.6875rem] text-ink-faint">{detail}</div> : null}
      </div>
      {children}
      {xp && xp > 0 ? <span className="timing shrink-0 text-[0.6875rem] text-ink-dim">+{formatNumber(xp)}</span> : null}
    </li>
  );
}

/**
 * "5 real viewing hours", but "1 real viewing hour".
 *
 * Milestone labels are written plural because that is how they read on the
 * board; the very first rung of a ladder is the one case where that grates.
 * Only the final word is touched, and only the two English plural endings that
 * actually occur in these labels — this is not a general-purpose inflector and
 * is not trying to be.
 */
export function milestoneLabel(threshold: number, label: string): string {
  const lower = label.toLowerCase();
  if (threshold !== 1) return `${formatNumber(threshold)} ${lower}`;

  const words = lower.split(' ');
  const last = words[words.length - 1] ?? '';
  if (last.endsWith('ies')) words[words.length - 1] = `${last.slice(0, -3)}y`;
  else if (last.endsWith('s') && !last.endsWith('ss')) words[words.length - 1] = last.slice(0, -1);

  return `${formatNumber(threshold)} ${words.join(' ')}`;
}

function hasUnlocks(outcome: SessionOutcome): boolean {
  return (
    outcome.achievements.length > 0 ||
    outcome.mastery.length > 0 ||
    outcome.challenges.length > 0 ||
    outcome.milestones.length > 0 ||
    outcome.seasonPassTiers.length > 0 ||
    outcome.trophies.length > 0 ||
    outcome.hallOfFame.length > 0 ||
    outcome.collections.completedCollections.length > 0
  );
}
