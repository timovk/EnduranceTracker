'use client';

/**
 * The statistics section.
 *
 * Two distinctions are load-bearing here and are labelled everywhere they
 * appear, because conflating them would quietly make every figure a lie:
 *
 *   * REAL VIEWING TIME is wall-clock time in front of the screen, re-watches
 *     included.
 *   * UNIQUE COVERAGE is race timeline seen at least once. Re-watching does
 *     not increase it.
 *
 * Every percentage is scoped to something the user defined — this filter, a
 * season, a championship, a quarter. There is deliberately no figure anywhere
 * on this page measuring a career against every endurance race ever run.
 */

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { StatisticsView as Stats, StatsFilterOptions } from '@/lib/engines/stats-engine';
import { formatDuration } from '@/lib/domain/time';
import { Panel, PanelBody, PanelHeader, Stat, TimingBar, EmptyState } from '@/components/ui/primitives';
import { Button, Segmented, Select } from '@/components/ui/controls';
import { cn, formatDate, formatHours, formatNumber } from '@/lib/utils';

export function StatisticsView({
  stats, options,
}: { stats: Stats; options: StatsFilterOptions }) {
  const [tab, setTab] = React.useState<'overview' | 'cadence' | 'breakdown' | 'career'>('overview');

  return (
    <div className="space-y-4">
      <FilterBar options={options} scopeLabel={stats.scopeLabel} />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'cadence', label: 'Cadence' },
          { value: 'breakdown', label: 'Breakdown' },
          { value: 'career', label: 'Career' },
        ]}
      />

      {tab === 'overview' ? <Overview stats={stats} /> : null}
      {tab === 'cadence' ? <Cadence stats={stats} /> : null}
      {tab === 'breakdown' ? <Breakdown stats={stats} /> : null}
      {tab === 'career' ? <Career stats={stats} /> : null}

      <p className="px-1 pb-2 text-[0.6875rem] leading-relaxed text-ink-faint">
        {stats.completion.note}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterBar({
  options, scopeLabel,
}: { options: StatsFilterOptions; scopeLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const hasFilter = [...params.keys()].length > 0;

  return (
    <Panel>
      <PanelHeader
        title={`Scope · ${scopeLabel}`}
        action={
          hasFilter ? (
            <Button variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
              Clear
            </Button>
          ) : null
        }
      />
      <PanelBody className="flex flex-wrap gap-2.5">
        <Select className="w-auto" value={params.get('year') ?? ''} onChange={(e) => update('year', e.target.value)} aria-label="Year">
          <option value="">All years</option>
          {options.years.map((y) => (
            <option key={y.year} value={y.year}>{y.year} ({formatHours(y.realHours)})</option>
          ))}
        </Select>

        <Select className="w-auto" value={params.get('championship') ?? ''} onChange={(e) => update('championship', e.target.value)} aria-label="Championship">
          <option value="">All championships</option>
          {options.championships.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>

        <Select className="w-auto" value={params.get('season') ?? ''} onChange={(e) => update('season', e.target.value)} aria-label="Season">
          <option value="">All seasons</option>
          {options.seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </Select>

        <Select className="w-auto" value={params.get('circuit') ?? ''} onChange={(e) => update('circuit', e.target.value)} aria-label="Circuit">
          <option value="">All circuits</option>
          {options.circuits.map((c) => (
            <option key={c.circuitSlug} value={c.circuitSlug}>{c.name}</option>
          ))}
        </Select>

        <Select className="w-auto" value={params.get('type') ?? ''} onChange={(e) => update('type', e.target.value)} aria-label="Race length">
          <option value="">Any length</option>
          {options.durations.map((d) => (
            <option key={d.raceType} value={d.raceType}>{d.label}</option>
          ))}
        </Select>

        <Select className="w-auto" value={params.get('status') ?? ''} onChange={(e) => update('status', e.target.value)} aria-label="Completion state">
          <option value="">Any state</option>
          {options.statuses.map((s) => (
            <option key={s.status} value={s.status}>{s.label}</option>
          ))}
        </Select>

        <Button
          variant={params.get('complete') === '1' ? 'primary' : 'subtle'}
          size="sm"
          onClick={() => update('complete', params.get('complete') === '1' ? '' : '1')}
        >
          Story Complete only
        </Button>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ stats }: { stats: Stats }) {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Time" />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
            <Stat
              label="Real viewing time"
              value={formatHours(stats.viewing.realHours)}
              sub="wall clock, re-watches included"
              size="lg"
            />
            <Stat
              label="Unique coverage"
              value={formatHours(stats.viewing.uniqueCoverageHours)}
              sub="race timeline seen at least once"
              size="lg"
              tone="accent"
            />
            <Stat
              label="Timeline played"
              value={formatHours(stats.viewing.timelinePlayedHours)}
              sub="including sections seen twice"
              size="lg"
              tone="muted"
            />
            <Stat
              label="Equivalent days"
              value={stats.viewing.equivalentDays.toFixed(1)}
              sub="of continuous watching"
              size="lg"
              tone="muted"
            />
          </div>
          <p className="border-t border-hairline pt-3 text-xs leading-relaxed text-ink-dim">
            Real viewing time and unique coverage are different quantities. Watching an hour and
            then re-watching half of it is 1h 30m of real time and 1h of coverage — the race is
            only ever counted as watched once.
          </p>
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Races" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="In scope" value={formatNumber(stats.races.racesInScope)} size="sm" tone="muted" />
              <Stat label="Started" value={formatNumber(stats.races.racesStarted)} size="sm" tone="muted" />
              <Stat label="Completed" value={formatNumber(stats.races.racesCompleted)} size="sm" />
              <Stat label="Story Complete" value={formatNumber(stats.races.racesStoryComplete)} size="sm" tone="accent" />
              <Stat label="Average length" value={formatDuration(stats.races.averageRuntimeSec)} size="sm" tone="muted" />
              <Stat label="Longest" value={formatDuration(stats.races.longestRuntimeSec)} size="sm" tone="muted" />
            </div>
            <div>
              <TimingBar value={stats.races.storyCompletePercent} height="h-1.5" label="Story Complete" />
              <p className="mt-1.5 text-[0.6875rem] text-ink-faint">{stats.races.libraryNote}</p>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Sessions" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Stints" value={formatNumber(stats.sessions.sessions)} size="sm" />
              <Stat label="Average length" value={`${stats.sessions.averageRealMinutes.toFixed(0)}m`} size="sm" tone="muted" />
              <Stat label="Longest" value={formatDuration(stats.sessions.longestRealSeconds)} size="sm" tone="muted" />
              <Stat label="Average speed" value={`${stats.sessions.averagePlaybackSpeed.toFixed(2)}×`} size="sm" tone="muted" />
              <Stat label="Per active day" value={stats.sessions.averageSessionsPerActiveDay.toFixed(1)} size="sm" tone="muted" />
            </div>
            {stats.sessions.longestSession ? (
              <p className="border-t border-hairline pt-3 text-[0.6875rem] text-ink-faint">
                Longest stint: {formatDuration(stats.sessions.longestRealSeconds)} on{' '}
                {stats.sessions.longestSession.raceName}
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Favourites" />
        <PanelBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Favourite label="Championship by hours" entry={stats.favourites.championshipByHours} />
          <Favourite label="Championship by completions" entry={stats.favourites.championshipByCompletions} />
          <Favourite label="Circuit" entry={stats.favourites.circuit} />
          <Favourite label="Most-watched event" entry={stats.favourites.event} />
          <Favourite label="Most-watched race" entry={stats.favourites.race} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Completion" />
        <PanelBody className="space-y-3">
          {/* Keyed by which figure it is, not by its label: two scopes can
              legitimately describe themselves the same way. */}
          {([
            ['achievements', stats.completion.achievements],
            ['mastery', stats.completion.mastery],
            ['library', stats.completion.library],
            ['story-library', stats.completion.storyLibrary],
          ] as const).map(([key, scoped]) => (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-ink-muted">{scoped.scope}</span>
                <span className="timing text-ink-dim">
                  {formatNumber(scoped.done)} / {formatNumber(scoped.total)} · {scoped.percent.toFixed(0)}%
                </span>
              </div>
              <TimingBar value={scoped.percent} height="h-1" className="mt-1" label={scoped.scope} />
            </div>
          ))}
        </PanelBody>
      </Panel>
    </div>
  );
}

function Favourite({ label, entry }: { label: string; entry: Stats['favourites']['circuit'] }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      {entry ? (
        <>
          <div className="truncate text-sm text-ink">{entry.name}</div>
          <div className="mt-0.5 text-[0.6875rem] text-ink-faint">{entry.detail}</div>
        </>
      ) : (
        <div className="text-sm text-ink-faint">—</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

function Cadence({ stats }: { stats: Stats }) {
  const monthly = stats.monthly.slice(-24).map((m) => ({
    label: m.label.replace(/ \d{4}$/, ''),
    full: m.label,
    hours: m.realHours,
    coverage: Math.round((m.newCoverageSeconds / 3600) * 10) / 10,
    sessions: m.sessions,
  }));

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Averages" />
        <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Per week" value={formatHours(stats.cadence.averageRealHoursPerWeek)} size="sm" />
          <Stat label="Per active week" value={formatHours(stats.cadence.averageRealHoursPerActiveWeek)} size="sm" tone="muted" />
          <Stat label="Per month" value={formatHours(stats.cadence.averageRealHoursPerMonth)} size="sm" tone="muted" />
          <Stat
            label={`Recent (${stats.cadence.recentMonths} months)`}
            value={formatHours(stats.cadence.recentAverageRealHoursPerWeek)}
            sub="per week"
            size="sm"
            tone="accent"
          />
          <Stat label="Active days" value={formatNumber(stats.cadence.activeDays)} size="sm" tone="muted" />
          <Stat label="Active weeks" value={formatNumber(stats.cadence.activeWeeks)} size="sm" tone="muted" />
          <Stat label="Active months" value={formatNumber(stats.cadence.activeMonths)} size="sm" tone="muted" />
          <Stat
            label="Most active month"
            value={stats.cadence.mostActiveMonth?.label ?? '—'}
            sub={stats.cadence.mostActiveMonth ? formatHours(stats.cadence.mostActiveMonth.realHours) : undefined}
            size="sm"
            mono={false}
            tone="muted"
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Month by month" />
        <PanelBody>
          {monthly.length === 0 ? (
            <EmptyState title="Nothing recorded yet" body="Log a stint and this fills in." />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 4, right: 4, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke="#222c37" vertical={false} />
                  <XAxis dataKey="label" stroke="#64717e" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64717e" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip unit="h" />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="hours" name="Real hours" fill="var(--color-gold)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="coverage" name="New coverage" fill="var(--color-azure)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Year by year" />
        {stats.years.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">Year</th>
                  <th className="label px-4 py-2 text-right font-semibold">Real hours</th>
                  <th className="label px-4 py-2 text-right font-semibold">Stints</th>
                  <th className="label px-4 py-2 text-right font-semibold">Active days</th>
                  <th className="label px-4 py-2 text-right font-semibold">Stories</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {stats.years.map((year) => (
                  <tr key={year.year}>
                    <td className="timing px-4 py-2 text-xs text-ink">{year.year}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-muted">{formatHours(year.realHours)}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{year.sessions}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{year.activeDays}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{year.racesStoryComplete}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Annual plan" />
        {stats.budgetHistory.length === 0 ? (
          <EmptyState title="No plan recorded yet" />
        ) : (
          <PanelBody className="space-y-3">
            {stats.budgetHistory.map((year) => (
              <div key={year.year}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className={cn(year.isCurrent ? 'text-ink' : 'text-ink-muted')}>
                    {year.year}{year.isCurrent ? ' · in progress' : ''}
                  </span>
                  <span className="timing text-ink-dim">
                    {formatHours(year.actualHours)} of {formatHours(year.annualBudgetHours, 0)} · {year.percentOfPlan.toFixed(0)}%
                  </span>
                </div>
                <TimingBar value={year.percentOfPlan} height="h-1.5" className="mt-1" label={`${year.year} plan`} />
                <p className="mt-1 text-[0.625rem] text-ink-faint">
                  {formatHours(year.averageWeeklyHours)} a week across {year.weeksOnRecord} weeks
                  {year.restWeeks > 0 ? `, ${year.restWeeks} of them rest weeks` : ''}
                </p>
              </div>
            ))}
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

function Breakdown({ stats }: { stats: Stats }) {
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Championships" />
        {stats.championships.length === 0 ? (
          <EmptyState title="Nothing in scope" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">Championship</th>
                  <th className="label px-4 py-2 text-right font-semibold">Real hours</th>
                  <th className="label px-4 py-2 text-right font-semibold">Coverage</th>
                  <th className="label px-4 py-2 text-right font-semibold">Complete</th>
                  <th className="label px-4 py-2 text-right font-semibold">Speed</th>
                  <th className="label px-4 py-2 text-right font-semibold">Mastery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {stats.championships.map((row) => (
                  <tr key={row.championshipId ?? row.name}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2.5 w-0.5 shrink-0 rounded-full"
                          style={{ background: row.accentColor ?? 'var(--color-ink-faint)' }}
                        />
                        <span className="truncate text-xs text-ink">{row.name}</span>
                      </span>
                    </td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-muted">{formatHours(row.realHours)}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{formatHours(row.uniqueCoverageHours)}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">
                      {row.racesStoryComplete}/{row.racesInScope}
                    </td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{row.averagePlaybackSpeed.toFixed(2)}×</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">
                      {row.masteryPercent === null ? '—' : `${row.masteryPercent.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Circuits"
          action={<span className="timing text-[0.6875rem] text-ink-faint">{stats.circuits.length}</span>}
        />
        {stats.circuits.length === 0 ? (
          <EmptyState title="Nothing in scope" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">Circuit</th>
                  <th className="label px-4 py-2 font-semibold">Country</th>
                  <th className="label px-4 py-2 text-right font-semibold">Real hours</th>
                  <th className="label px-4 py-2 text-right font-semibold">Races</th>
                  <th className="label px-4 py-2 text-right font-semibold">Last watched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {stats.circuits.map((row) => (
                  <tr key={row.circuitSlug}>
                    <td className="px-4 py-2 text-xs text-ink">{row.name}</td>
                    <td className="px-4 py-2 text-xs text-ink-dim">{row.country ?? '—'}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-muted">{formatHours(row.realHours)}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">
                      {row.racesStoryComplete}/{row.racesInScope}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-ink-faint">{formatDate(row.lastWatchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------

function Career({ stats }: { stats: Stats }) {
  const xp = stats.xpHistory.slice(-24).map((point) => ({
    label: point.label.replace(/ \d{4}$/, ''),
    full: point.label,
    career: point.careerXp,
  }));

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="XP by month" />
        <PanelBody>
          {xp.length === 0 ? (
            <EmptyState title="Nothing earned yet" />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={xp} margin={{ top: 4, right: 4, bottom: 4, left: -8 }}>
                  <defs>
                    <linearGradient id="xpFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-gold)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--color-gold)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#222c37" vertical={false} />
                  <XAxis dataKey="label" stroke="#64717e" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64717e" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTooltip unit=" XP" />} cursor={{ stroke: '#31404e' }} />
                  <Area
                    type="monotone" dataKey="career" name="Career XP"
                    stroke="var(--color-gold)" strokeWidth={1.5} fill="url(#xpFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Levels reached" />
        {stats.levelHistory.length === 0 ? (
          <EmptyState title="Nothing yet" />
        ) : (
          <ul className="divide-y divide-hairline">
            {stats.levelHistory.slice(-14).map((point) => (
              <li key={point.level} className="flex items-center gap-4 px-4 py-2">
                <span className="timing w-10 shrink-0 text-right text-xs text-ink-dim">{point.level}</span>
                <span className={cn('min-w-0 flex-1 truncate text-xs', point.isTitleThreshold ? 'text-ink' : 'text-ink-faint')}>
                  {point.isTitleThreshold ? point.title : '—'}
                  {point.isPrestigeThreshold ? (
                    <span className="ml-2 text-[0.625rem] uppercase tracking-[0.1em] text-[var(--accent)]">prestige</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[0.6875rem] text-ink-faint">{formatDate(point.reachedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Season passes" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Quarters" value={formatNumber(stats.seasonPasses.passes)} size="sm" tone="muted" />
              <Stat label="Completed" value={formatNumber(stats.seasonPasses.completedPasses)} size="sm" />
              <Stat label="Tiers unlocked" value={formatNumber(stats.seasonPasses.tiersUnlocked)} size="sm" tone="muted" />
              <Stat label="Best tier" value={formatNumber(stats.seasonPasses.bestTier)} size="sm" tone="accent" />
              <Stat label="Average tier" value={stats.seasonPasses.averageTier.toFixed(0)} size="sm" tone="muted" />
              <Stat label="Season XP" value={formatNumber(stats.seasonPasses.seasonXpEarned)} size="sm" tone="muted" />
            </div>
            {stats.seasonPasses.bestQuarterLabel ? (
              <p className="border-t border-hairline pt-3 text-[0.6875rem] text-ink-faint">
                Best quarter so far: {stats.seasonPasses.bestQuarterLabel}
              </p>
            ) : null}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Challenges" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Offered" value={formatNumber(stats.challenges.offered)} size="sm" tone="muted" />
              <Stat label="Completed" value={formatNumber(stats.challenges.completed)} size="sm" />
              <Stat label="Still open" value={formatNumber(stats.challenges.active)} size="sm" tone="muted" />
              <Stat label="Windows closed" value={formatNumber(stats.challenges.closed)} size="sm" tone="muted" />
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-ink-muted">Of the challenges offered</span>
                <span className="timing text-ink-dim">
                  {formatNumber(stats.challenges.completed)} / {formatNumber(stats.challenges.offered)}
                </span>
              </div>
              <TimingBar
                value={stats.challenges.completionPercent}
                height="h-1.5"
                className="mt-1.5"
                label="Challenges completed"
              />
            </div>

            {stats.challenges.byScope.length > 0 ? (
              <ul className="space-y-1.5 border-t border-hairline pt-3">
                {stats.challenges.byScope.map((scope) => (
                  <li key={scope.scope} className="flex items-baseline justify-between gap-3 text-[0.6875rem]">
                    <span className="text-ink-dim">{scope.scope.toLowerCase()}</span>
                    <span className="timing text-ink-faint">
                      {formatNumber(scope.completed)} / {formatNumber(scope.offered)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="border-t border-hairline pt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
              {stats.challenges.note}
            </p>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart chrome
// ---------------------------------------------------------------------------

interface TooltipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  payload?: { full?: string };
}

function ChartTooltip({
  active, payload, label, unit = '',
}: { active?: boolean; payload?: TooltipPayload[]; label?: string | number; unit?: string }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border border-hairline-strong bg-panel-2 px-2.5 py-2 shadow-lg">
      <div className="label mb-1">{payload[0]?.payload?.full ?? String(label ?? '')}</div>
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-baseline gap-3 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: entry.color }} />
            <span className="text-ink-dim">{entry.name}</span>
            <span className="timing ml-auto text-ink">
              {typeof entry.value === 'number' ? formatNumber(entry.value, entry.value % 1 === 0 ? 0 : 1) : entry.value}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
