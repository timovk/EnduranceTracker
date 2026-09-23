import { PageHeader } from '@/components/layout/page-header';
import { SeasonPassTrack } from '@/components/dashboard/season-pass-track';
import { SeasonPassClosed } from '@/components/dashboard/season-pass-closed';
import { EmptyState, Panel } from '@/components/ui/primitives';
import {
  archiveExpiredPasses, getPassHistory, getSeasonPassView, seasonPassClosure,
} from '@/lib/engines/season-pass-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Season Pass' };

export default async function SeasonPassPage(props: PageProps<'/season-pass'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const params = await props.searchParams;

  const header = (
    <PageHeader
      eyebrow="Quarterly"
      title="Season Pass"
      description="One hundred tiers, every quarter, entirely free. Rewards are cosmetic and collectible by design, so a quarter closing on its real deadline never costs your permanent career anything."
    />
  );

  // While the season is closed (0.3.1) no pass exists or can be created, so
  // the page is the closed state and nothing else: when the pass opens and
  // what it will offer, straight from the engine.
  const closure = seasonPassClosure();
  if (closure) {
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        <SeasonPassClosed closure={closure} />
      </div>
    );
  }

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
      {header}

      {pass === null ? (
        <Panel>
          <EmptyState
            title="No pass yet"
            body="This quarter's pass starts with your first stint of the quarter, from tier 0."
          />
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
