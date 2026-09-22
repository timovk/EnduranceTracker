import { PageHeader } from '@/components/layout/page-header';
import { ChallengeBoard } from '@/components/dashboard/challenge-board';
import { ensureChallenges, expireStaleChallenges, getActiveChallenges } from '@/lib/engines/challenge-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Challenges' };

export default async function ChallengesPage() {
  await ensureCareer();

  // Generation is idempotent and derived from the library, so it is safe to
  // reconcile on every view. Expiry is neutral bookkeeping, never a penalty.
  await ensureChallenges(USER_ID);
  await expireStaleChallenges(USER_ID);
  const challenges = await getActiveChallenges(USER_ID);

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
