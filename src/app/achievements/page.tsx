import { PageHeader } from '@/components/layout/page-header';
import { AchievementBoardView } from '@/components/dashboard/achievement-board';
import { getAchievementBoard, getMilestoneBoard, syncAchievementDefinitions } from '@/lib/engines/achievement-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Achievements' };

export default async function AchievementsPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);
  // Definitions are data, so they are reconciled here rather than in the hot
  // session path. Idempotent: adding an achievement to configuration is all
  // that is needed to make it appear.
  await syncAchievementDefinitions();

  const [achievements, milestones] = await Promise.all([
    getAchievementBoard(userId),
    getMilestoneBoard(userId),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Collection"
        title="Achievements and milestones"
        description="Achievements are moments. Milestones are the numbers underneath them. Neither can ever be lost."
      />
      <AchievementBoardView achievements={achievements} milestones={milestones} />
    </div>
  );
}
