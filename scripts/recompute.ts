/**
 * Rebuild every derived figure from the sources of truth.
 *
 * The cached counters on `Race`, the career XP total, mastery progress,
 * achievement progress and collection state are all DERIVED. This script
 * rebuilds all of them from `WatchedInterval`, `RaceViewingSession` and the
 * XP ledger — which is the safety net if a cache ever drifts, and the way a
 * configuration re-balance is applied to an existing career.
 *
 *     npm run db:recompute
 */

// Next.js loads .env by itself; a script run through tsx does not, and the
// Prisma client is lazy, so this only has to happen before the first query.
import 'dotenv/config';

import type { Tx } from '@/lib/db/client';
import { disconnectDb, prisma, USER_ID } from '@/lib/db/client';
import { recomputeAllRaces } from '@/lib/engines/race-engine';
import { recalculateCareerXp } from '@/lib/engines/xp-ledger';
import { computeCareerMetrics } from '@/lib/engines/metrics';
import { syncAchievements, syncMilestones } from '@/lib/engines/achievement-engine';
import { ensureMasteryTrees, recomputeRaceMasteries, syncMastery } from '@/lib/engines/mastery-engine';
import { ensureSeasonCollections, syncCollections } from '@/lib/engines/collection-engine';

async function main(): Promise<void> {
  const started = Date.now();
  console.log('Rebuilding derived state…\n');

  const races = await recomputeAllRaces(USER_ID);
  console.log(`  races rebuilt from intervals and sessions   ${races}`);

  const xp = await recalculateCareerXp(USER_ID);
  console.log(`  career XP rebuilt from the ledger           ${xp.before} -> ${xp.after}`);
  if (xp.before !== xp.after) {
    console.log('    (the ledger is authoritative; the running total has been corrected)');
  }

  // The remaining engines are idempotent, so simply running them re-derives
  // everything they own without awarding anything twice — the unique dedupe
  // keys on the XP ledger are what guarantee that.
  await prisma.$transaction(async (tx) => {
    const db = tx as Tx;
    await ensureMasteryTrees(db, USER_ID);
    await ensureSeasonCollections(db, USER_ID);
    await recomputeRaceMasteries(db, USER_ID);
    const collections = await syncCollections(db, USER_ID);
    const mastery = await syncMastery(db, USER_ID);
    const metrics = await computeCareerMetrics(USER_ID, db);
    const achievements = await syncAchievements(db, USER_ID, metrics);
    const milestones = await syncMilestones(db, USER_ID, metrics);

    console.log(`  collections reconciled                      ${collections.filledItems.length} cards filled`);
    console.log(`  mastery nodes newly unlocked                ${mastery.length}`);
    console.log(`  achievements newly unlocked                 ${achievements.length}`);
    console.log(`  milestones newly reached                    ${milestones.length}`);
  }, { maxWait: 15_000, timeout: 120_000 });

  const summary = await prisma.race.aggregate({
    where: { userId: USER_ID },
    _sum: { coverageSec: true, realViewingSec: true },
    _count: true,
  });

  console.log('\nCurrent totals');
  console.log(`  races                 ${summary._count}`);
  console.log(`  unique coverage       ${((summary._sum.coverageSec ?? 0) / 3600).toFixed(1)}h`);
  console.log(`  real viewing time     ${((summary._sum.realViewingSec ?? 0) / 3600).toFixed(1)}h`);
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
