import { PageHeader } from '@/components/layout/page-header';
import { StatisticsView } from '@/components/dashboard/statistics-view';
import { getFilterOptions, getStatistics, type StatsFilter } from '@/lib/engines/stats-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';
import type { RaceStatus, RaceType } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Statistics' };

export default async function StatsPage(props: PageProps<'/stats'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const params = await props.searchParams;

  const filter: StatsFilter = {
    year: num(params.year),
    championshipId: str(params.championship),
    seasonId: str(params.season),
    circuitSlug: str(params.circuit),
    raceType: str(params.type) as RaceType | undefined,
    status: str(params.status) as RaceStatus | undefined,
    minRuntimeHours: num(params.minHours),
    maxRuntimeHours: num(params.maxHours),
    storyCompleteOnly: str(params.complete) === '1' ? true : undefined,
  };

  const [stats, options] = await Promise.all([
    getStatistics(userId, filter),
    getFilterOptions(userId),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="The record"
        title="Statistics"
        description={stats.note}
      />
      <StatisticsView stats={stats} options={options} />
    </div>
  );
}

function str(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single === '' ? undefined : single;
}

function num(value: string | string[] | undefined): number | undefined {
  const single = str(value);
  if (single === undefined) return undefined;
  const parsed = Number.parseFloat(single);
  return Number.isFinite(parsed) ? parsed : undefined;
}
