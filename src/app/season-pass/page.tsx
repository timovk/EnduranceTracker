import { PageHeader } from '@/components/layout/page-header';
import { SeasonPassTrack } from '@/components/dashboard/season-pass-track';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { archiveExpiredPasses, getPassHistory, getSeasonPassView } from '@/lib/engines/season-pass-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Season Pass' };

export default async function SeasonPassPage(props: PageProps<'/season-pass'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const params = await props.searchParams;

  // Archival is neutral bookkeeping: a quarter that ended is simply closed.
  await archiveExpiredPasses(userId);

  const year = single(params.year);
  const quarter = single(params.quarter);
  const [pass, history] = await Promise.all([
    getSeasonPassView(userId, {
      year: year ? Number.parseInt(year, 10) : undefined,
      quarter: quarter ? Number.parseInt(quarter, 10) : undefined,
    }),
    getPassHistory(userId),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Quarterly"
        title="Season Pass"
        description="One hundred tiers, every quarter, entirely free. Rewards are cosmetic and collectible by design, so a quarter closing on its real deadline never costs your permanent career anything."
      />

      {pass === null ? (
        <Panel>
          <EmptyState title="No pass yet" body="A new pass opens automatically at the start of each quarter." />
        </Panel>
      ) : (
        <SeasonPassTrack pass={pass} history={history} />
      )}
    </div>
  );
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
