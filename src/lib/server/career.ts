/**
 * Career profile reads.
 *
 * Assembles the header of the dashboard and the career page: level, prestige,
 * title, momentum, streaks and the XP ledger. Read-only.
 */

import { prisma } from '@/lib/db/client';
import {
  levelFromXp, nextTitleAfter, prestigeForLevel, prestigeLabel,
  titleForLevel, totalXpForLevel, xpForNextLevel,
} from '@/lib/domain/progression';
import { PRESTIGE_CONFIG } from '@/lib/config';
import type { XPSource } from '@/lib/domain/types';

export interface CareerView {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  progress: number;
  careerXp: number;
  nextLevelXp: number;

  prestige: number;
  prestigeLabel: string;
  nextPrestigeLevel: number | null;
  nextPrestigeLabel: string | null;

  title: string;
  nextTitle: { level: number; title: string } | null;

  themeKey: string;
  raceCardKey: string;

  currentStreakDays: number;
  longestStreakDays: number;
  lifetimeActiveDays: number;
  lifetimeActiveWeeks: number;
  lastActiveDate: Date | null;
  daysSinceLastActive: number;

  momentumPoints: number;
  momentumTierKey: string;
}

export async function getCareerView(userId: string, now: Date = new Date()): Promise<CareerView> {
  const profile = await prisma.careerProfile.findUniqueOrThrow({ where: { userId } });
  const careerXp = Number(profile.careerXp);
  const state = levelFromXp(careerXp);
  const prestige = prestigeForLevel(state.level);
  const title = titleForLevel(state.level);

  const nextPrestigeLevel = nextPrestigeThreshold(state.level);

  return {
    level: state.level,
    xpIntoLevel: state.xpIntoLevel,
    xpForLevel: state.xpForLevel,
    progress: state.progress,
    careerXp,
    nextLevelXp: state.nextLevelXp,

    prestige,
    prestigeLabel: prestigeLabel(prestige),
    nextPrestigeLevel,
    nextPrestigeLabel: nextPrestigeLevel === null ? null : prestigeLabel(prestige + 1),

    title: title.title,
    nextTitle: nextTitleAfter(state.level),

    themeKey: profile.themeKey,
    raceCardKey: profile.raceCardKey,

    currentStreakDays: profile.currentStreakDays,
    longestStreakDays: profile.longestStreakDays,
    lifetimeActiveDays: profile.lifetimeActiveDays,
    lifetimeActiveWeeks: profile.lifetimeActiveWeeks,
    lastActiveDate: profile.lastActiveDate,
    daysSinceLastActive: profile.lastActiveDate
      ? Math.floor((now.getTime() - profile.lastActiveDate.getTime()) / 86_400_000)
      : 0,

    momentumPoints: profile.momentumPoints,
    momentumTierKey: profile.momentumTierKey,
  };
}

/** The career level at which the next prestige rank would arrive. */
function nextPrestigeThreshold(level: number): number | null {
  const { thresholds, repeatEveryLevels } = PRESTIGE_CONFIG;
  const next = thresholds.find((threshold) => threshold > level);
  if (next !== undefined) return next;
  const last = thresholds[thresholds.length - 1] ?? 0;
  if (repeatEveryLevels <= 0) return null;
  const steps = Math.floor((level - last) / repeatEveryLevels) + 1;
  return last + steps * repeatEveryLevels;
}

export interface XpLedgerRow {
  id: string;
  source: XPSource;
  amount: number;
  seasonAmount: number;
  description: string;
  careerXpAfter: number;
  levelAfter: number;
  createdAt: Date;
}

export async function getXpLedger(userId: string, limit = 60): Promise<XpLedgerRow[]> {
  const rows = await prisma.xPTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, source: true, amount: true, seasonAmount: true,
      description: true, careerXpAfter: true, levelAfter: true, createdAt: true,
    },
  });

  // BigInt does not survive the server/client boundary, so it is narrowed here.
  return rows.map((row) => ({ ...row, careerXpAfter: Number(row.careerXpAfter) }));
}

/**
 * The level ladder around the current level, for the career page.
 *
 * There is no maximum level, so this is always a window rather than a full
 * list: a few behind for context, a good stretch ahead to aim at.
 */
export function levelLadder(level: number, behind = 2, ahead = 8) {
  const from = Math.max(1, level - behind);
  return Array.from({ length: behind + ahead + 1 }, (_, i) => {
    const entry = from + i;
    return {
      level: entry,
      totalXp: totalXpForLevel(entry),
      costFromPrevious: entry === 1 ? 0 : xpForNextLevel(entry - 1),
      title: titleForLevel(entry).title,
      isTitleThreshold: titleForLevel(entry).level === entry,
      prestige: prestigeForLevel(entry),
      isPrestigeThreshold: prestigeForLevel(entry) > prestigeForLevel(entry - 1),
      isCurrent: entry === level,
    };
  });
}
