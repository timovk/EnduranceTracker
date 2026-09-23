import { PageHeader } from '@/components/layout/page-header';
import { ChallengeBoard } from '@/components/dashboard/challenge-board';
import { ensureChallenges, expireStaleChallenges, getActiveChallenges } from '@/lib/engines/challenge-engine';
import { seasonPassClosure } from '@/lib/engines/season-pass-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Challenges' };

export default async function ChallengesPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);

  // One instant for the whole page, so the board and the seasonal note can
  // never disagree about which side of the season's reopening it is.
  const now = new Date();

  // Generation is idempotent and derived from the library, so it is safe to
  // reconcile on every view. Expiry is neutral bookkeeping, never a penalty.
  await ensureChallenges(userId, now);
  await expireStaleChallenges(userId, now);
  const challenges = await getActiveChallenges(userId, now);
  // Seasonal challenges close with the season pass (0.3.1) and return with it.
  const closure = seasonPassClosure(now);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Optional"
        title="Challenges"
        description="Generated from the races you actually have, so nothing here is impossible. Every one of them is optional — letting a window close costs nothing at all."
      />
      <ChallengeBoard
        challenges={challenges}
        seasonalClosure={closure ? { label: closure.label, reopensAt: closure.reopensAt } : null}
      />
    </div>
  );
}
