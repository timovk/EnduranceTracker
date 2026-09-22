/**
 * Account bootstrap.
 *
 * Every account owns exactly one CareerProfile. Everything else — the budget
 * year, the season pass, the mastery trees, the collections — is created
 * lazily the first time it is needed, so an account is usable the moment it
 * is made.
 *
 * Accounts themselves are created in exactly one place, `createAccount` in
 * src/lib/auth/accounts.ts. That is deliberate: the display name is unique,
 * and a second route into `user.create` is a second route into a duplicate.
 */

import type { Tx } from '@/lib/db/client';
import { prisma } from '@/lib/db/client';
import { BUDGET_CONFIG, CHAMPIONSHIP_PRESETS } from '@/lib/config';

export interface BootstrapResult {
  userId: string;
  created: boolean;
}

/**
 * Ensure an account's career exists. Idempotent, and cheap enough to call on
 * any page.
 *
 * The account itself must already exist: the caller's id comes from a signed-in
 * session, so an id with no row behind it is a bug worth hearing about rather
 * than a cue to invent an account.
 */
export async function ensureCareer(userId: string, db: Tx = prisma): Promise<BootstrapResult> {
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, careerProfile: { select: { id: true } } },
  });

  if (existing === null) {
    throw new Error(`No account with id ${userId}. Accounts are created through createAccount().`);
  }
  if (existing.careerProfile) return { userId: existing.id, created: false };

  await db.careerProfile.create({ data: { userId } });
  await ensureBudgetYearRow(userId, new Date().getFullYear(), db);
  return { userId, created: true };
}

/**
 * Create the current year's budget if it is missing.
 *
 * Each year keeps its own annual figure, so changing the budget later never
 * rewrites history.
 */
export async function ensureBudgetYearRow(userId: string, year: number, db: Tx = prisma) {
  return db.budgetYear.upsert({
    where: { userId_year: { userId, year } },
    update: {},
    create: {
      userId,
      year,
      annualBudgetHours: BUDGET_CONFIG.annualHours,
      weeklyTargetHours: BUDGET_CONFIG.weeklyTargetHours,
    },
  });
}

/**
 * Seed the championship presets.
 *
 * A convenience only. Races are always added manually and no calendar is ever
 * imported; the user can delete any of these or create their own, and a custom
 * championship behaves identically in every system including mastery.
 */
export async function ensureChampionshipPresets(userId: string, db: Tx = prisma): Promise<number> {
  let created = 0;
  for (const preset of CHAMPIONSHIP_PRESETS) {
    const result = await db.championship.upsert({
      where: { userId_slug: { userId, slug: preset.slug } },
      update: {},
      create: {
        userId,
        slug: preset.slug,
        name: preset.name,
        shortName: preset.shortName,
        accentColor: preset.accentColor,
        sortOrder: preset.sortOrder,
        isCustom: false,
      },
      select: { createdAt: true, updatedAt: true },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created += 1;
  }
  return created;
}

/** Slugify a championship name into a stable, unique-per-user key. */
export function championshipSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'championship';
}
