'use client';

/**
 * Career Statistics.
 *
 * Two distinctions are load-bearing here and are labelled everywhere they
 * appear, because conflating them would quietly make every figure a lie:
 *
 *   * VIEWING TIME is time in front of the screen, counted the way XP counts
 *     it: re-watches included, and very slow playback counted at 0.75×.
 *   * UNIQUE COVERAGE is race timeline seen at least once. Re-watching does
 *     not increase it.
 *
 * Every percentage is scoped to something the user defined — this filter, a
 * season, a championship, a quarter. There is deliberately no figure anywhere
 * on this page measuring a career against every endurance race ever run.
 *
 * The four core tabs arrive with every load, so moving between them is
 * instant: the address follows with `history.replaceState`, which Next folds
 * into `useSearchParams` without asking the server for anything. Records and
 * Compare are worked out only when asked for, so opening one is a real
 * navigation, and so is a change of filter; while one runs, the tab shows its
 * skeleton rather than figures that no longer match the controls. A tab
 * picked while one runs travels with it, so the page lands on that tab.
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type {
  GroupStat, LongestSessionView, RecordsView, StatisticsView as Stats, StatsFilterOptions, YearComparisonView,
} from '@/lib/engines/stats-engine';
import { CAREER_STATS_SHAPE } from '@/lib/config';
import { formatDuration } from '@/lib/domain/time';
import { AXIS_PROPS, CHART_COLORS } from '@/components/charts/chart-theme';
import { ChartTooltip } from '@/components/charts/chart-tooltip';
import { CumulativeLine } from '@/components/charts/cumulative-line';
import { PeriodBars } from '@/components/charts/monthly-bars';
import { ShareBars } from '@/components/charts/share-bars';
import { WeekdayBars } from '@/components/charts/weekday-bars';
import { CompareTab } from '@/components/stats/compare-tab';
import { RecordsTab } from '@/components/stats/records-tab';
import { Panel, PanelBody, PanelHeader, Stat, TimingBar, EmptyState, Skeleton } from '@/components/ui/primitives';
import { Button, Segmented, Select } from '@/components/ui/controls';
import { cn, formatDate, formatHours, formatNumber } from '@/lib/utils';
import { seasonPassClosedHeadline, seasonPassClosedShortNote } from '@/lib/copy/tone';

/**
 * The season pass while it is closed (0.3.1), already formatted on the server:
 * the quarter that opens and the day it opens.
 */
export interface StatsSeasonClosure {
  label: string;
  opensOn: string;
}

export type StatsTab = 'overview' | 'cadence' | 'breakdown' | 'career' | 'records' | 'compare';

/** Always computed, so switching between them never waits for the server. */
const CORE_TABS: ReadonlySet<StatsTab> = new Set<StatsTab>(['overview', 'cadence', 'breakdown', 'career']);

const TABS: { value: StatsTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'cadence', label: 'Cadence' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'career', label: 'Career' },
  { value: 'records', label: 'Records' },
  { value: 'compare', label: 'Compare' },
];

/** Address parameters that choose what the page shows rather than which races it counts. */
const VIEW_PARAMS: ReadonlySet<string> = new Set(['tab', 'a', 'b', 'same']);

/** Changes to the address: a value sets a parameter, null or '' removes it. */
export type ParamChanges = Readonly<Record<string, string | null>>;

const TOP = CAREER_STATS_SHAPE.topListSize;

export function StatisticsView({
  stats, options, initialTab, records, comparison, seasonClosure = null,
}: {
  stats: Stats;
  options: StatsFilterOptions;
  initialTab: StatsTab;
  /** Only when the page was asked for the Records tab. */
  records: RecordsView | null;
  /** Only when the page was asked for the Compare tab. */
  comparison: YearComparisonView | null;
  seasonClosure?: StatsSeasonClosure | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = React.useState<StatsTab>(initialTab);
  const [served, setServed] = React.useState(stats);
  const [pending, startTransition] = React.useTransition();
  // The query of the navigation under way, while one is. The address still
  // shows the one it is replacing, so a change made meanwhile builds on this
  // instead, and nothing asked for in between is lost when it lands.
  const requested = React.useRef<string | null>(null);
  // The navigation under way changes which races count, so even the core
  // tabs' figures are out of date until it lands.
  const [refiltering, setRefiltering] = React.useState(false);

  // A new render from the server — a filter, Records or Compare opened, or a
  // link back to this page — shows the tab its address asks for. Between
  // renders the tab is the client's own, kept in the address by hand.
  if (served !== stats) {
    setServed(stats);
    setTab(initialTab);
    setRefiltering(false);
  }

  React.useEffect(() => {
    if (!pending) requested.current = null;
  }, [pending]);

  function queryWith(changes: ParamChanges): string {
    const next = new URLSearchParams(requested.current ?? params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    return next.toString();
  }

  function hrefOf(query: string): string {
    return query ? `${pathname}?${query}` : pathname;
  }

  /** A change the server has to work out: a filter, or a tab it has not computed. */
  function navigate(changes: ParamChanges) {
    const query = queryWith(changes);
    requested.current = query;
    if (Object.keys(changes).some((key) => !VIEW_PARAMS.has(key))) setRefiltering(true);
    startTransition(() => {
      router.replace(hrefOf(query), { scroll: false });
    });
  }

  function selectTab(next: StatsTab) {
    if (next === tab) return;
    setTab(next);
    const changes = { tab: next === 'overview' ? null : next };
    const ready = CORE_TABS.has(next)
      || (next === 'records' && records !== null)
      || (next === 'compare' && comparison !== null);
    // A navigation under way puts its own address, and its tab, in place
    // when it lands, so while one runs the tab picked goes with it instead.
    if (ready && !pending) window.history.replaceState(null, '', hrefOf(queryWith(changes)));
    else navigate(changes);
  }

  // A core tab's figures are already here unless the races are changing;
  // Records and Compare wait for the server whenever it is working.
  const waiting = (pending && (refiltering || !CORE_TABS.has(tab)))
    || (tab === 'records' && records === null)
    || (tab === 'compare' && comparison === null);

  return (
    <div className="space-y-4">
      <FilterBar options={options} scopeLabel={stats.scopeLabel} params={params} onChange={navigate} />

      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented value={tab} onChange={selectTab} options={TABS} />
      </div>

      <div aria-busy={waiting}>
        {waiting ? <TabSkeleton /> : null}
        {!waiting && tab === 'overview' ? <Overview stats={stats} /> : null}
        {!waiting && tab === 'cadence' ? <Cadence stats={stats} /> : null}
        {!waiting && tab === 'breakdown' ? <Breakdown stats={stats} /> : null}
        {!waiting && tab === 'career' ? <Career stats={stats} seasonClosure={seasonClosure} /> : null}
        {!waiting && tab === 'records' && records !== null
          ? <RecordsTab view={records} onCareerRecords={() => navigate({ year: null })} />
          : null}
        {!waiting && tab === 'compare' && comparison !== null
          ? <CompareTab view={comparison} onChange={navigate} />
          : null}
      </div>

      <p className="px-1 pb-2 text-[0.6875rem] leading-relaxed text-ink-faint">
        {stats.completion.note}
      </p>
    </div>
  );
}

/** Shown in place of a tab while the server works it out. */
function TabSkeleton() {
  return (
    <div className="space-y-4" aria-label="Working it out">
      <Panel>
        <PanelBody>
          <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelBody>
          <Skeleton className="h-56 w-full" />
        </PanelBody>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function hours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;

function numberWord(value: number): string {
  return NUMBER_WORDS[value] ?? formatNumber(value);
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** "a, b and c". */
function listOf(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** The first `TOP` rows, and a button for the rest. */
function useTopRows<T>(rows: readonly T[]): { shown: readonly T[]; more: React.ReactNode } {
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, TOP);
  const more = !all && rows.length > TOP ? (
    <div className="border-t border-hairline px-4 py-2">
      <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
        Show all {formatNumber(rows.length)}
      </Button>
    </div>
  ) : null;
  return { shown, more };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterBar({
  options, scopeLabel, params, onChange,
}: {
  options: StatsFilterOptions;
  scopeLabel: string;
  params: Pick<URLSearchParams, 'get' | 'keys'>;
  onChange: (changes: ParamChanges) => void;
}) {
  const value = (key: string) => params.get(key) ?? '';
  const filterKeys = [...params.keys()].filter((key) => !VIEW_PARAMS.has(key));
  const hasFilter = filterKeys.length > 0;

  return (
    <Panel>
      <PanelHeader
        title={`Scope · ${scopeLabel}`}
        action={
          hasFilter ? (
            <Button variant="ghost" size="sm" onClick={() => onChange(Object.fromEntries(filterKeys.map((key) => [key, null])))}>
              Clear
            </Button>
          ) : null
        }
      />
      <PanelBody className="flex flex-wrap gap-2.5">
        <Select className="w-auto" value={value('year')} onChange={(e) => onChange({ year: e.target.value })} aria-label="Year">
          <option value="">All years</option>
          {options.years.map((y) => (
            <option key={y.year} value={y.year}>{y.year} ({formatHours(y.realHours)})</option>
          ))}
        </Select>

        <Select
          className="w-auto"
          value={value('championship')}
          onChange={(e) => onChange({ championship: e.target.value, race: null })}
          aria-label="Championship"
        >
          <option value="">All championships</option>
          {options.championships.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>

        <Select className="w-auto" value={value('season')} onChange={(e) => onChange({ season: e.target.value })} aria-label="Season">
          <option value="">All seasons</option>
          {options.seasons.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </Select>

        {options.events.length > 0 || value('event') !== '' ? (
          <Select
            className="w-auto max-w-[18rem]"
            value={value('event')}
            onChange={(e) => onChange({ event: e.target.value, race: null })}
            aria-label="Event"
          >
            <option value="">All events</option>
            {options.events.map((event) => (
              <option key={event.key} value={event.key}>{event.name} ({formatHours(event.hours)})</option>
            ))}
          </Select>
        ) : null}

        {options.races.length > 0 ? (
          <Select
            className="w-auto max-w-[18rem]"
            value={value('race')}
            onChange={(e) => onChange({ race: e.target.value })}
            aria-label="Race"
          >
            <option value="">All races</option>
            {options.races.map((race) => (
              <option key={race.id} value={race.id}>{race.name} ({formatHours(race.hours)})</option>
            ))}
          </Select>
        ) : null}

        <Select className="w-auto" value={value('circuit')} onChange={(e) => onChange({ circuit: e.target.value })} aria-label="Circuit">
          <option value="">All circuits</option>
          {options.circuits.map((c) => (
            <option key={c.circuitSlug} value={c.circuitSlug}>{c.name}</option>
          ))}
        </Select>

        <Select className="w-auto" value={value('length')} onChange={(e) => onChange({ length: e.target.value })} aria-label="Race length">
          <option value="">Any length</option>
          {options.lengths.map((band) => (
            <option key={band.key} value={band.key}>{band.label}</option>
          ))}
        </Select>

        <Select className="w-auto" value={value('status')} onChange={(e) => onChange({ status: e.target.value })} aria-label="Completion state">
          <option value="">Any state</option>
          {options.statuses.map((s) => (
            <option key={s.status} value={s.status}>{s.label}</option>
          ))}
        </Select>

        <Button
          variant={value('complete') === '1' ? 'primary' : 'subtle'}
          size="sm"
          onClick={() => onChange({ complete: value('complete') === '1' ? null : '1' })}
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
  const { races } = stats;
  const rate = stats.storyCompleteRate;
  const year = stats.filter.year;
  const meaningfulMinutes = CAREER_STATS_SHAPE.meaningfulSessionMinutes;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Time" />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
            <Stat
              className="col-span-2"
              label="Real viewing time"
              value={formatHours(stats.viewing.realHours)}
              sub="re-watches included; very slow playback counts at 0.75×"
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
              label="Re-watch time"
              value={formatHours(hours(stats.rewatchSeconds))}
              sub="story already seen, watched again"
              size="lg"
              tone="muted"
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
              <Stat label="In scope" value={formatNumber(races.racesInScope)} size="sm" tone="muted" />
              <Stat label="Started" value={formatNumber(races.racesStarted)} size="sm" tone="muted" />
              <Stat label="Experienced" value={formatNumber(stats.racesExperienced)} sub="at least a tenth watched" size="sm" />
              <Stat label="Races completed (Story Complete)" value={formatNumber(races.racesStoryComplete)} size="sm" tone="accent" />
              <Stat
                label="Story Complete rate"
                value={rate === null ? '—' : `${rate.toFixed(0)}%`}
                sub={rate === null ? `Needs ${numberWord(CAREER_STATS_SHAPE.rateMinimumRaces)} races` : 'of the races started'}
                size="sm"
                tone="muted"
              />
              <Stat
                label="Average race completion"
                value={stats.averageRaceCompletionPercent === null ? '—' : `${stats.averageRaceCompletionPercent.toFixed(0)}%`}
                sub="of each race watched"
                size="sm"
                tone="muted"
              />
              <Stat label="Average length" value={formatDuration(races.averageRuntimeSec)} size="sm" tone="muted" />
              <Stat label="Longest" value={formatDuration(races.longestRuntimeSec)} size="sm" tone="muted" />
            </div>
            <div>
              <TimingBar value={races.storyCompletePercent} height="h-1.5" label="Story Complete" />
              <p className="mt-1.5 text-[0.6875rem] text-ink-faint">{races.libraryNote}</p>
            </div>
            {rate !== null ? (
              <p className="border-t border-hairline pt-3 text-[0.6875rem] text-ink-faint">
                Of the races you started{year !== undefined ? ` in ${year}` : ''}, {rate.toFixed(0)}% are complete stories.
              </p>
            ) : null}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Sessions" />
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Stat label="Stints" value={formatNumber(stats.sessions.sessions)} size="sm" />
              <Stat label="Average length" value={formatDuration(stats.sessions.averageRealSeconds)} size="sm" tone="muted" />
              <Stat label="Longest" value={formatDuration(stats.sessions.longestRealSeconds)} size="sm" tone="muted" />
              <Stat
                label="Shortest meaningful"
                value={stats.shortestMeaningfulSession === null ? '—' : formatDuration(stats.shortestMeaningfulSession.realSeconds)}
                sub={`${meaningfulMinutes} minutes or more`}
                size="sm"
                tone="muted"
              />
              <Stat label="Average speed" value={`${stats.sessions.averagePlaybackSpeed.toFixed(2)}×`} size="sm" tone="muted" />
              <Stat label="Per active day" value={stats.sessions.averageSessionsPerActiveDay.toFixed(1)} size="sm" tone="muted" />
            </div>
            {stats.sessions.longestSession || stats.shortestMeaningfulSession ? (
              <ul className="space-y-1 border-t border-hairline pt-3 text-[0.6875rem] text-ink-faint">
                <SessionLine label="Longest stint" session={stats.sessions.longestSession} />
                <SessionLine label="Shortest meaningful stint" session={stats.shortestMeaningfulSession} />
              </ul>
            ) : null}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Favourites" />
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Championships followed" value={formatNumber(stats.championshipsFollowed)} size="sm" tone="muted" />
            <Stat label="Events followed" value={formatNumber(stats.eventsFollowed)} size="sm" tone="muted" />
            <Stat
              label="Longest race experienced"
              value={stats.longestRace === null ? '—' : formatDuration(stats.longestRace.runtimeSec)}
              sub={stats.longestRace?.name}
              size="sm"
              tone="muted"
            />
          </div>
          <div className="grid gap-4 border-t border-hairline pt-4 sm:grid-cols-2 lg:grid-cols-3">
            <Favourite label="Championship by hours" entry={stats.favourites.championshipByHours} />
            <Favourite label="Championship by completions" entry={stats.favourites.championshipByCompletions} />
            <Favourite label="Circuit" entry={stats.favourites.circuit} />
            <Favourite label="Most-watched event" entry={stats.favourites.event} />
            <Favourite label="Most-watched race" entry={stats.favourites.race} />
          </div>
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

function SessionLine({ label, session }: { label: string; session: LongestSessionView | null }) {
  if (session === null) return null;
  return (
    <li>
      {label}: {formatDuration(session.realSeconds)} on{' '}
      <Link href={`/races/${session.raceId}`} className="text-ink-dim underline-offset-2 hover:text-ink-muted hover:underline">
        {session.raceName}
      </Link>
      , {formatDate(session.watchedAt, 'long')}
    </li>
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
    coverage: m.newCoverageHours,
    seconds: m.realSeconds,
  }));
  const monthSentence = monthly.length === 1
    ? `One month so far: ${formatDuration(monthly[0]?.seconds ?? 0)}.`
    : `${capitalise(numberWord(monthly.length))} months so far: ${listOf(monthly.map((m) => `${formatDuration(m.seconds)} in ${m.full}`))}.`;

  const weekdays = stats.byWeekday.map((day) => ({
    label: day.short,
    full: day.label,
    hours: day.realHours,
    note: plural(day.sessions, 'session', 'sessions'),
  }));
  const watchedDays = stats.byWeekday.filter((day) => day.realSeconds > 0);
  const weekdaySentence = watchedDays.length === 0
    ? 'Nothing recorded yet.'
    : watchedDays.length === 1
      ? `All of it on ${watchedDays[0]?.label}s so far: ${formatDuration(watchedDays[0]?.realSeconds ?? 0)}.`
      : `${listOf(watchedDays.map((day) => `${formatDuration(day.realSeconds)} on ${day.label}s`))} so far.`;

  const xpByYear = new Map(stats.xpAndLevelsByYear.map((row) => [row.year, row]));

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
            <PeriodBars
              data={monthly}
              unit="h"
              sentence={monthSentence}
              series={[
                { key: 'hours', name: 'Hours', color: CHART_COLORS.primary },
                { key: 'coverage', name: 'New coverage', color: CHART_COLORS.secondary },
              ]}
            />
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Which evenings are race evenings" />
        <PanelBody>
          <WeekdayBars data={weekdays} sentence={weekdaySentence} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Year by year" />
        {stats.years.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left">
                    <th className="label px-4 py-2 font-semibold">Year</th>
                    <th className="label px-4 py-2 text-right font-semibold">Hours</th>
                    <th className="label px-4 py-2 text-right font-semibold">Stints</th>
                    <th className="label px-4 py-2 text-right font-semibold">Active days</th>
                    <th className="label px-4 py-2 text-right font-semibold">Stories</th>
                    <th className="label px-4 py-2 text-right font-semibold">XP earned</th>
                    <th className="label px-4 py-2 text-right font-semibold">Levels gained</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {stats.years.map((year) => {
                    const ledger = xpByYear.get(year.year);
                    return (
                      <tr key={year.year}>
                        <td className="timing px-4 py-2 text-xs text-ink">{year.year}</td>
                        <td className="timing px-4 py-2 text-right text-xs text-ink-muted">{formatHours(year.realHours)}</td>
                        <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{year.sessions}</td>
                        <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{year.activeDays}</td>
                        <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{year.racesStoryComplete}</td>
                        <td className="timing px-4 py-2 text-right text-xs text-ink-dim">
                          {ledger ? formatNumber(ledger.xpEarned) : '—'}
                        </td>
                        <td className="timing px-4 py-2 text-right text-xs text-ink-dim">
                          {ledger ? formatNumber(ledger.levelsGained) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-hairline px-4 py-2 text-[0.6875rem] text-ink-faint">
              XP and levels are dated by when the XP was awarded.{stats.careerWideNote ? ` ${stats.careerWideNote}` : ''}
            </p>
          </>
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
  const lengths = stats.byDurationClass.map((band) => ({
    label: band.name,
    full: band.name,
    value: band.realHours,
    note: `${plural(band.storyCompletes, 'Story Complete', 'Story Completes')} · ${plural(band.racesExperienced, 'race', 'races')} experienced`,
  }));
  const lengthSentence = stats.byDurationClass.length === 0
    ? 'Nothing recorded yet.'
    : `${capitalise(stats.byDurationClass.map((band) =>
      `races of ${band.name.toLowerCase()}: ${formatDuration(band.realSeconds)}, `
      + `${plural(band.storyCompletes, 'Story Complete', 'Story Completes')}`).join('; '))}.`;

  return (
    <div className="space-y-4">
      <ChampionshipTable rows={stats.championships} />
      <EventTable rows={stats.byEvent} />
      <CircuitTable rows={stats.circuits} />

      <Panel>
        <PanelHeader title="Race length" />
        <PanelBody>
          <ShareBars data={lengths} name="Hours" unit="h" sentence={lengthSentence} />
        </PanelBody>
      </Panel>
    </div>
  );
}

function ChampionshipTable({ rows }: { rows: Stats['championships'] }) {
  const { shown, more } = useTopRows(rows);
  return (
    <Panel>
      <PanelHeader title="Championships" />
      {rows.length === 0 ? (
        <EmptyState title="Nothing in scope" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">Championship</th>
                  <th className="label px-4 py-2 text-right font-semibold">Hours</th>
                  <th className="label px-4 py-2 text-right font-semibold">Coverage</th>
                  <th className="label px-4 py-2 text-right font-semibold">Complete</th>
                  <th className="label px-4 py-2 text-right font-semibold">Speed</th>
                  <th className="label px-4 py-2 text-right font-semibold">Mastery</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((row) => (
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
          {more}
        </>
      )}
    </Panel>
  );
}

function EventTable({ rows }: { rows: GroupStat[] }) {
  const { shown, more } = useTopRows(rows);
  return (
    <Panel>
      <PanelHeader
        title="Events"
        action={<span className="timing text-[0.6875rem] text-ink-faint">{rows.length}</span>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No recurring event in scope" body="Races joined to an event appear here, edition after edition." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">Event</th>
                  <th className="label px-4 py-2 text-right font-semibold">Hours</th>
                  <th className="label px-4 py-2 text-right font-semibold">Share</th>
                  <th className="label px-4 py-2 text-right font-semibold">Experienced</th>
                  <th className="label px-4 py-2 text-right font-semibold">Story Complete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((row) => (
                  <tr key={row.id ?? row.name}>
                    <td className="px-4 py-2 text-xs">
                      {row.href ? (
                        <Link href={row.href} className="text-ink underline-offset-2 hover:underline">{row.name}</Link>
                      ) : (
                        <span className="text-ink">{row.name}</span>
                      )}
                    </td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-muted">{formatHours(row.realHours)}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{(row.share * 100).toFixed(0)}%</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{row.racesExperienced}</td>
                    <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{row.storyCompletes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more}
        </>
      )}
    </Panel>
  );
}

function CircuitTable({ rows }: { rows: Stats['circuits'] }) {
  const { shown, more } = useTopRows(rows);
  return (
    <Panel>
      <PanelHeader
        title="Circuits"
        action={<span className="timing text-[0.6875rem] text-ink-faint">{rows.length}</span>}
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing in scope" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">Circuit</th>
                  <th className="label px-4 py-2 font-semibold">Country</th>
                  <th className="label px-4 py-2 text-right font-semibold">Hours</th>
                  <th className="label px-4 py-2 text-right font-semibold">Races</th>
                  <th className="label px-4 py-2 text-right font-semibold">Last watched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((row) => (
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
          {more}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Career
// ---------------------------------------------------------------------------

function Career({
  stats, seasonClosure,
}: { stats: Stats; seasonClosure: StatsSeasonClosure | null }) {
  const xp = stats.xpHistory.slice(-24).map((point) => ({
    label: point.label.replace(/ \d{4}$/, ''),
    full: point.label,
    career: point.careerXp,
  }));

  const completions = stats.completionsOverTime.map((point) => ({
    label: point.label.replace(/ \d{4}$/, ''),
    full: point.label,
    cumulative: point.cumulative,
  }));
  const totalCompleted = stats.completionsOverTime[stats.completionsOverTime.length - 1]?.cumulative ?? 0;
  const completedIn = stats.completionsOverTime.filter((point) => point.storyCompletes > 0).map((point) => point.label);
  const completionSentence = totalCompleted === 0
    ? 'Races completed appear here from the first Story Complete.'
    : `${capitalise(plural(totalCompleted, 'race', 'races'))} completed (Story Complete) so far, in ${listOf(completedIn)}.`;

  const byYear = stats.storyCompletesByYear.map((row) => ({
    label: `${row.year}`,
    full: `${row.year}`,
    stories: row.storyCompletes,
  }));
  const yearTotal = stats.storyCompletesByYear.reduce((sum, row) => sum + row.storyCompletes, 0);
  const yearSentence = yearTotal === 0
    ? 'No Story Complete in this scope yet.'
    : `${listOf(stats.storyCompletesByYear
      .filter((row) => row.storyCompletes > 0)
      .map((row) => `${plural(row.storyCompletes, 'Story Complete', 'Story Completes')} in ${row.year}`))}.`;
  const mostByChampionship = stats.storyCompletesByChampionship[0]?.storyCompletes ?? 0;
  const byChampionship = useTopRows(stats.storyCompletesByChampionship);

  const landmarks = stats.landmarksOverTime.map((point) => ({
    label: point.label.replace(/ \d{4}$/, ''),
    full: point.label,
    achievements: point.achievements,
    masteryNodes: point.masteryNodes,
    milestones: point.milestones,
  }));
  const lastLandmarks = stats.landmarksOverTime[stats.landmarksOverTime.length - 1];
  const landmarkSentence = lastLandmarks === undefined
    ? 'Achievements, mastery steps and milestones appear here as you reach them.'
    : `So far: ${plural(lastLandmarks.achievements, 'achievement', 'achievements')}, `
      + `${plural(lastLandmarks.masteryNodes, 'mastery step', 'mastery steps')} and `
      + `${plural(lastLandmarks.milestones, 'milestone', 'milestones')}.`;

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
                      <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                  <XAxis dataKey="label" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip content={<ChartTooltip unit=" XP" />} cursor={{ stroke: CHART_COLORS.cursorStroke }} />
                  <Area
                    type="monotone" dataKey="career" name="Career XP"
                    stroke={CHART_COLORS.primary} strokeWidth={1.5} fill="url(#xpFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {stats.careerWideNote ? (
            <p className="mt-3 text-[0.6875rem] text-ink-faint">{stats.careerWideNote}</p>
          ) : null}
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

      <Panel>
        <PanelHeader title="Race completions over time" />
        <PanelBody>
          <CumulativeLine
            data={completions}
            points={totalCompleted > 0 ? completions.length : 0}
            sentence={completionSentence}
            step
            series={[{ key: 'cumulative', name: 'Races completed', color: CHART_COLORS.primary }]}
          />
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Story Completes by year" />
          <PanelBody>
            <PeriodBars
              data={byYear}
              points={yearTotal > 0 ? byYear.length : 0}
              sentence={yearSentence}
              allowDecimals={false}
              series={[{ key: 'stories', name: 'Story Completes', color: CHART_COLORS.primary }]}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Story Completes by championship" />
          {stats.storyCompletesByChampionship.length === 0 ? (
            <EmptyState title="No Story Complete in this scope yet" />
          ) : (
            <>
              <PanelBody className="space-y-2.5">
                {byChampionship.shown.map((row) => (
                  <div key={row.id ?? row.name}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate text-ink-muted">{row.name}</span>
                      <span className="timing text-ink-dim">{formatNumber(row.storyCompletes)}</span>
                    </div>
                    <TimingBar
                      value={row.storyCompletes}
                      max={Math.max(1, mostByChampionship)}
                      height="h-1"
                      className="mt-1"
                      color={row.accentColor ?? undefined}
                      label={row.name}
                    />
                  </div>
                ))}
              </PanelBody>
              {byChampionship.more}
            </>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Landmarks over time" />
        <PanelBody>
          <CumulativeLine
            data={landmarks}
            sentence={landmarkSentence}
            series={[
              { key: 'achievements', name: 'Achievements', color: CHART_COLORS.primary },
              { key: 'masteryNodes', name: 'Mastery steps', color: CHART_COLORS.secondary },
              { key: 'milestones', name: 'Milestones', color: CHART_COLORS.tertiary },
            ]}
          />
          {stats.careerWideNote ? (
            <p className="mt-3 text-[0.6875rem] text-ink-faint">{stats.careerWideNote}</p>
          ) : null}
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Season passes" />
          <PanelBody className="space-y-3">
            {seasonClosure ? (
              <p className="border-b border-hairline pb-3 text-xs leading-relaxed text-ink-dim">
                <span className="text-ink">{seasonPassClosedHeadline(seasonClosure.opensOn)}.</span>{' '}
                {seasonPassClosedShortNote(seasonClosure.label)}
              </p>
            ) : null}
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
