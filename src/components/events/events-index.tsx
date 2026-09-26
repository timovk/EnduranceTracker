'use client';

/**
 * The Events page body: the suggestions, then every recurring event the
 * career follows as a card, sortable and searchable, and the archived and
 * merged ones tucked away underneath.
 *
 * A long career can follow a great many events, so the list starts with the
 * first page of cards and grows on request, and the search runs over names
 * the page already holds.
 */

import * as React from 'react';
import Link from 'next/link';
import { Repeat, Search } from 'lucide-react';
import type { EventCard, EventsIndexView } from '@/lib/engines/event-legacy-engine';
import { formatDuration } from '@/lib/domain/time';
import { Input, Segmented, Button } from '@/components/ui/controls';
import { EmptyState, Panel, PanelBody, PanelHeader, Stat, TimingBar } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/utils';
import { EventSuggestions } from './event-suggestions';
import { accentVars } from '@/components/ui/accent';

/** Cards drawn before "Show more". */
const PAGE_SIZE = 30;

type SortKey = 'watched' | 'editions' | 'recent' | 'name';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'watched', label: 'Most watched' },
  { value: 'editions', label: 'Most editions' },
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'A–Z' },
];

function compareCards(sort: SortKey): (a: EventCard, b: EventCard) => number {
  const byName = (a: EventCard, b: EventCard) => a.name.localeCompare(b.name);
  switch (sort) {
    case 'editions':
      return (a, b) => b.editionsExperienced - a.editionsExperienced || b.editionsInLibrary - a.editionsInLibrary || byName(a, b);
    case 'recent':
      return (a, b) => (b.lastWatchedAt?.getTime() ?? 0) - (a.lastWatchedAt?.getTime() ?? 0) || byName(a, b);
    case 'name':
      return byName;
    case 'watched':
    default:
      return (a, b) => b.creditedSeconds - a.creditedSeconds || byName(a, b);
  }
}

export function EventsIndex({ view }: { view: EventsIndexView }) {
  const [sort, setSort] = React.useState<SortKey>('watched');
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE_SIZE);

  const needle = query.trim().toLowerCase();
  const matching = view.events
    .filter((event) => needle === '' || event.name.toLowerCase().includes(needle))
    .sort(compareCards(sort));
  const shown = matching.slice(0, limit);

  return (
    <div className="space-y-4">
      <EventSuggestions suggestions={view.suggestions} />

      {view.events.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Repeat size={22} />}
            title="No recurring events yet"
            body="An event gathers every edition of a race you follow — every Le Mans, every Sebring. Create one, or pick one on a race's edit page."
          />
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented value={sort} onChange={setSort} options={SORTS} size="sm" />
            <div className="relative w-full sm:w-64">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
                placeholder="Find an event"
                className="pl-8"
                aria-label="Find an event"
              />
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-dim">No event you follow goes by that name.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((event) => <EventCardView key={event.key} event={event} />)}
            </ul>
          )}

          {matching.length > shown.length ? (
            <div className="flex justify-center">
              <Button variant="subtle" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                Show more ({formatNumber(matching.length - shown.length)} more)
              </Button>
            </div>
          ) : null}
        </>
      )}

      {view.inactive.length > 0 ? (
        <details className="panel group">
          <summary className="label cursor-pointer select-none px-4 py-2.5">
            Archived and merged events · {view.inactive.length}
          </summary>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {view.inactive.map((event) => (
              <li key={event.key} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm">
                <Link href={event.href} className="text-ink-muted hover:text-ink">{event.name}</Link>
                <span className="text-xs text-ink-dim">
                  {event.state === 'merged' && event.mergedInto ? (
                    <>
                      Combined into{' '}
                      <Link href={event.mergedInto.href} className="text-ink-muted underline-offset-2 hover:underline">
                        {event.mergedInto.name}
                      </Link>
                    </>
                  ) : event.state === 'merged' ? 'Combined into another event' : 'Archived'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Credited time, whole minutes: "181h 42m", or "0m" before the first minute. */
function watchedTime(seconds: number): string {
  return seconds < 60 ? '0m' : formatDuration(seconds);
}

function EventCardView({ event }: { event: EventCard }) {
  return (
    <li>
      <Link href={event.href} className="block h-full">
        <Panel style={accentVars(event.accentColor)} className="h-full transition-colors hover:border-hairline-strong">
          <PanelHeader
            title={event.name}
            icon={<Repeat size={12} className="text-[var(--accent)]" />}
            action={event.latestEditionYear !== null ? (
              <span className="timing text-[0.6875rem] text-ink-faint">{event.latestEditionYear}</span>
            ) : null}
          />
          <PanelBody className="space-y-3">
            <p className="line-clamp-2 text-xs leading-relaxed text-ink-dim">{event.headline}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Editions" value={formatNumber(event.editionsExperienced)} sub="experienced" size="sm" />
              <Stat label="Watched" value={watchedTime(event.creditedSeconds)} size="sm" />
              <Stat label="Stories" value={formatNumber(event.storyCompleteRaces)} sub="complete" size="sm" />
            </div>
            <div>
              <TimingBar
                value={event.stepsUnlocked}
                max={Math.max(1, event.stepsTotal)}
                height="h-1"
                label={`${event.name} steps reached`}
              />
              <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
                <span>Steps reached</span>
                <span className="timing">{event.stepsUnlocked}/{event.stepsTotal}</span>
              </div>
            </div>
          </PanelBody>
        </Panel>
      </Link>
    </li>
  );
}
