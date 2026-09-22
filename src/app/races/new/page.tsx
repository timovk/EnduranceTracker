import { PageHeader } from '@/components/layout/page-header';
import { AddRaceForm } from '@/components/races/add-race-form';
import { getChampionshipOptions, getIconicKeysInUse } from '@/lib/server/races';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add a race' };

export default async function AddRacePage() {
  await ensureCareer();
  const [championships, iconicKeys] = await Promise.all([
    getChampionshipOptions(USER_ID),
    getIconicKeysInUse(USER_ID),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Race library"
        title="Add a race"
        description="Races are added by hand, deliberately. Nothing is imported, so the library is exactly what you decide it is."
      />
      <AddRaceForm
        championships={championships.map((c) => ({
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          accentColor: c.accentColor,
          seasons: c.seasons.map((s) => ({ id: s.id, year: s.year, raceCount: s._count.races })),
        }))}
        iconicKeysInUse={iconicKeys}
      />
    </div>
  );
}
