/**
 * Rebuild every derived figure from the sources of truth.
 *
 * The cached counters on `Race`, the merged coverage, the career XP total,
 * mastery progress, achievement progress and collection state are all
 * DERIVED. This script rebuilds all of them from `RaceViewingSession`, the
 * races and the XP ledger — which is the safety net if a cache ever drifts,
 * and the way a configuration re-balance is applied to an existing career.
 * The work itself is `recomputeCareer` (`src/lib/server/recompute.ts`); this
 * is its command line.
 *
 *     npm run db:recompute                 every account on this machine
 *     npm run db:recompute -- Alex         one account, by name or by id
 *
 * There is no signed-in session here, so the account cannot be inferred. Every
 * account is the default because a re-balance applies to all of them, and
 * rebuilding a career that was already correct is a no-op.
 */

// Next.js loads .env by itself; a script run through tsx does not, and the
// Prisma client is lazy, so this only has to happen before the first query.
import 'dotenv/config';

import { disconnectDb, prisma } from '@/lib/db/client';
import { recomputeCareer } from '@/lib/server/recompute';

interface Account {
  id: string;
  name: string;
}

/** The accounts to rebuild: the one that was asked for, or all of them. */
async function resolveAccounts(target: string | undefined): Promise<Account[]> {
  if (target === undefined) {
    return prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  const match = await prisma.user.findFirst({
    where: { OR: [{ id: target }, { name: target }] },
    select: { id: true, name: true },
  });
  if (match === null) throw new Error(`There is no account called "${target}".`);
  return [match];
}

async function rebuild(account: Account, now: Date): Promise<void> {
  const report = await recomputeCareer(account.id, { now });

  console.log(`  races rebuilt from intervals and sessions   ${report.racesRebuilt}`);
  if (report.storyBonusesAwarded > 0) {
    console.log(`    paid ${report.storyBonusesAwarded} Story Complete bonus(es) a runtime edit had skipped`);
  }
  if (report.storyBonusesRevoked > 0) {
    console.log(`    released ${report.storyBonusesRevoked} Story Complete bonus(es) the coverage no longer supports`);
  }

  const xp = report.ledger;
  console.log(`  career XP rebuilt from the ledger           ${xp.careerXpBefore} -> ${xp.careerXpAfter}`);
  if (xp.orphanedTransactions > 0) {
    console.log(`    removed ${xp.orphanedTransactions} award(s) whose stint had been deleted`);
  }
  if (xp.staleStoryBonuses > 0) {
    console.log(`    released ${xp.staleStoryBonuses} Story Complete bonus(es) — those races can earn it again`);
  }
  if (xp.levelAfter !== xp.levelBefore) {
    console.log(`    level ${xp.levelBefore} -> ${xp.levelAfter}`);
  }

  console.log(`  collections reconciled                      ${report.collectionCardsFilled} cards filled`);
  console.log(`  mastery nodes newly unlocked                ${report.masteryNodesUnlocked}`);
  console.log(`  achievements newly unlocked                 ${report.achievementsUnlocked}`);
  console.log(`  milestones newly reached                    ${report.milestonesReached}`);

  console.log('\n  Current totals');
  console.log(`    races               ${report.totals.races}`);
  console.log(`    unique coverage     ${(report.totals.coverageSec / 3600).toFixed(1)}h`);
  console.log(`    real viewing time   ${(report.totals.creditedViewingSec / 3600).toFixed(1)}h`);
}

async function main(): Promise<void> {
  const started = Date.now();
  const accounts = await resolveAccounts(process.argv[2]);

  if (accounts.length === 0) {
    console.log('There are no accounts yet, so there is nothing to rebuild.');
    return;
  }

  console.log(`Rebuilding derived state for ${accounts.length} account${accounts.length === 1 ? '' : 's'}…`);

  const now = new Date();
  for (const account of accounts) {
    console.log(`\n${account.name}`);
    await rebuild(account, now);
  }

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
