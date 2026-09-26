import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { WrappedDeck } from '@/components/chronicle/wrapped-deck';
import { Panel, EmptyState } from '@/components/ui/primitives';
import { getChronicleChapter } from '@/lib/engines/chronicle-engine';
import { buildWrappedCards, UnreadableChapterError } from '@/lib/domain/chronicle';
import { wrappedCardLine } from '@/lib/copy/tone';
import { freezeFinishedYears } from '@/lib/server/upgrades/chronicle-freeze';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function yearOf(segment: string): number | null {
  return /^\d{4}$/.test(segment) ? Number.parseInt(segment, 10) : null;
}

export async function generateMetadata(props: PageProps<'/chronicle/[year]/wrapped'>) {
  const { year } = await props.params;
  return { title: yearOf(year) === null ? 'Endurance Wrapped' : `${year} — Endurance Wrapped` };
}

/**
 * A year's Endurance Wrapped, one card at a time. The address's `?card=N` is
 * read for the first card only; after that the deck keeps it up to date
 * itself. The year in progress gets a preview, every card of it marked as
 * such.
 */
export default async function WrappedPage(props: PageProps<'/chronicle/[year]/wrapped'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const [{ year: segment }, params] = await Promise.all([props.params, props.searchParams]);
  const year = yearOf(segment);
  if (year === null) notFound();

  const now = new Date();
  await freezeFinishedYears(userId, now);
  const chapterHref = `/chronicle/${year}`;
  let view: Awaited<ReturnType<typeof getChronicleChapter>>;
  try {
    view = await getChronicleChapter(userId, year, now);
  } catch (error) {
    if (!(error instanceof UnreadableChapterError)) throw error;
    return (
      <div className="mx-auto max-w-3xl">
        <Panel>
          <EmptyState title={`Endurance Wrapped ${year}`} body="This chapter was saved by a newer version." />
        </Panel>
      </div>
    );
  }
  if (view === null) notFound();

  const { chapter } = view;
  const nothingYet = chapter.summary.sessions === 0 && chapter.summary.creditedSeconds < 1;
  const cards = buildWrappedCards(chapter, { careerYear: view.careerYear, state: view.state });
  const requested = typeof params.card === 'string' ? Number.parseInt(params.card, 10) : Number.NaN;

  return (
    <div className="space-y-4">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 text-xs">
        <Link href={chapterHref} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink">
          <ChevronLeft size={13} /> The {year} chapter
        </Link>
        <span className="text-ink-dim">
          {view.state === 'year-to-date' ? 'Year to date — a preview' : view.state === 'finalising' ? 'Complete — finalising' : 'Endurance Wrapped'}
        </span>
      </div>
      {nothingYet ? (
        <div className="mx-auto max-w-3xl">
          <Panel>
            <EmptyState title={`Endurance Wrapped ${year}`} body={`Your ${year} chapter starts with your next stint.`} />
          </Panel>
        </div>
      ) : (
        <WrappedDeck
          year={year}
          slides={cards.map((card) => ({ card, line: wrappedCardLine(card) }))}
          initialIndex={Number.isInteger(requested) ? requested - 1 : 0}
          markSeenAtEnd={view.state === 'frozen' && !view.wrappedSeen}
          chapterHref={chapterHref}
        />
      )}
    </div>
  );
}
