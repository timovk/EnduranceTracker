import { PageHeader } from '@/components/layout/page-header';
import { ChallengeBoard } from '@/components/dashboard/challenge-board';
import { ensureChallenges, expireStaleChallenges, getActiveChallenges } from '@/lib/engines/challenge-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Challenges' };

export default async function ChallengesPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);

  // Generation is idempotent and derived from the library, so it is safe to
  // reconcile on every view. Expiry is neutral bookkeeping, never a penalty.
  await ensureChallenges(userId);
  await expireStaleChallenges(userId);
  const challenges = await getActiveChallenges(userId);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Optional"
        title="Challenges"
        description="Generated from the races you actually have, so nothing here is impossible. Every one of them is optional — letting a window close costs nothing at all."
      />
      <ChallengeBoard challenges={challenges} />
    </div>
  );
}
