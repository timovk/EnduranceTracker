import { PageHeader } from '@/components/layout/page-header';
import { TrophyCabinet } from '@/components/dashboard/trophy-cabinet';
import { getTrophyCabinet } from '@/lib/engines/awards-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trophy Cabinet' };

export default async function TrophiesPage() {
  await ensureCareer();
  const cabinet = await getTrophyCabinet(USER_ID);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="The cabinet"
        title="Trophies"
        description="Season trophies, major events, completed mastery trees, prestige emblems and the rarest achievements. Open one to see what it was made of."
      />
      <TrophyCabinet cabinet={cabinet} />
    </div>
  );
}
