import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/controls';
import { EmptyState, Panel } from '@/components/ui/primitives';
import { RaceCard, raceCardVariantOf } from '@/components/races/race-card';
import { RaceFilterBar } from '@/components/races/race-filter-bar';
import { RemovalNotice } from '@/components/races/removal-notice';
import { getChampionshipOptions, listRaces, type RaceFilter } from '@/lib/server/races';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';
import { getEffectiveCosmetics } from '@/lib/server/cosmetics';
import { backlogFraming, raceRemovedNotice } from '@/lib/copy/tone';
import type { RaceStatus } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Race library' };

export default async function RacesPage(props: PageProps<'/races'>) {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const params = await props.searchParams;

  const filter: RaceFilter = {
    search: single(params.q),
    championshipId: single(params.championship),
    sort: (single(params.sort) as RaceFilter['sort']) ?? 'recent',
    status: single(params.status) ? [single(params.status) as RaceStatus] : undefined,
    storyCompleteOnly: single(params.view) === 'complete',
    unfinishedOnly: single(params.view) === 'unfinished',
    majorOnly: single(params.view) === 'major',
  };

  const [races, championships, cosmetics] = await Promise.all([
    listRaces(userId, filter),
    getChampionshipOptions(userId),
    getEffectiveCosmetics(userId),
  ]);
  const cardVariant = raceCardVariantOf(cosmetics.raceCardKey);

  const unwatched = races.filter((r) => r.coverageSec === 0 && !r.storyComplete).length;
  const removal = removalOf(single(params.removed), single(params.xp));

  return (
    <div>
      <PageHeader
        eyebrow="Race library"
        title="Your races"
        description={backlogFraming(unwatched)}
        actions={
          <Link href="/races/new">
            <Button variant="primary" size="sm"><Plus size={14} /> Add a race</Button>
          </Link>
        }
      />

      {removal !== null ? <RemovalNotice className="mb-4" message={removal} /> : null}

      <RaceFilterBar
        championships={championships.map((c) => ({ id: c.id, name: c.name, count: c._count.races }))}
      />

      {races.length === 0 ? (
        <Panel className="mt-4">
          <EmptyState
            title="Nothing here yet"
            body="Add the first race you would like to watch. The library is yours to define — nothing is imported."
            action={<Link href="/races/new"><Button variant="primary" size="sm">Add a race</Button></Link>}
          />
        </Panel>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {races.map((race) => <RaceCard key={race.id} race={race} variant={cardVariant} />)}
        </div>
      )}
    </div>
  );
}

/**
 * The notice the race page asked for after removing a race, or null. The two
 * parameters are only ever words to show: the name is cut to a sensible
 * length and anything but a whole number of XP reads as none.
 */
function removalOf(name: string | undefined, xp: string | undefined): string | null {
  const raceName = name?.trim().slice(0, 200);
  if (!raceName) return null;
  const amount = Number.parseInt(xp ?? '', 10);
  return raceRemovedNotice(raceName, Number.isFinite(amount) && amount > 0 ? amount : 0);
}

function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
