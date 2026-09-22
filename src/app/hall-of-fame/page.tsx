import { PageHeader } from '@/components/layout/page-header';
import { HallOfFameTimeline } from '@/components/dashboard/hall-of-fame';
import { getHallOfFame } from '@/lib/engines/awards-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hall of Fame' };

export default async function HallOfFamePage() {
  await ensureCareer();
  const hall = await getHallOfFame(USER_ID);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="The permanent archive"
        title="Hall of Fame"
        description="Every moment worth remembering, with the career statistics frozen exactly as they stood at the time. Nothing here can ever be revoked."
      />
      <HallOfFameTimeline hall={hall} />
    </div>
  );
}
