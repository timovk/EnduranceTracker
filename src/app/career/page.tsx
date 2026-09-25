import Link from 'next/link';
import { Milestone } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { CareerLadder } from '@/components/dashboard/career-ladder';
import { XpLedgerTable } from '@/components/dashboard/xp-ledger-table';
import { Panel, PanelBody, PanelHeader, ProgressRing, Stat, TimingBar } from '@/components/ui/primitives';
import { getCareerView, getXpLedger, levelLadder } from '@/lib/server/career';
import { getMomentum, getStreak } from '@/lib/engines/momentum-engine';
import { computeCareerMetrics } from '@/lib/engines/metrics';
import { xpBySource } from '@/lib/engines/xp-ledger';
import { listRecentCareerMilestones } from '@/lib/engines/career-milestone-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';
import { getAccount } from '@/lib/auth/accounts';
import { getEffectiveCosmetics } from '@/lib/server/cosmetics';
import { BadgeEmblem } from '@/components/cosmetics/badge-emblem';
import { BannerArt } from '@/components/cosmetics/banner-art';
import { welcomeBack, momentumNote, precisionLabel } from '@/lib/copy/tone';
import { cn, formatHours, formatNumber } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Career' };

export default async function CareerPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);

  const [career, ledger, momentum, streak, metrics, bySource, cosmetics, account, milestones] = await Promise.all([
    getCareerView(userId),
    getXpLedger(userId),
    getMomentum(userId).catch(() => null),
    getStreak(userId).catch(() => null),
    computeCareerMetrics(userId),
    xpBySource(userId),
    getEffectiveCosmetics(userId),
    getAccount(userId),
    listRecentCareerMilestones(userId, 3),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="Permanent record"
        title="Your endurance career"
        description="Career XP never resets. Prestige is purely additive — it takes nothing away, ever."
      />

      <Panel>
        {/* The banner earned through the season pass, chosen in Settings. */}
        {cosmetics.bannerKey ? (
          <BannerArt bannerKey={cosmetics.bannerKey} className="h-24 border-b border-hairline" />
        ) : null}
        <PanelBody className="flex flex-wrap items-center gap-8">
          <ProgressRing progress={career.progress} size={116} stroke={7} ariaLabel={`Level ${career.level}`}>
            <div>
              <div className="timing text-[2rem] leading-none text-ink">{career.level}</div>
              <div className="label mt-1 text-[0.5rem]">Level</div>
            </div>
          </ProgressRing>

          <div className="min-w-0 flex-1 space-y-3">
            {account ? (
              <div className="flex items-center gap-2.5">
                <span className="truncate text-xl font-semibold text-ink">{account.name}</span>
                {cosmetics.badgeKey ? <BadgeEmblem badgeKey={cosmetics.badgeKey} size={28} /> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-medium text-ink">{career.title}</span>
              {career.prestige > 0 ? (
                <span className="rounded border border-[var(--accent)]/45 bg-[var(--accent-soft)] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[var(--accent)]">
                  {career.prestigeLabel}
                </span>
              ) : null}
            </div>

            <div>
              <TimingBar value={career.progress * 100} height="h-1.5" label="Progress to the next level" />
              <div className="mt-1.5 flex justify-between text-[0.6875rem] text-ink-faint">
                <span className="timing">{formatNumber(career.xpIntoLevel)} / {formatNumber(career.xpForLevel)} XP</span>
                <span>Level {career.level + 1}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-dim">
              <span>Career XP <span className="timing text-ink-muted">{formatNumber(career.careerXp)}</span></span>
              {career.nextTitle ? (
                <span>{career.nextTitle.title} at level <span className="timing text-ink-muted">{career.nextTitle.level}</span></span>
              ) : null}
              {career.nextPrestigeLevel ? (
                <span>{career.nextPrestigeLabel} at level <span className="timing text-ink-muted">{career.nextPrestigeLevel}</span></span>
              ) : null}
            </div>
          </div>

          <div className="min-w-[13rem] max-w-xs">
            <div className="label mb-1.5">Paddock</div>
            <p className="text-sm leading-relaxed text-ink-muted">
              {welcomeBack(streak?.daysSinceLastActive ?? career.daysSinceLastActive)}
            </p>
            {momentum ? (
              <p className="mt-2 text-xs text-ink-dim">{momentumNote(momentum.tierName)}</p>
            ) : null}
          </div>
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Consistency" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Current streak" value={`${streak?.currentDays ?? career.currentStreakDays}d`} size="sm" />
              <Stat label="Longest streak" value={`${streak?.longestDays ?? career.longestStreakDays}d`} size="sm" tone="accent" />
              <Stat label="Active days" value={formatNumber(streak?.lifetimeActiveDays ?? career.lifetimeActiveDays)} size="sm" tone="muted" />
              <Stat label="Active weeks" value={formatNumber(streak?.lifetimeActiveWeeks ?? career.lifetimeActiveWeeks)} size="sm" tone="muted" />
            </div>
            <p className="border-t border-hairline pt-3 text-xs leading-relaxed text-ink-dim">
              A streak that ends simply stops counting — the record it set is kept for good. Nothing
              is ever taken away for a quiet fortnight.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Lifetime" />
          <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Real hours" value={formatHours(metrics.realHours)} size="sm" />
            <Stat label="Timeline hours" value={formatHours(metrics.timelineHours)} size="sm" tone="muted" />
            <Stat label="Sessions" value={formatNumber(metrics.sessions)} size="sm" tone="muted" />
            <Stat label="Stories complete" value={formatNumber(metrics.storyCompletes)} size="sm" />
            <Stat label="Seasons" value={formatNumber(metrics.seasonsCompleted)} size="sm" tone="muted" />
            <Stat label="Circuits" value={formatNumber(metrics.circuits)} size="sm" tone="muted" />
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Career Milestones"
          icon={<Milestone size={13} />}
          action={
            <Link href="/career/milestones" className="text-[0.6875rem] text-ink-dim transition-colors hover:text-ink-muted">
              See all
            </Link>
          }
        />
        {milestones.length === 0 ? (
          <PanelBody>
            <p className="text-sm text-ink-dim">
              The first milestone arrives with your first stint, and each one keeps the date it happened.
            </p>
          </PanelBody>
        ) : (
          <ul className="divide-y divide-hairline">
            {milestones.map((milestone) => (
              <li key={milestone.key} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    milestone.celebration === 'none' ? 'bg-ink-faint' : 'bg-[var(--accent)]',
                  )}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{milestone.title}</div>
                  <div className="text-[0.6875rem] text-ink-faint">
                    {precisionLabel(milestone.precision, milestone.date, milestone.subjectName)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <CareerLadder rungs={levelLadder(career.level)} />

      <Panel>
        <PanelHeader title="Where the XP came from" />
        <PanelBody>
          {bySource.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-dim">Nothing earned yet.</p>
          ) : (
            <ul className="space-y-2">
              {bySource.map((row) => {
                const share = career.careerXp > 0 ? (row.amount / career.careerXp) * 100 : 0;
                return (
                  <li key={row.source}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-ink-muted">{sourceLabel(row.source)}</span>
                      <span className="timing text-ink-dim">
                        {formatNumber(row.amount)} · {share.toFixed(0)}%
                      </span>
                    </div>
                    <TimingBar value={share} height="h-1" className="mt-1" label={sourceLabel(row.source)} />
                  </li>
                );
              })}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <XpLedgerTable rows={ledger} />
    </div>
  );
}

function sourceLabel(source: string): string {
  return source
    .toLowerCase()
    .split('_')
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}
