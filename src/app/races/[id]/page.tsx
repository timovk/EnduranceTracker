import { notFound } from 'next/navigation';
import { RaceDetailView } from '@/components/races/race-detail-view';
import { getRaceDetail } from '@/lib/server/races';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';
import { TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: PageProps<'/races/[id]'>) {
  const { id } = await props.params;
  const race = await getRaceDetail(USER_ID, id);
  return { title: race?.name ?? 'Race' };
}

export default async function RacePage(props: PageProps<'/races/[id]'>) {
  await ensureCareer();
  const { id } = await props.params;
  const race = await getRaceDetail(USER_ID, id);
  if (!race) notFound();

  return (
    <div className="mx-auto max-w-5xl">
      <RaceDetailView race={race} longHaulThresholdSec={TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec} />
    </div>
  );
}
