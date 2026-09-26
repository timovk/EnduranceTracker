import { PageHeader } from '@/components/layout/page-header';
import { StatisticsView, type StatsTab } from '@/components/dashboard/statistics-view';
import {
  getFilterOptions, getRecords, getStatistics, getYearComparison, isRaceStatus, isRaceType, type StatsFilter,
} from '@/lib/engines/stats-engine';
import { seasonPassClosure } from '@/lib/engines/season-pass-engine';
import { DURATION_CLASSES } from '@/lib/config';
import { formatDate } from '@/lib/utils';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Career Statistics' };

const TABS: readonly StatsTab[] = ['overview', 'cadence', 'breakdown', 'career', 'records', 'compare'];

/**
 * Career Statistics. The address says what to show: the filters, the tab
 * (`?tab=`) for the first render, and for Compare the two years (`a`, `b`)
 * and whether a year in progress is cut to the same stretch (`same=0` turns
 * that off). The four core tabs are always computed; Records and Compare only
 * when the address asks for them.
 */
export default async function StatsPage(props: PageProps<'/stats'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const params = await props.searchParams;
  const now = new Date();

  const requested = str(params.tab);
  const tab = TABS.find((candidate) => candidate === requested) ?? 'overview';
  // Values that name a fixed set are kept only when they are in it; anything
  // else in the address chooses nothing rather than reaching a query.
  const lengthKey = str(params.length);
  const statusKey = str(params.status);
  const typeKey = str(params.type);

  const filter: StatsFilter = {
    year: num(params.year),
    championshipId: str(params.championship),
    seasonId: str(params.season),
    circuitSlug: str(params.circuit),
    eventKey: str(params.event),
    raceId: str(params.race),
    length: DURATION_CLASSES.some((band) => band.key === lengthKey) ? lengthKey : undefined,
    raceType: isRaceType(typeKey) ? typeKey : undefined,
    status: isRaceStatus(statusKey) ? statusKey : undefined,
    minRuntimeHours: num(params.minHours),
    maxRuntimeHours: num(params.maxHours),
    storyCompleteOnly: str(params.complete) === '1' ? true : undefined,
  };

  const [stats, options, records, comparison] = await Promise.all([
    getStatistics(userId, filter, now),
    getFilterOptions(userId, filter),
    tab === 'records' ? getRecords(userId, filter) : Promise.resolve(null),
    tab === 'compare'
      ? getYearComparison(userId, int(params.a), int(params.b), { samePeriod: str(params.same) !== '0', filter }, now)
      : Promise.resolve(null),
  ]);

  // While the season is closed (0.3.1) the pass figures are all zero; the
  // panel says why rather than leaving the zeros to speak for themselves.
  const closure = seasonPassClosure();
  const seasonClosure = closure ? { label: closure.label, opensOn: formatDate(closure.reopensAt, 'long') } : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="The record"
        title="Career Statistics"
        description={stats.note}
      />
      <StatisticsView
        stats={stats}
        options={options}
        initialTab={tab}
        records={records}
        comparison={comparison}
        seasonClosure={seasonClosure}
      />
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

function int(value: string | string[] | undefined): number | undefined {
  const parsed = num(value);
  return parsed === undefined || !Number.isInteger(parsed) ? undefined : parsed;
}
