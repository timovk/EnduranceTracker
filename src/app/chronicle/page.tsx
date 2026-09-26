import { PageHeader } from '@/components/layout/page-header';
import { ChronicleIndex } from '@/components/chronicle/chronicle-index';
import { WrappedReadyBanner } from '@/components/chronicle/wrapped-ready-banner';
import { getChronicleIndex } from '@/lib/engines/chronicle-engine';
import { freezeFinishedYears } from '@/lib/server/upgrades/chronicle-freeze';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chronicle' };

/**
 * The Career Chronicle: every calendar year of the career, newest first. Any
 * finished year that is due is frozen before the years are read.
 */
export default async function ChroniclePage() {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const now = new Date();
  await freezeFinishedYears(userId, now);
  const view = await getChronicleIndex(userId, now);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="Your career, year by year"
        title="Chronicle"
        description="A chapter for every year you have watched, from Career Year 1 onwards. A finished year is kept exactly as it was, settled a few days into January."
        className="mb-2"
      />
      {view.pendingWrapped !== null ? <WrappedReadyBanner year={view.pendingWrapped.year} /> : null}
      <ChronicleIndex view={view} />
    </div>
  );
}
