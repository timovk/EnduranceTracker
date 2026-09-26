/**
 * The Chronicle's index: every calendar year of the career, newest first, as
 * a card each — its Career Year, its hours, races and complete stories, what
 * it was mostly about — with its chapter and its Wrapped a click away. A year
 * with nothing in it between active ones is a single quiet line, so the
 * numbering never skips and ten years still read as one career.
 */

import Link from 'next/link';
import { BookOpen, History, Sparkles } from 'lucide-react';
import type { ChronicleIndexChapter, ChronicleIndexView } from '@/lib/engines/chronicle-engine';
import { formatDuration } from '@/lib/domain/time';
import { Badge, EmptyState, Panel, PanelBody, Stat } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/utils';

function settles(on: Date): string {
  return on.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

/** The badge that says where a year stands. */
export function ChapterStateBadge({ state, settlesOn }: { state: ChronicleIndexChapter['state']; settlesOn: Date | null }) {
  if (state === 'year-to-date') return <Badge tone="accent">Year to date</Badge>;
  if (state === 'finalising') {
    return <Badge tone="info">{settlesOn === null ? 'Complete — finalising' : `Complete — finalising until ${settles(settlesOn)}`}</Badge>;
  }
  return <Badge tone="positive">Complete</Badge>;
}

function watched(seconds: number): string {
  return seconds < 60 ? '0m' : formatDuration(seconds);
}

function ChapterCard({ year }: { year: ChronicleIndexChapter }) {
  const chapterHref = `/chronicle/${year.year}`;
  return (
    <li>
      <Panel className="h-full">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">
            <Link href={chapterHref} className="hover:text-[var(--accent)]">
              <span className="timing">{year.year}</span>
              <span className="text-ink-dim"> · Career Year {year.careerYear}</span>
            </Link>
          </h2>
          <ChapterStateBadge state={year.state} settlesOn={year.settlesOn} />
        </div>
        <PanelBody className="space-y-4">
          {year.unreadable ? (
            <p className="text-sm text-ink-dim">This chapter was saved by a newer version.</p>
          ) : year.empty ? (
            <p className="text-sm text-ink-dim">Your {year.year} chapter starts with your next stint.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Watched" value={watched(year.creditedSeconds)} size="sm" />
                <Stat label="Experienced" value={formatNumber(year.racesExperienced)} sub="races" size="sm" />
                <Stat label="Completed" value={formatNumber(year.storyCompletes)} sub="Story Complete" size="sm" />
              </div>
              {year.top !== null ? (
                <p className="truncate text-xs text-ink-dim">
                  Mostly {year.top.kind === 'event' ? 'the recurring event' : 'the championship'}{' '}
                  <span className="text-ink-muted">{year.top.name}</span>
                </p>
              ) : null}
            </>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Link href={chapterHref} className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink">
              <BookOpen size={12} /> Read the chapter
            </Link>
            {!year.empty && !year.unreadable ? (
              <Link href={`${chapterHref}/wrapped`} className="inline-flex items-center gap-1.5 text-[var(--accent)] hover:underline">
                <Sparkles size={12} /> {year.state === 'year-to-date' ? 'Wrapped so far' : 'Wrapped'}
              </Link>
            ) : null}
          </div>
        </PanelBody>
      </Panel>
    </li>
  );
}

export function ChronicleIndex({ view }: { view: ChronicleIndexView }) {
  if (view.years.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<History size={22} />}
          title="No chapters yet"
          body="Your first chapter starts with your first stint. Everything you watch from then on is written here, year by year."
        />
      </Panel>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {view.years.map((year) => (year.kind === 'quiet' ? (
        <li key={year.year} className="flex items-center gap-2 px-4 py-2 text-sm text-ink-faint sm:col-span-2">
          <span className="timing">{year.year}</span>
          <span>— no racing logged</span>
          <span className="text-xs">· Career Year {year.careerYear}</span>
        </li>
      ) : (
        <ChapterCard key={year.year} year={year} />
      )))}
    </ul>
  );
}
