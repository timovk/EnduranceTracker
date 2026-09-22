/**
 * Installation bootstrap.
 *
 * This is a single-user application, so there is exactly one User and one
 * CareerProfile. Everything else — the budget year, the season pass, the
 * mastery trees, the collections — is created lazily the first time it is
 * needed, so the application is usable the moment it starts.
 */

import type { Tx } from '@/lib/db/client';
import { prisma, USER_ID } from '@/lib/db/client';
import { BUDGET_CONFIG, CHAMPIONSHIP_PRESETS } from '@/lib/config';

export interface BootstrapResult {
  userId: string;
  created: boolean;
}

/**
 * Ensure the career exists. Idempotent, and cheap enough to call on any page.
 */
export async function ensureCareer(db: Tx = prisma): Promise<BootstrapResult> {
  const existing = await db.user.findUnique({
    where: { id: USER_ID },
    select: { id: true, careerProfile: { select: { id: true } } },
  });

  if (existing?.careerProfile) return { userId: existing.id, created: false };

  if (!existing) {
    await db.user.create({
      data: {
        id: USER_ID,
        name: 'Driver',
        careerProfile: { create: {} },
      },
    });
  } else {
    await db.careerProfile.create({ data: { userId: USER_ID } });
  }

  await ensureBudgetYearRow(USER_ID, new Date().getFullYear(), db);
  return { userId: USER_ID, created: true };
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
