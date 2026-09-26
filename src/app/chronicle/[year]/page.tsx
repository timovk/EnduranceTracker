import { notFound } from 'next/navigation';
import { ChapterView } from '@/components/chronicle/chapter-view';
import { Panel, EmptyState } from '@/components/ui/primitives';
import { getChronicleChapter } from '@/lib/engines/chronicle-engine';
import { UnreadableChapterError } from '@/lib/domain/chronicle';
import { freezeFinishedYears } from '@/lib/server/upgrades/chronicle-freeze';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** The year in the address, when it is one: four digits and nothing else. */
function yearOf(segment: string): number | null {
  return /^\d{4}$/.test(segment) ? Number.parseInt(segment, 10) : null;
}

export async function generateMetadata(props: PageProps<'/chronicle/[year]'>) {
  const { year } = await props.params;
  return { title: yearOf(year) === null ? 'Chronicle' : `${year} — Chronicle` };
}

/**
 * One year's chapter. Finished years that are due are frozen first, so a
 * chapter past its grace period is always read from its snapshot. A year
 * before the career's first, after this one, or not a year at all is not
 * found.
 */
export default async function ChapterPage(props: PageProps<'/chronicle/[year]'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const { year: segment } = await props.params;
  const year = yearOf(segment);
  if (year === null) notFound();

  const now = new Date();
  await freezeFinishedYears(userId, now);
  let view: Awaited<ReturnType<typeof getChronicleChapter>>;
  try {
    view = await getChronicleChapter(userId, year, now);
  } catch (error) {
    if (!(error instanceof UnreadableChapterError)) throw error;
    return (
      <div className="mx-auto max-w-5xl">
        <Panel>
          <EmptyState title={`The ${year} chapter`} body="This chapter was saved by a newer version." />
        </Panel>
      </div>
    );
  }
  if (view === null) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <ChapterView view={view} />
    </div>
  );
}
