'use client';

/**
 * Endurance Wrapped: a year's cards, one at a time, clicked through by the
 * user and never played by themselves — no timer, no auto-advance and no
 * animation beyond each card rising in, which the reduced-motion rule turns
 * off.
 *
 * Back and Next, the arrow keys and the progress dots move between cards;
 * Escape goes back to the chapter. Where the deck is lives in `?card=N`,
 * written with `history.replaceState`, so moving never asks the server for
 * the page again. Reaching the last card of a frozen year marks its Wrapped
 * seen; a preview of the year in progress, or of a year still finalising,
 * never marks anything.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WrappedCard as Card } from '@/lib/domain/chronicle';
import { Button } from '@/components/ui/controls';
import { markWrappedSeenAction } from '@/lib/server/career-actions';
import { cn } from '@/lib/utils';
import { WrappedCard } from './wrapped-card';

export interface WrappedSlide {
  card: Card;
  /** `wrappedCardLine(card)`, said on the server. */
  line: string;
}

export function WrappedDeck({
  year, slides, initialIndex, markSeenAtEnd, chapterHref,
}: {
  year: number;
  slides: WrappedSlide[];
  /** The card the address asked for, 0-based. */
  initialIndex: number;
  /** A frozen year whose Wrapped has not been seen: reaching its last card marks it. */
  markSeenAtEnd: boolean;
  chapterHref: string;
}) {
  const router = useRouter();
  const last = slides.length - 1;
  const [index, setIndex] = React.useState(() => Math.min(Math.max(0, initialIndex), last));
  const marked = React.useRef(false);

  function go(target: number) {
    const next = Math.min(Math.max(0, target), last);
    if (next === index) return;
    setIndex(next);
    window.history.replaceState(null, '', `?card=${next + 1}`);
    if (next === last && markSeenAtEnd && !marked.current) {
      marked.current = true;
      void markWrappedSeenAction(year);
    }
  }

  const onKey = React.useEffectEvent((event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      router.push(chapterHref);
    }
  });

  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const slide = slides[index]!;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div aria-live="polite" aria-atomic="true">
        <div key={index} className="animate-[rise_0.24s_var(--ease-out-quint)_both]">
          <WrappedCard card={slide.card} line={slide.line} chapterHref={chapterHref} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="subtle" onClick={() => go(index - 1)} disabled={index === 0}>
          <ChevronLeft size={14} /> Back
        </Button>
        <ol className="flex flex-wrap items-center justify-center gap-1.5">
          {slides.map((entry, position) => (
            <li key={`${entry.card.kind}-${position}`}>
              <button
                type="button"
                onClick={() => go(position)}
                aria-label={`Card ${position + 1} of ${slides.length}`}
                aria-current={position === index ? 'step' : undefined}
                className={cn(
                  'block h-2 rounded-full transition-[width,background-color]',
                  position === index ? 'w-5 bg-[var(--accent)]' : 'w-2 bg-panel-3 hover:bg-hairline-strong',
                )}
              />
            </li>
          ))}
        </ol>
        {index < last ? (
          <Button variant="primary" onClick={() => go(index + 1)}>
            Next <ChevronRight size={14} />
          </Button>
        ) : (
          <Link href={chapterHref}>
            <Button variant="primary">Read the chapter</Button>
          </Link>
        )}
      </div>
      <p className="text-center text-xs text-ink-faint">Use the arrow keys to move between cards, and Escape to go back to the chapter.</p>
    </div>
  );
}
