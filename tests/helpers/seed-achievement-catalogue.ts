/**
 * Write the achievement catalogue into the test database.
 *
 * Run by `tests/setup.ts` in a child process (`node --import tsx`), once, when
 * the database a test file is about to use lacks any definition from
 * `config/achievements.ts` — in practice, the first file on a brand-new test
 * database. It is the application's own `syncAchievementDefinitions`, so the
 * rows are exactly what the Achievements page and `db:seed` write.
 *
 * Why a child process: the catalogue is global, and `syncAchievements` skips
 * every achievement whose definition row is missing, so on an empty catalogue
 * nothing can unlock and every "never unlocked twice" check passes with
 * nothing to check. Seeding inside the test process would create the shared
 * Prisma client before the test file runs (which `pointPrismaAtFixture`
 * refuses) and would cache engine modules before a test file's `vi.mock`
 * could replace them.
 */

import { disconnectDb } from '@/lib/db/client';
import { syncAchievementDefinitions } from '@/lib/engines/achievement-engine';

syncAchievementDefinitions()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
