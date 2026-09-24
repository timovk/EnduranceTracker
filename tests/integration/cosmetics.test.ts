/**
 * Cosmetics are earned, and a choice sticks.
 *
 * Against the real database, because both halves of this — what a pass has
 * stamped as unlocked, and what survives an XP award — are facts about rows,
 * not about functions.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDb, type Tx } from '@/lib/db/client';
import { createAccount, listAccounts } from '@/lib/auth/accounts';
import { getOrCreateCurrentPass } from '@/lib/engines/season-pass-engine';
import { awardXp, rebuildCareerTotals } from '@/lib/engines/xp-ledger';
import { getCareerView } from '@/lib/server/career';
import {
  AUTOMATIC_TITLE, DISPLAY_TITLE_KEY, NO_SELECTION, getCosmeticState, getEffectiveCosmetics, isChoosable,
} from '@/lib/server/cosmetics';
import { LAST_SEEN_VERSION_KEY, markReleaseNotesSeen, pendingReleaseNotes } from '@/lib/server/whats-new';
import { getStintEntryMode, rememberStintEntryMode } from '@/lib/server/preferences';
import { PASS_TITLES, passTitleChoice, passTitleName, levelTitleChoice } from '@/lib/domain/cosmetics';
import { LEVEL_TITLES } from '@/lib/config';
import { APP_VERSION } from '@/lib/version';

const PREFIX = 'CosmeticsTest';
// After the 0.3.1 closure: a pass can only be created once the season has
// reopened, and these tests need one to stamp their unlocks on.
const NOW = new Date(2026, 9, 23, 12);
/** Inside the 0.3.1 closure, when there is no pass at all. */
const CLOSED = new Date(2026, 8, 23, 12);

let userId: string;

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  userId = await createAccount({ name: `${PREFIX} Driver`, avatarKey: 'helmet', accentKey: 'sarthe' });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await disconnectDb();
});

/** Stamp a reward on this quarter's pass as earned, the way reaching its tier would. */
async function unlock(rewardKey: string, rewardType: 'THEME' | 'RACE_CARD' | 'BADGE' | 'BANNER' | 'TITLE') {
  const pass = await prisma.$transaction((tx) => getOrCreateCurrentPass(tx as Tx, userId, NOW));
  // Whichever tier row carries it this quarter; if the reward is not on this
  // quarter's track, borrow tier 1's row for it — only the stamp matters here.
  const row = await prisma.seasonPassProgress.findFirst({ where: { seasonPassId: pass.id, rewardKey } })
    ?? await prisma.seasonPassProgress.update({
      where: { seasonPassId_tier: { seasonPassId: pass.id, tier: 1 } },
      data: { rewardKey, rewardType, rewardName: rewardKey },
    });
  await prisma.seasonPassProgress.update({ where: { id: row.id }, data: { unlockedAt: NOW } });
}

describe('a new account', () => {
  it('has Graphite and Classic, and nothing else, unlocked', async () => {
    const state = await getCosmeticState(userId, prisma, NOW);
    expect(state.theme.options.filter((o) => o.unlocked).map((o) => o.value)).toEqual(['graphite']);
    expect(state.raceCard.options.filter((o) => o.unlocked).map((o) => o.value)).toEqual(['classic']);
    expect(state.badge.options.some((o) => o.unlocked)).toBe(false);
    expect(state.banner.options.some((o) => o.unlocked)).toBe(false);
  });

  it('shows Graphite whatever colour it picked at sign-up', async () => {
    // Strict: the sign-up colour is a card colour, not a free theme.
    const look = await getEffectiveCosmetics(userId);
    expect(look.themeKey).toBe('graphite');
    expect(look.raceCardKey).toBe('classic');
    expect(look.badgeKey).toBeNull();
    expect(look.bannerKey).toBeNull();
  });

  it('says where every locked option can be earned', async () => {
    const state = await getCosmeticState(userId, prisma, NOW);
    for (const option of [...state.theme.options, ...state.raceCard.options, ...state.badge.options]) {
      if (option.unlocked) continue;
      expect(option.source, option.value).toMatch(/season pass, tier \d+/);
    }
  });
});

describe('while the season is closed (0.3.1)', () => {
  it('points every locked option at the quarter that reopens, never at this one', async () => {
    const state = await getCosmeticState(userId, prisma, CLOSED);
    const locked = [
      ...state.theme.options, ...state.raceCard.options, ...state.badge.options,
      ...state.banner.options, ...state.title.options,
    ].filter((option) => !option.unlocked && !option.source.startsWith('Career level'));

    expect(locked.length).toBeGreaterThan(0);
    for (const option of locked) {
      expect(option.source, option.value).not.toMatch(/Q3 2026/);
      expect(option.source, option.value).not.toMatch(/This quarter/i);
      expect(option.source, option.value).toMatch(/The Q[1-4] 20\d\d season pass, tier \d+|Not in the season pass/);
    }

    // The two themes the reopening pass offers are named with their tiers.
    const sarthe = state.theme.options.find((option) => option.value === 'sarthe');
    const daytona = state.theme.options.find((option) => option.value === 'daytona');
    expect(sarthe?.source).toBe('The Q4 2026 season pass, tier 20');
    expect(daytona?.source).toBe('The Q4 2026 season pass, tier 60');
  });

  it('reads this quarter again once the season has reopened', async () => {
    await unlock('badge_greenflag', 'BADGE');
    const state = await getCosmeticState(userId, prisma, NOW);
    const sarthe = state.theme.options.find((option) => option.value === 'sarthe');
    expect(sarthe?.source).toBe("This quarter's season pass, tier 20");
  });
});

describe('earning a cosmetic', () => {
  it('makes it choosable, and shows it once chosen', async () => {
    await unlock('theme_midnight', 'THEME');
    await prisma.careerProfile.update({ where: { userId }, data: { themeKey: 'midnight' } });

    const state = await getCosmeticState(userId, prisma, NOW);
    expect(isChoosable(state, 'theme', 'midnight')).toBe(true);
    expect(state.theme.effective).toBe('midnight');
    expect((await getEffectiveCosmetics(userId)).themeKey).toBe('midnight');
  });

  it('does not show a theme that was chosen but never earned', async () => {
    await prisma.careerProfile.update({ where: { userId }, data: { themeKey: 'daytona', raceCardKey: 'hyperpole' } });
    const look = await getEffectiveCosmetics(userId);
    expect(look.themeKey).toBe('graphite');
    expect(look.raceCardKey).toBe('classic');

    const state = await getCosmeticState(userId, prisma, NOW);
    expect(isChoosable(state, 'theme', 'daytona')).toBe(false);
    expect(isChoosable(state, 'raceCard', 'hyperpole')).toBe(false);
  });

  it('shows an earned badge and banner, and lets them be cleared', async () => {
    await unlock('badge_greenflag', 'BADGE');
    await unlock('banner_paddock', 'BANNER');
    await prisma.careerProfile.update({ where: { userId }, data: { badgeKey: 'greenflag', bannerKey: 'paddock' } });

    const look = await getEffectiveCosmetics(userId);
    expect(look.badgeKey).toBe('greenflag');
    expect(look.bannerKey).toBe('paddock');

    const state = await getCosmeticState(userId, prisma, NOW);
    expect(isChoosable(state, 'badge', NO_SELECTION)).toBe(true);
    await prisma.careerProfile.update({ where: { userId }, data: { badgeKey: NO_SELECTION } });
    expect((await getEffectiveCosmetics(userId)).badgeKey).toBeNull();
  });
});

describe('the displayed title', () => {
  it('survives an XP award — which it did not, before 0.3.0', async () => {
    const reward = PASS_TITLES[0]!;
    await unlock(reward.key, 'TITLE');
    await prisma.configOverride.create({ data: { userId, key: DISPLAY_TITLE_KEY, value: passTitleChoice(reward.key) } });

    // Every award rewrites the level ladder's own title field. The chosen one
    // lives elsewhere and must come through untouched.
    await prisma.$transaction(async (tx) => {
      await awardXp(tx as Tx, userId, { source: 'MANUAL_ADJUSTMENT', amount: 50_000, description: 'test' });
      await rebuildCareerTotals(tx as Tx, userId);
    });

    expect((await getCareerView(userId)).title).toBe(passTitleName(reward));
    expect((await getEffectiveCosmetics(userId)).title).toBe(passTitleName(reward));
    const card = (await listAccounts()).find((account) => account.id === userId);
    expect(card?.titleKey).toBe(passTitleName(reward));
  });

  it('may follow the level, and may not be a title the level has not reached', async () => {
    const state = await getCosmeticState(userId, prisma, NOW);
    const out = LEVEL_TITLES.find((title) => title.level > 1)!;
    expect(isChoosable(state, 'title', AUTOMATIC_TITLE)).toBe(true);
    expect(isChoosable(state, 'title', levelTitleChoice(out.title))).toBe(false);
    expect(isChoosable(state, 'title', passTitleChoice(PASS_TITLES[0]!.key))).toBe(false);
  });
});

describe("what's new", () => {
  it('is not shown to an account created on this version', async () => {
    expect(await pendingReleaseNotes(userId)).toEqual([]);
  });

  it('is shown once to an account that came from an earlier version', async () => {
    await prisma.configOverride.delete({ where: { userId_key: { userId, key: LAST_SEEN_VERSION_KEY } } });
    expect((await pendingReleaseNotes(userId)).map((entry) => entry.version)).toEqual([APP_VERSION]);

    await markReleaseNotesSeen(userId);
    expect(await pendingReleaseNotes(userId)).toEqual([]);
  });

  it('also explains a version that was skipped, newest first', async () => {
    // Straight from 0.3.0 to this version: 0.3.1 ran on the way, so its notes
    // are owed too.
    await markReleaseNotesSeen(userId, '0.3.0');
    const versions = (await pendingReleaseNotes(userId)).map((entry) => entry.version);
    expect(versions[0]).toBe(APP_VERSION);
    expect(versions).toContain('0.3.1');
    expect(versions).not.toContain('0.3.0');

    await markReleaseNotesSeen(userId);
    expect(await pendingReleaseNotes(userId)).toEqual([]);
  });
});

describe('the way a stint is entered', () => {
  it('starts on timestamps and remembers the last choice', async () => {
    expect(await getStintEntryMode(userId)).toBe('RANGE');
    await rememberStintEntryMode(userId, 'REMAINING');
    expect(await getStintEntryMode(userId)).toBe('REMAINING');
  });
});
