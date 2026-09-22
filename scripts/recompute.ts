/**
 * Rebuild every derived figure from the sources of truth.
 *
 * The cached counters on `Race`, the career XP total, mastery progress,
 * achievement progress and collection state are all DERIVED. This script
 * rebuilds all of them from `WatchedInterval`, `RaceViewingSession` and the
 * XP ledger — which is the safety net if a cache ever drifts, and the way a
 * configuration re-balance is applied to an existing career.
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

import type { Tx } from '@/lib/db/client';
import { disconnectDb, prisma } from '@/lib/db/client';
import { recomputeAllRaces } from '@/lib/engines/race-engine';
import { repairXpLedger } from '@/lib/engines/session-engine';
import { computeCareerMetrics } from '@/lib/engines/metrics';
import { syncAchievements, syncMilestones } from '@/lib/engines/achievement-engine';
import { ensureMasteryTrees, recomputeRaceMasteries, syncMastery } from '@/lib/engines/mastery-engine';
import { ensureSeasonCollections, syncCollections } from '@/lib/engines/collection-engine';

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

async function rebuild(account: Account): Promise<void> {
  const userId = account.id;

  const races = await recomputeAllRaces(userId);
  console.log(`  races rebuilt from intervals and sessions   ${races}`);

  // Repairs before it rebuilds: XP left behind by a deleted stint, and Story
  // Complete bonuses held by races that are no longer complete, both inflate
  // the total and neither can be corrected by summing what is there.
  const xp = await repairXpLedger(userId);
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

  // The remaining engines are idempotent, so simply running them re-derives
  // everything they own without awarding anything twice — the unique dedupe
  // keys on the XP ledger are what guarantee that.
  await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    await ensureMasteryTrees(db, userId);
    await ensureSeasonCollections(db, userId);
    await recomputeRaceMasteries(db, userId);
    const collections = await syncCollections(db, userId);
    const mastery = await syncMastery(db, userId);
    const metrics = await computeCareerMetrics(userId, db);
    const achievements = await syncAchievements(db, userId, metrics);
    const milestones = await syncMilestones(db, userId, metrics);

    console.log(`  collections reconciled                      ${collections.filledItems.length} cards filled`);
    console.log(`  mastery nodes newly unlocked                ${mastery.length}`);
    console.log(`  achievements newly unlocked                 ${achievements.length}`);
    console.log(`  milestones newly reached                    ${milestones.length}`);
  }, { maxWait: 15_000, timeout: 120_000 });

  const summary = await prisma.race.aggregate({
    where: { userId },
    _sum: { coverageSec: true, realViewingSec: true },
    _count: true,
  });

  console.log('\n  Current totals');
  console.log(`    races               ${summary._count}`);
  console.log(`    unique coverage     ${((summary._sum.coverageSec ?? 0) / 3600).toFixed(1)}h`);
  console.log(`    real viewing time   ${((summary._sum.realViewingSec ?? 0) / 3600).toFixed(1)}h`);
}

async function main(): Promise<void> {
  const started = Date.now();
  const accounts = await resolveAccounts(process.argv[2]);

  if (accounts.length === 0) {
    console.log('There are no accounts yet, so there is nothing to rebuild.');
    return;
  }

  console.log(`Rebuilding derived state for ${accounts.length} account${accounts.length === 1 ? '' : 's'}…`);

  for (const account of accounts) {
    console.log(`\n${account.name}`);
    await rebuild(account);
  }

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
