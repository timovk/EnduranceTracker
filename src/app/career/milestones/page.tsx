import { PageHeader } from '@/components/layout/page-header';
import { CareerMilestonesView } from '@/components/milestones/career-milestones-view';
import { Panel, PanelBody } from '@/components/ui/primitives';
import { getCareerMilestonesView } from '@/lib/engines/career-milestone-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Career Milestones' };

export default async function CareerMilestonesPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const view = await getCareerMilestonesView(userId, new Date());

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="Permanent record"
        title="Career Milestones"
        description="The major moments of your endurance-racing life, each with the day it happened."
      />

      <Panel>
        <PanelBody>
          <p className="text-sm leading-relaxed text-ink-muted">
            Achievements are challenges you complete. Milestones are the permanent moments of your career. Each
            keeps the date it happened, even if you later change the stints behind it.
          </p>
        </PanelBody>
      </Panel>

      <CareerMilestonesView view={view} />
    </div>
  );
}
