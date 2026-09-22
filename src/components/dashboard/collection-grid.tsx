'use client';

/**
 * Championship collections.
 *
 * Each season is drawn as a set of cards. A filled card is a completed race; a
 * card with a coloured border is one watched all the way through. An empty card
 * is not a reproach — it is simply a race still ahead of you.
 */

import Link from 'next/link';
import { Check, Star } from 'lucide-react';
import type { CollectionView } from '@/lib/engines/collection-engine';
import { formatDuration } from '@/lib/domain/time';
import { EmptyState, Panel, PanelBody, PanelHeader, TimingBar } from '@/components/ui/primitives';
import { cn, formatDate } from '@/lib/utils';

export function CollectionGrid({ collections }: { collections: CollectionView[] }) {
  // A season with no races filed and no declared length is not a set yet — it
  // is an empty shelf. Showing it as "0 of 0" would be noise. A season the
  // user HAS declared a length for still appears, because those empty slots
  // are the point of declaring it.
  const sets = collections.filter((c) => c.cards.length > 0 || c.target > 0);

  if (sets.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No sets yet"
          body="Give a race a championship and a year and it becomes part of a collectible season."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {sets.map((collection) => (
        <CollectionPanel key={collection.key} collection={collection} />
      ))}
    </div>
  );
}

function CollectionPanel({ collection }: { collection: CollectionView }) {
  const complete = collection.completedAt !== null;

  return (
    <Panel
      accent={collection.accentColor}
      className={cn(complete && 'border-[color-mix(in_oklab,var(--accent)_50%,transparent)]')}
    >
      <PanelHeader
        title={collection.name}
        action={
          <span className="flex items-center gap-2.5 text-[0.6875rem]">
            {collection.allStoryComplete ? (
              <span className="uppercase tracking-[0.1em] text-[var(--accent)]">season sweep</span>
            ) : complete ? (
              <span className="uppercase tracking-[0.1em] text-[var(--accent)]">season complete</span>
            ) : null}
            <span className="timing text-ink-faint">
              {collection.filledCount}/{collection.target}
            </span>
          </span>
        }
      />
      <PanelBody className="space-y-3.5">
        <div>
          <TimingBar
            value={collection.completionPercent}
            height="h-1.5"
            color={collection.accentColor}
            label={`${collection.name} completion`}
          />
          <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[0.6875rem] text-ink-faint">
            <span>
              {collection.storyCompleteCount} of {collection.target} watched end to end
              {complete && collection.completedAt ? ` · completed ${formatDate(collection.completedAt)}` : ''}
            </span>
            <span className="timing">{collection.completionPercent.toFixed(0)}%</span>
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {collection.cards.map((card) => (
            <li key={card.key}>
              {card.raceId ? (
                <Link href={`/races/${card.raceId}`} className="block h-full">
                  <Card card={card} accent={collection.accentColor} />
                </Link>
              ) : (
                <Card card={card} accent={collection.accentColor} />
              )}
            </li>
          ))}

          {/* Declared but not yet filed: the user said the season has more. */}
          {Array.from({ length: Math.max(0, collection.target - collection.cards.length) }).map((_, i) => (
            <li key={`slot-${i}`}>
              <div className="flex h-full min-h-[5.25rem] items-center justify-center rounded-md border border-dashed border-hairline bg-panel/40 px-2.5 py-2 text-center">
                <span className="text-[0.625rem] leading-relaxed text-ink-faint">
                  A race you have yet to add
                </span>
              </div>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}

function Card({
  card, accent,
}: { card: CollectionView['cards'][number]; accent: string }) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[5.25rem] flex-col justify-between rounded-md border px-2.5 py-2 transition-colors',
        card.filled ? 'bg-panel-2' : 'bg-panel/50',
        card.raceId && 'hover:border-hairline-strong',
      )}
      style={{
        borderColor: card.storyComplete
          ? `color-mix(in oklab, ${accent} 55%, transparent)`
          : 'var(--color-hairline)',
      }}
    >
      <div className="min-w-0">
        <div className="flex items-start gap-1.5">
          {card.storyComplete ? (
            <Check size={11} className="mt-0.5 shrink-0" style={{ color: accent }} />
          ) : null}
          {card.isMajorEvent ? (
            <Star size={10} className="mt-0.5 shrink-0" style={{ color: accent }} fill="currentColor" />
          ) : null}
          <span className={cn('line-clamp-2 text-[0.6875rem] leading-snug', card.filled ? 'text-ink' : 'text-ink-muted')}>
            {card.name}
          </span>
        </div>
        {card.circuit ? (
          <p className="mt-0.5 truncate text-[0.625rem] text-ink-faint">{card.circuit}</p>
        ) : null}
      </div>

      <div className="mt-1.5">
        <TimingBar value={card.coveragePercent} height="h-0.5" color={accent} label={card.name} />
        <div className="mt-1 flex justify-between text-[0.5625rem] text-ink-faint">
          <span className="timing">{card.coveragePercent.toFixed(0)}%</span>
          <span className="timing">{formatDuration(card.runtimeSec)}</span>
        </div>
      </div>
    </div>
  );
}
