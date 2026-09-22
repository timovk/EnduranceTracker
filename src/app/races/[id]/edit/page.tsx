import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { EditRaceForm } from '@/components/races/edit-race-form';
import { getChampionshipOptions, getIconicKeysInUse, getRaceDetail } from '@/lib/server/races';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit race' };

export default async function EditRacePage(props: PageProps<'/races/[id]/edit'>) {
  await ensureCareer();
  const { id } = await props.params;

  const [race, championships, iconicKeys] = await Promise.all([
    getRaceDetail(USER_ID, id),
    getChampionshipOptions(USER_ID),
    getIconicKeysInUse(USER_ID),
  ]);
  if (!race) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Race library"
        title={`Edit ${race.name}`}
        description="Changing the race length changes what completing it means, so the coverage figures are recalculated when you save."
      />
      <EditRaceForm
        race={race}
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
