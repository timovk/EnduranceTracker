'use client';

/**
 * One year of the Career Chronicle: the chapter, in the brief's order —
 * summary, viewing, championships, events, complete stories, mastery,
 * achievements and milestones, records, notable races, months and the
 * career's progress — with the year before for comparison and a note on how
 * the chapter was counted.
 *
 * A frozen chapter is drawn from its snapshot, exactly as it was written;
 * only what depends on today is worked out now — which records have since
 * been beaten, the full Expedition Summary cards, and which races are still
 * in the library to link to. A section with nothing in it is one calm line.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Award, BarChart3, BookOpen, CalendarDays, ChevronLeft, ChevronRight, Flag, Layers, Mountain, Repeat, Sparkles,
  Star, Trophy, TrendingUp,
} from 'lucide-react';
import type { ChronicleChapterView } from '@/lib/engines/chronicle-engine';
import type { ChronicleChapterV1 } from '@/lib/domain/chronicle';
import { formatDuration } from '@/lib/domain/time';
import { chapterBeginning, chapterHeadline, differencePhrase, milestoneLabel, precisionLabel } from '@/lib/copy/tone';
import { PeriodBars } from '@/components/charts/monthly-bars';
import { WeekdayBars, type WeekdayPoint } from '@/components/charts/weekday-bars';
import { CHART_COLORS } from '@/components/charts/chart-theme';
import { ExpeditionSummaryCard } from '@/components/expeditions/expedition-summary-card';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { Panel, PanelBody, PanelHeader, RarityBadge, Stat } from '@/components/ui/primitives';
import { rebuildChronicleYearAction } from '@/lib/server/career-actions';
import { CHRONICLE_SHAPE } from '@/lib/config';
import { formatDate, formatNumber } from '@/lib/utils';
import { ChapterStateBadge } from './chronicle-index';

/** Rows a breakdown shows before "Show all". */
const TOP = 10;

const WEEKDAYS = [
  ['Sun', 'Sunday'], ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'],
  ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'],
] as const;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Credited time: "181h 42m", or "0m" before the first minute. */
function watched(seconds: number): string {
  return seconds < 60 ? '0m' : formatDuration(seconds);
}

/** A percentage floored to one decimal, so it never reads 100% while something is still to watch. */
function percentText(value: number): string {
  if (value >= 100) return '100%';
  const tenths = Math.floor(Math.max(0, value) * 10) / 10;
  return `${tenths.toLocaleString('en-GB')}%`;
}

function dateOf(iso: string): string {
  return formatDate(iso, 'long');
}

function dateAndTime(at: Date | string): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  return `${formatDate(date, 'long')}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/** "Story complete", "Mastery node": the ledger's source, in words. */
function sourceLabel(source: string): string {
  return source
    .toLowerCase()
    .split('_')
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function hours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** The first rows of a list, and the button that shows the rest. */
function useTopRows<T>(rows: readonly T[], size: number = TOP): { shown: readonly T[]; more: React.ReactNode } {
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, size);
  const more = !all && rows.length > size ? (
    <div className="border-t border-hairline px-4 py-2">
      <Button variant="ghost" size="sm" onClick={() => setAll(true)}>Show all {formatNumber(rows.length)}</Button>
    </div>
  ) : null;
  return { shown, more };
}

/** The sentence a section says when the year holds nothing for it. */
function Calm({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-sm text-ink-dim">{children}</p>;
}

export function ChapterView({ view }: { view: ChronicleChapterView }) {
  const { chapter } = view;
  const { summary } = chapter;
  const empty = summary.sessions === 0 && summary.creditedSeconds < 1;
  const raceLinks = new Set(view.raceIdsInLibrary);
  const raceHref = (raceId: string | null) => (raceId !== null && raceLinks.has(raceId) ? `/races/${raceId}` : null);

  return (
    <div className="space-y-4">
      <ChapterHeader view={view} empty={empty} />

      {empty ? (
        <Panel>
          <Calm>
            {view.state === 'year-to-date'
              ? `Your ${chapter.year} chapter starts with your next stint.`
              : `Nothing was logged in ${chapter.year}.`}
          </Calm>
        </Panel>
      ) : (
        <>
          <CareerSummary chapter={chapter} careerYear={view.careerYear} />
          <ViewingStatistics chapter={chapter} raceHref={raceHref} />
          <ChampionshipBreakdown chapter={chapter} />
          <EventBreakdown chapter={chapter} eventHrefs={view.eventHrefs} />
          <StoryCompleteSection view={view} raceHref={raceHref} />
          <MasterySection chapter={chapter} />
          <LandmarksSection chapter={chapter} eventHrefs={view.eventHrefs} raceHref={raceHref} />
          <RecordsSection chapter={chapter} beaten={view.recordsBeaten} raceHref={raceHref} />
          <NotableRaces chapter={chapter} raceHref={raceHref} />
          <MonthlyActivity chapter={chapter} />
          <CareerProgression chapter={chapter} />
          <ComparedWithLastYear chapter={chapter} />
        </>
      )}

      <AboutChapter view={view} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ChapterHeader({ view, empty }: { view: ChronicleChapterView; empty: boolean }) {
  const { chapter, neighbours } = view;
  return (
    <header className="space-y-3">
      <nav aria-label="Chapters" className="flex items-center justify-between gap-3 text-xs">
        {neighbours.previous !== null ? (
          <Link href={`/chronicle/${neighbours.previous}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
            <ChevronLeft size={13} /> {neighbours.previous}
          </Link>
        ) : <span />}
        <Link href="/chronicle" className="text-ink-dim hover:text-ink-muted">Every chapter</Link>
        {neighbours.next !== null ? (
          <Link href={`/chronicle/${neighbours.next}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
            {neighbours.next} <ChevronRight size={13} />
          </Link>
        ) : <span />}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label mb-1.5 flex flex-wrap items-center gap-2">
            <span>Career Year {view.careerYear}</span>
            <ChapterStateBadge state={view.state} settlesOn={view.settlesOn} />
          </div>
          <h1 className="timing text-[2.25rem] leading-none text-ink">{chapter.year}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{chapterHeadline(chapter)}</p>
          {view.state === 'year-to-date' ? (
            <p className="mt-1 text-xs text-ink-dim">
              Year to date — still being written. As of {dateAndTime(chapter.generatedAt)}.
            </p>
          ) : null}
          {view.state === 'finalising' ? (
            <p className="mt-1 text-xs text-ink-dim">
              {view.settlesOn !== null
                ? 'The year is over. Its chapter is settled a few days into January, so a race watched across New Year counts in both years.'
                : 'The year is over. Its chapter is settled as soon as your history has been read through.'}
            </p>
          ) : null}
        </div>
        {!empty ? (
          <Link href={`/chronicle/${chapter.year}/wrapped`}>
            <Button variant="primary" size="sm">
              <Sparkles size={13} /> {view.state === 'year-to-date' ? 'Wrapped so far' : 'Endurance Wrapped'}
            </Button>
          </Link>
        ) : null}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// 1. Career summary
// ---------------------------------------------------------------------------

function CareerSummary({ chapter, careerYear }: { chapter: ChronicleChapterV1; careerYear: number }) {
  const { summary } = chapter;
  const beginning = careerYear === 1 ? chapterBeginning(chapter.beginnings) : [];
  return (
    <Panel>
      <PanelHeader title="Career summary" icon={<BookOpen size={13} />} />
      <PanelBody className="space-y-5">
        {beginning.length > 0 ? (
          <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-2.5">
            <div className="label mb-1 text-[var(--accent)]">How it began</div>
            {beginning.map((sentence) => <p key={sentence} className="text-sm text-ink">{sentence}</p>)}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
          <Stat label="Hours" value={watched(summary.creditedSeconds)} size="sm" />
          <Stat label="Races experienced" value={formatNumber(summary.racesExperienced)} size="sm" />
          <Stat label="Races started" value={formatNumber(summary.racesStarted)} size="sm" />
          <Stat label="Races completed" value={formatNumber(summary.storyCompletes)} sub="Story Complete" size="sm" />
          <Stat label="New race coverage" value={watched(summary.newCoverageSeconds)} size="sm" />
          <Stat label="XP earned" value={formatNumber(summary.xpEarned)} size="sm" />
          <Stat
            label="Levels"
            value={`${summary.levelStart} → ${summary.levelEnd}`}
            sub={summary.levelsGained > 0 ? `${summary.levelsGained} gained` : undefined}
            size="sm"
          />
          <Stat label="Championships · events" value={`${summary.championshipsWatched} · ${summary.eventsWatched}`} size="sm" tone="muted" />
        </div>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 2. Viewing statistics
// ---------------------------------------------------------------------------

function ViewingStatistics({ chapter, raceHref }: { chapter: ChronicleChapterV1; raceHref: (raceId: string | null) => string | null }) {
  const { summary, viewing } = chapter;
  const longest = viewing.longestSession;
  const longestHref = longest === null ? null : raceHref(longest.raceId);
  const weekdays: WeekdayPoint[] = Array.from({ length: 7 }, (_, index) => {
    const day = (chapter.weekStartsOn + index) % 7;
    const seconds = viewing.weekdaySeconds[day] ?? 0;
    return { label: WEEKDAYS[day]![0], full: WEEKDAYS[day]![1], hours: hours(seconds), note: watched(seconds) };
  });
  const busiest = weekdays.reduce<WeekdayPoint | null>((best, day) => (day.hours > (best?.hours ?? 0) ? day : best), null);

  return (
    <Panel>
      <PanelHeader title="Viewing" icon={<CalendarDays size={13} />} />
      <PanelBody className="space-y-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
          <Stat label="Sessions" value={formatNumber(summary.sessions)} size="sm" />
          <Stat label="Active days" value={formatNumber(summary.activeDays)} size="sm" />
          <Stat
            label="Average session"
            value={viewing.averageSessionSeconds === null ? '—' : watched(viewing.averageSessionSeconds)}
            size="sm"
          />
          <Stat
            label="Longest session"
            value={longest === null ? '—' : watched(longest.creditedSeconds)}
            sub={longest === null ? undefined : (
              <>
                {longestHref !== null ? <Link href={longestHref} className="hover:text-ink">{longest.raceName}</Link> : longest.raceName}
                {' · '}{dateOf(longest.at)}
              </>
            )}
            size="sm"
          />
          <Stat
            label="Most active day"
            value={viewing.mostActiveDay === null ? '—' : watched(viewing.mostActiveDay.seconds)}
            sub={viewing.mostActiveDay === null ? undefined : formatDate(`${viewing.mostActiveDay.dayKey}T12:00:00`, 'long')}
            size="sm"
          />
          <Stat
            label="Most active week"
            value={viewing.mostActiveWeek === null ? '—' : watched(viewing.mostActiveWeek.seconds)}
            sub={viewing.mostActiveWeek === null
              ? undefined
              : `${viewing.mostActiveWeek.label}${viewing.mostActiveWeek.clipped ? `, the days in ${chapter.year}` : ''}`}
            size="sm"
          />
          <Stat
            label="Most active month"
            value={viewing.mostActiveMonth === null ? '—' : watched(viewing.mostActiveMonth.seconds)}
            sub={viewing.mostActiveMonth?.label}
            size="sm"
          />
          <Stat label="Re-watch time" value={watched(summary.rewatchSeconds)} size="sm" tone="muted" />
          <Stat
            label="Completion"
            value={summary.completionPercent === null ? '—' : percentText(summary.completionPercent)}
            sub="of the races watched, by length"
            size="sm"
            tone="muted"
          />
        </div>
        <div>
          <h3 className="label mb-2">By day of the week</h3>
          <WeekdayBars
            data={weekdays}
            sentence={busiest === null
              ? 'No viewing on any day of the week yet.'
              : `Most of it on ${busiest.full}s: ${busiest.note}.`}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 3–4. Championships and events
// ---------------------------------------------------------------------------

interface BreakdownRow {
  key: string;
  name: string;
  href: string | null;
  creditedSeconds: number;
  share: number;
  racesExperienced: number;
  storyCompletes: number;
  editions?: number;
}

function BreakdownTable({ rows, nameHeading, withEditions }: { rows: BreakdownRow[]; nameHeading: string; withEditions?: boolean }) {
  const { shown, more } = useTopRows(rows);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left">
              <th className="label px-4 py-2 font-normal">{nameHeading}</th>
              <th className="label px-2 py-2 text-right font-normal">Hours</th>
              <th className="label px-2 py-2 text-right font-normal">Share</th>
              <th className="label px-2 py-2 text-right font-normal">Races</th>
              {withEditions ? <th className="label px-2 py-2 text-right font-normal">Editions</th> : null}
              <th className="label px-4 py-2 text-right font-normal">Complete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {shown.map((row) => (
              <tr key={row.key}>
                <td className="max-w-[16rem] truncate px-4 py-2 text-ink-muted">
                  {row.href !== null ? <Link href={row.href} className="hover:text-ink">{row.name}</Link> : row.name}
                </td>
                <td className="timing px-2 py-2 text-right text-ink">{watched(row.creditedSeconds)}</td>
                <td className="timing px-2 py-2 text-right text-ink-dim">{percentText(row.share * 100)}</td>
                <td className="timing px-2 py-2 text-right text-ink-dim">{formatNumber(row.racesExperienced)}</td>
                {withEditions ? <td className="timing px-2 py-2 text-right text-ink-dim">{formatNumber(row.editions ?? 0)}</td> : null}
                <td className="timing px-4 py-2 text-right text-ink-dim">{formatNumber(row.storyCompletes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more}
    </>
  );
}

function ChampionshipBreakdown({ chapter }: { chapter: ChronicleChapterV1 }) {
  const rows: BreakdownRow[] = chapter.championships.map((row) => ({
    key: row.id ?? 'none',
    name: row.name,
    href: row.id === null ? null : `/stats?championship=${encodeURIComponent(row.id)}&year=${chapter.year}`,
    creditedSeconds: row.creditedSeconds,
    share: row.share,
    racesExperienced: row.racesExperienced,
    storyCompletes: row.storyCompletes,
  }));
  return (
    <Panel>
      <PanelHeader title="Championships" icon={<Flag size={13} />} />
      {rows.length === 0 ? <Calm>No championship watched in {chapter.year}.</Calm> : <BreakdownTable rows={rows} nameHeading="Championship" />}
    </Panel>
  );
}

function EventBreakdown({ chapter, eventHrefs }: { chapter: ChronicleChapterV1; eventHrefs: Record<string, string> }) {
  const rows: BreakdownRow[] = chapter.events.map((row) => ({
    key: row.key ?? row.name,
    name: row.name,
    href: row.key === null ? null : eventHrefs[row.key] ?? null,
    creditedSeconds: row.creditedSeconds,
    share: row.share,
    racesExperienced: row.racesExperienced,
    storyCompletes: row.storyCompletes,
    editions: row.editionsExperienced,
  }));
  return (
    <Panel>
      <PanelHeader title="Recurring events" icon={<Repeat size={13} />} />
      {rows.length === 0
        ? <Calm>No recurring event watched in {chapter.year}.</Calm>
        : <BreakdownTable rows={rows} nameHeading="Event" withEditions />}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 5. Complete race stories
// ---------------------------------------------------------------------------

function StoryCompleteSection({ view, raceHref }: { view: ChronicleChapterView; raceHref: (raceId: string | null) => string | null }) {
  const { chapter } = view;
  const stories = chapter.storyComplete;
  const pageSize = CHRONICLE_SHAPE.storyListPageSize;
  const [page, setPage] = React.useState(0);
  const pages = Math.max(1, Math.ceil(stories.list.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = stories.list.slice(current * pageSize, (current + 1) * pageSize);
  const longest = stories.list.reduce<(typeof stories.list)[number] | null>(
    (best, entry) => (best === null || entry.runtimeSec > best.runtimeSec ? entry : best),
    null,
  );

  return (
    <Panel>
      <PanelHeader title={`Complete race stories · ${formatNumber(stories.count)}`} icon={<Trophy size={13} />} />
      {stories.count === 0 ? (
        <Calm>No race story was completed in {chapter.year}.</Calm>
      ) : (
        <PanelBody className="space-y-5">
          <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
            <Stat label="Longest completed" value={longest === null ? '—' : formatDuration(longest.runtimeSec)} sub={longest?.name} size="sm" />
            <Stat
              label="Stints per story"
              value={stories.averageStintsPerStory === null ? '—' : formatNumber(stories.averageStintsPerStory, 1)}
              sub="on average"
              size="sm"
            />
            <Stat
              label="Start to finish"
              value={stories.averageDaysToComplete === null ? '—' : `${formatNumber(stories.averageDaysToComplete, 1)} days`}
              sub="on average, both days counted"
              size="sm"
            />
            <Stat
              label="Complete stories"
              value={stories.rate === null ? '—' : percentText(stories.rate)}
              sub={stories.rate === null ? `once ${chapter.year} has five races started` : `of the races started in ${chapter.year}`}
              size="sm"
            />
          </div>
          {stories.rate !== null ? (
            <p className="text-xs text-ink-dim">
              Of the races you started in {chapter.year}, {percentText(stories.rate)} are complete stories.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="label mb-2">By race length</h3>
              <ul className="space-y-1 text-sm">
                {stories.byDurationClass.map((band) => (
                  <li key={band.key} className="flex justify-between gap-3">
                    <span className="text-ink-muted">{band.label}</span>
                    <span className="timing text-ink">{formatNumber(band.count)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="label mb-2">By championship</h3>
              <ul className="space-y-1 text-sm">
                {stories.byChampionship.map((row) => (
                  <li key={row.name} className="flex justify-between gap-3">
                    <span className="truncate text-ink-muted">{row.name}</span>
                    <span className="timing text-ink">{formatNumber(row.count)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section>
            <h3 className="label mb-2">Every complete story</h3>
            <ol className="divide-y divide-hairline rounded-md border border-hairline">
              {shown.map((entry) => {
                const href = raceHref(entry.raceId);
                return (
                  <li key={`${entry.raceId}-${entry.at}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ink-muted">
                      {href !== null ? <Link href={href} className="hover:text-ink">{entry.name}</Link> : entry.name}
                    </span>
                    <span className="text-xs text-ink-dim">
                      <span className="timing">{formatDuration(entry.runtimeSec)}</span> · {dateOf(entry.at)}
                    </span>
                  </li>
                );
              })}
            </ol>
            {pages > 1 ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-dim">
                <Button variant="ghost" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  <ChevronLeft size={12} /> Earlier
                </Button>
                <span>Page {current + 1} of {pages}</span>
                <Button variant="ghost" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Later <ChevronRight size={12} />
                </Button>
              </div>
            ) : null}
          </section>

          {chapter.expeditions.length > 0 ? (
            <section className="space-y-2">
              <h3 className="label flex items-center gap-1.5"><Mountain size={12} /> Expeditions completed</h3>
              {chapter.expeditions.map((expedition) => {
                const summary = view.expeditionSummaries.find((candidate) => candidate.id === expedition.summaryId);
                return (
                  <details key={expedition.summaryId} className="rounded-md border border-hairline">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm text-ink-muted">
                      {expedition.raceName}
                      <span className="text-xs text-ink-dim"> · completed on {dateOf(expedition.completedAt)}</span>
                    </summary>
                    <div className="p-2">
                      {summary !== undefined ? (
                        <ExpeditionSummaryCard
                          snapshot={summary.snapshot}
                          retrospective={summary.retrospective}
                          accent={summary.accent}
                          raceHref={raceHref(summary.raceId)}
                        />
                      ) : (
                        <p className="px-2 py-1 text-sm text-ink-dim">
                          {watched(expedition.creditedSeconds)} of viewing over {formatNumber(expedition.calendarDays)} calendar days.
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </section>
          ) : null}
        </PanelBody>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 6. Mastery
// ---------------------------------------------------------------------------

function MasterySection({ chapter }: { chapter: ChronicleChapterV1 }) {
  const trees = new Map<string, { name: string; steps: ChronicleChapterV1['mastery']['steps'] }>();
  for (const step of chapter.mastery.steps) {
    const tree = trees.get(step.treeKey) ?? { name: step.treeName, steps: [] };
    tree.steps.push(step);
    trees.set(step.treeKey, tree);
  }
  return (
    <Panel>
      <PanelHeader
        title="Mastery"
        icon={<Layers size={13} />}
        action={chapter.mastery.xp > 0 ? <span className="timing text-xs text-ink-dim">+{formatNumber(chapter.mastery.xp)} XP</span> : undefined}
      />
      {trees.size === 0 ? (
        <Calm>No mastery step reached in {chapter.year}.</Calm>
      ) : (
        <PanelBody className="grid gap-4 sm:grid-cols-2">
          {[...trees].map(([key, tree]) => (
            <section key={key}>
              <h3 className="label mb-1.5">{tree.name}</h3>
              <ul className="space-y-1 text-sm">
                {tree.steps.map((step) => (
                  <li key={step.nodeKey} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink-muted">{step.nodeName}</span>
                    <span className="text-xs text-ink-dim">
                      {dateOf(step.at)}{step.xp > 0 ? <span className="timing"> · +{formatNumber(step.xp)} XP</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </PanelBody>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 7. Achievements and milestones
// ---------------------------------------------------------------------------

function LandmarksSection({
  chapter, eventHrefs, raceHref,
}: {
  chapter: ChronicleChapterV1;
  eventHrefs: Record<string, string>;
  raceHref: (raceId: string | null) => string | null;
}) {
  const { achievements, milestones } = chapter;
  const nothing = achievements.length === 0 && milestones.career.length === 0
    && milestones.ladder.length === 0 && milestones.eventLegacy.length === 0;
  return (
    <Panel>
      <PanelHeader title="Achievements and milestones" icon={<Award size={13} />} />
      {nothing ? (
        <Calm>No achievement or milestone reached in {chapter.year}.</Calm>
      ) : (
        <PanelBody className="space-y-5">
          {achievements.length > 0 ? (
            <section>
              <h3 className="label mb-2">Achievements · {formatNumber(achievements.length)}</h3>
              <ul className="space-y-1.5 text-sm">
                {achievements.map((achievement) => (
                  <li key={achievement.key} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-ink-muted">
                      {achievement.name} <RarityBadge rarity={achievement.rarity} />
                    </span>
                    <span className="text-xs text-ink-dim">
                      {dateOf(achievement.at)}{achievement.xp > 0 ? <span className="timing"> · +{formatNumber(achievement.xp)} XP</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {milestones.career.length > 0 ? (
            <section>
              <h3 className="label mb-2">Career Milestones · {formatNumber(milestones.career.length)}</h3>
              <ul className="space-y-2 text-sm">
                {milestones.career.map((milestone) => {
                  const href = milestone.subjectKind === 'event'
                    ? (milestone.subjectId === null ? null : eventHrefs[milestone.subjectId] ?? null)
                    : raceHref(milestone.subjectId);
                  return (
                    <li key={milestone.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink">
                          {milestone.celebration !== 'none' ? <Star size={12} className="text-[var(--accent)]" /> : null}
                          {milestone.title}
                        </span>
                        {milestone.xp > 0 ? <span className="timing text-xs text-ink-dim">+{formatNumber(milestone.xp)} XP</span> : null}
                      </div>
                      <p className="text-xs text-ink-dim">
                        {precisionLabel(milestone.precision, new Date(milestone.at), null)}
                        {milestone.subjectName !== null ? (
                          <>
                            {' · '}
                            {href !== null ? <Link href={href} className="hover:text-ink-muted">{milestone.subjectName}</Link> : milestone.subjectName}
                          </>
                        ) : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-ink-faint">XP is counted in the year it was recorded.</p>
            </section>
          ) : null}

          {milestones.eventLegacy.length > 0 ? (
            <section>
              <h3 className="label mb-2">Event Legacy steps · {formatNumber(milestones.eventLegacy.length)}</h3>
              <ul className="space-y-1 text-sm">
                {milestones.eventLegacy.map((step) => {
                  const href = eventHrefs[step.eventKey] ?? null;
                  return (
                    <li key={`${step.eventKey}:${step.nodeKey}`} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-ink-muted">
                        {step.nodeName}
                        <span className="text-ink-dim"> · {href !== null ? <Link href={href} className="hover:text-ink-muted">{step.eventName}</Link> : step.eventName}</span>
                      </span>
                      <span className="text-xs text-ink-dim">{dateOf(step.at)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {milestones.ladder.length > 0 ? (
            <details className="rounded-md border border-hairline">
              <summary className="label cursor-pointer select-none px-3 py-2">
                Lifetime-ladder rungs · {formatNumber(milestones.ladder.length)}
              </summary>
              <ul className="space-y-1 border-t border-hairline px-3 py-2 text-sm">
                {milestones.ladder.map((rung) => (
                  <li key={`${rung.metric}:${rung.threshold}`} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-ink-muted">{milestoneLabel(rung.threshold, rung.label)}</span>
                    <span className="text-xs text-ink-dim">{dateOf(rung.at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </PanelBody>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 8. Records
// ---------------------------------------------------------------------------

function RecordsSection({
  chapter, beaten, raceHref,
}: {
  chapter: ChronicleChapterV1;
  beaten: (string | null)[];
  raceHref: (raceId: string | null) => string | null;
}) {
  return (
    <Panel>
      <PanelHeader title="Personal records set" icon={<TrendingUp size={13} />} />
      {chapter.records.length === 0 ? (
        <Calm>No personal record set in {chapter.year}.</Calm>
      ) : (
        <ul className="divide-y divide-hairline">
          {chapter.records.map((record, index) => {
            const href = raceHref(record.raceId);
            const since = beaten[index] ?? null;
            return (
              <li key={record.kind} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{record.label}</div>
                  <div className="text-xs text-ink-dim">
                    Set on {dateOf(record.at)}
                    {href !== null ? <> · <Link href={href} className="hover:text-ink-muted">the race</Link></> : null}
                    {since !== null ? <> · since beaten on {dateOf(since)}</> : null}
                  </div>
                </div>
                <span className="timing text-sm text-[var(--accent)]">{record.valueText}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 9. Notable races
// ---------------------------------------------------------------------------

function NotableRaces({ chapter, raceHref }: { chapter: ChronicleChapterV1; raceHref: (raceId: string | null) => string | null }) {
  return (
    <Panel>
      <PanelHeader title="Notable races" icon={<Star size={13} />} />
      {chapter.notableRaces.length === 0 ? (
        <Calm>No race stood out yet in {chapter.year}.</Calm>
      ) : (
        <ul className="grid gap-px bg-hairline sm:grid-cols-2">
          {chapter.notableRaces.map((race) => {
            const href = raceHref(race.raceId);
            return (
              <li key={race.raceId} className="bg-panel px-4 py-3">
                <div className="truncate text-sm font-medium text-ink">
                  {href !== null ? <Link href={href} className="hover:text-[var(--accent)]">{race.name}</Link> : race.name}
                </div>
                <p className="mt-0.5 text-xs text-ink-dim">{race.detail}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 10. Months
// ---------------------------------------------------------------------------

function MonthlyActivity({ chapter }: { chapter: ChronicleChapterV1 }) {
  const data = chapter.monthly.map((month) => ({
    label: month.label,
    full: `${MONTHS[month.month - 1]} ${chapter.year}`,
    note: month.storyCompletes > 0
      ? `${month.storyCompletes} ${month.storyCompletes === 1 ? 'complete story' : 'complete stories'}`
      : `${month.sessions} ${month.sessions === 1 ? 'session' : 'sessions'}`,
    hours: hours(month.creditedSeconds),
    coverage: hours(month.newCoverageSeconds),
  }));
  const active = chapter.monthly.filter((month) => month.creditedSeconds > 0);
  const sentence = active.length === 0
    ? `Nothing logged in ${chapter.year} yet.`
    : active.map((month) => `${MONTHS[month.month - 1]}: ${watched(month.creditedSeconds)}`).join('. ') + '.';

  return (
    <Panel>
      <PanelHeader title="Month by month" icon={<BarChart3 size={13} />} />
      <PanelBody className="space-y-3">
        <PeriodBars
          data={data}
          series={[
            { key: 'hours', name: 'Hours watched', color: CHART_COLORS.primary },
            { key: 'coverage', name: 'New race coverage', color: CHART_COLORS.secondary },
          ]}
          unit="h"
          points={active.length}
          sentence={sentence}
        />
        <div className="grid grid-cols-12 gap-1" aria-label="Complete race stories by month">
          {chapter.monthly.map((month) => (
            <div key={month.month} className="flex flex-col items-center gap-0.5" title={`${MONTHS[month.month - 1]}: ${month.storyCompletes} complete`}>
              <div className="flex min-h-2 flex-wrap justify-center gap-0.5">
                {Array.from({ length: Math.min(month.storyCompletes, 6) }, (_, index) => (
                  <span key={index} className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                ))}
              </div>
              <span className="text-[0.625rem] text-ink-faint">{month.label}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-dim">Dots are complete race stories, one for each (up to six a month).</p>
        <Link href={`/stats?year=${chapter.year}`} className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline">
          See {chapter.year} in Career Statistics <ChevronRight size={12} />
        </Link>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 11. Career progression
// ---------------------------------------------------------------------------

function CareerProgression({ chapter }: { chapter: ChronicleChapterV1 }) {
  const { summary, progression } = chapter;
  const data = chapter.monthly.map((month) => ({
    label: month.label,
    full: `${MONTHS[month.month - 1]} ${chapter.year}`,
    xp: month.xpEarned,
  }));
  const months = chapter.monthly.filter((month) => month.xpEarned > 0);
  const total = progression.xpBySource.reduce((sum, row) => sum + row.amount, 0);
  const levels = useTopRows(progression.levelsReached);

  return (
    <Panel>
      <PanelHeader title="Career progression" icon={<TrendingUp size={13} />} />
      <PanelBody className="space-y-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
          <Stat label="XP earned" value={formatNumber(summary.xpEarned)} size="sm" />
          <Stat label="Level at the start" value={formatNumber(summary.levelStart)} size="sm" />
          <Stat label={chapter.complete ? 'Level at the end' : 'Level now'} value={formatNumber(summary.levelEnd)} size="sm" />
          <Stat label="Titles reached" value={formatNumber(progression.titlesReached.length)} sub={progression.titlesReached.join(', ') || undefined} size="sm" />
        </div>
        <div>
          <h3 className="label mb-2">XP by month</h3>
          <PeriodBars
            data={data}
            series={[{ key: 'xp', name: 'XP', color: CHART_COLORS.primary }]}
            points={months.length}
            allowDecimals={false}
            sentence={months.length === 0
              ? `No XP dated in ${chapter.year}.`
              : months.map((month) => `${MONTHS[month.month - 1]}: ${formatNumber(month.xpEarned)} XP`).join('. ') + '.'}
          />
          <p className="mt-1 text-xs text-ink-faint">Dated by when the XP was awarded.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h3 className="label mb-2">Levels reached</h3>
            {progression.levelsReached.length === 0 ? (
              <p className="text-sm text-ink-dim">Level {summary.levelEnd} all through {chapter.year}.</p>
            ) : (
              <div className="rounded-md border border-hairline">
                <ul className="divide-y divide-hairline text-sm">
                  {levels.shown.map((level) => (
                    <li key={level.level} className="flex justify-between gap-2 px-3 py-1.5">
                      <span className="text-ink-muted">Level {formatNumber(level.level)}</span>
                      <span className="text-xs text-ink-dim">{dateOf(level.at)}</span>
                    </li>
                  ))}
                </ul>
                {levels.more}
              </div>
            )}
          </section>
          <section>
            <h3 className="label mb-2">Where the XP came from</h3>
            {progression.xpBySource.length === 0 ? (
              <p className="text-sm text-ink-dim">No XP dated in {chapter.year}.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {progression.xpBySource.map((row) => (
                  <li key={row.source} className="flex justify-between gap-2">
                    <span className="text-ink-muted">{sourceLabel(row.source)}</span>
                    <span className="timing text-xs text-ink-dim">
                      {formatNumber(row.amount)}{total > 0 ? ` · ${Math.round((row.amount / total) * 100)}%` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The year before
// ---------------------------------------------------------------------------

function ComparedWithLastYear({ chapter }: { chapter: ChronicleChapterV1 }) {
  const previous = chapter.previousYear;
  if (previous === null) return null;
  const rows: { label: string; unit: 'seconds' | 'count' | 'xp'; a: number; b: number; format: (value: number) => string }[] = [
    { label: 'Hours watched', unit: 'seconds', a: previous.creditedSeconds, b: chapter.summary.creditedSeconds, format: watched },
    { label: 'Races experienced', unit: 'count', a: previous.racesExperienced, b: chapter.summary.racesExperienced, format: (value) => formatNumber(value) },
    { label: 'Complete race stories', unit: 'count', a: previous.storyCompletes, b: chapter.summary.storyCompletes, format: (value) => formatNumber(value) },
    { label: 'XP earned', unit: 'xp', a: previous.xpEarned, b: chapter.summary.xpEarned, format: (value) => formatNumber(value) },
  ];
  return (
    <Panel>
      <PanelHeader title={`Compared with ${previous.year}`} />
      {previous.careerBeganInYear && previous.activeFrom !== null ? (
        <p className="border-b border-hairline px-4 py-2 text-xs text-ink-dim">
          Your {previous.year} chapter began on {new Date(previous.activeFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.
        </p>
      ) : null}
      <ul className="divide-y divide-hairline">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 px-4 py-2 text-sm">
            <span className="text-ink-muted">{row.label}</span>
            <span className="timing text-xs text-ink-dim">{row.format(row.a)} → {row.format(row.b)}</span>
            <span className="text-xs text-ink-dim">{differencePhrase(row.b - row.a, row.unit)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// About this chapter
// ---------------------------------------------------------------------------

function AboutChapter({ view }: { view: ChronicleChapterView }) {
  const { chapter } = view;
  const weekStart = WEEKDAYS[chapter.weekStartsOn]?.[1] ?? 'Monday';
  const calendar = `time zone ${chapter.timeZone}, week starts ${weekStart}`;
  return (
    <details className="panel">
      <summary className="label cursor-pointer select-none px-4 py-2.5">About this chapter</summary>
      <div className="space-y-2 border-t border-hairline px-4 py-3 text-sm text-ink-muted">
        {view.frozen !== null ? (
          <>
            <p>Frozen on {dateAndTime(view.frozen.frozenAt)} ({calendar}).</p>
            {view.frozen.rebuiltAt !== null ? <p>Rebuilt from the history on {dateAndTime(view.frozen.rebuiltAt)}.</p> : null}
            <p className="text-xs text-ink-dim">
              A finished year is kept exactly as it was written, so later changes to your history do not rewrite it.
            </p>
            <RebuildChapterButton year={chapter.year} frozenAt={view.frozen.frozenAt} />
          </>
        ) : (
          <p>Written from your history as it stands, on {dateAndTime(chapter.generatedAt)} ({calendar}).</p>
        )}
      </div>
    </details>
  );
}

function RebuildChapterButton({ year, frozenAt }: { year: number; frozenAt: Date }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function rebuild() {
    startTransition(async () => {
      const result = await rebuildChronicleYearAction(year);
      setMessage(result.message ?? null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <Button variant="subtle" size="sm" onClick={() => setOpen(true)}>Rebuild this chapter from today’s history…</Button>
      {message !== null ? <p className="mt-2 text-xs text-ink-dim" role="status">{message}</p> : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Rebuild the ${year} chapter`}
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Keep it as it is</Button>
            <Button variant="primary" onClick={rebuild} disabled={pending}>{pending ? 'Rebuilding…' : 'Rebuild'}</Button>
          </div>
        )}
      >
        <p className="text-sm text-ink-muted">
          This chapter was frozen on {formatDate(frozenAt, 'long')}. Rebuilding replaces it with what your history says
          today. Your Wrapped for {year} will follow.
        </p>
      </Dialog>
    </div>
  );
}
