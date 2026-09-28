/**
 * The race page, drawn the way the server draws it (0.4.0 review fixes).
 *
 *   - Its completion figures round down, as every coverage figure does: a
 *     Story Complete race with 30 seconds still to watch reads 99.9%, never
 *     100%, beside the Expedition panel that says 99.9% too.
 *   - What an Expedition Mode switch did is said in the page's own notice.
 *     The switch sits in the header for a race that is not an Expedition and
 *     in the Expedition panel for one that is, so each switch moves it and
 *     React mounts a new control: a message kept inside the control was gone
 *     by the time the page had refreshed.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const signedIn = vi.hoisted(() => ({ userId: '00000000-0000-4000-8000-0000000009e1' }));
/** Every Expedition Mode control the page drew, with the props it was given. */
const controls = vi.hoisted(() => [] as { isExpedition: boolean; onMessage?: unknown }[]);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session', () => ({
  SESSION_COOKIE: 'endurance_session',
  requireUserId: async () => signedIn.userId,
  getSessionUserId: async () => signedIn.userId,
  getSessionUser: async () => null,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
// No app router here: the page only asks it to refresh or to go elsewhere.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => '/races',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/expeditions/expedition-mode-control', () => ({
  ExpeditionModeControl: (props: { isExpedition: boolean; onMessage?: unknown }) => {
    controls.push(props);
    return null;
  },
}));

import { CollectionGrid } from '@/components/dashboard/collection-grid';
import { RaceDetailView } from '@/components/races/race-detail-view';
import { TWENTY_FOUR_HOUR_CONFIG } from '@/lib/config';
import { disconnectDb, prisma } from '@/lib/db/client';
import { getCollections } from '@/lib/engines/collection-engine';
import { getRaceDetail } from '@/lib/server/races';
import { addRace, createCareerUser, H, logStint } from '../helpers/career-db';

const USER = signedIn.userId;

beforeEach(async () => {
  controls.length = 0;
  await createCareerUser(USER, 'RacePageTest');
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

async function page(raceId: string): Promise<string> {
  const race = await getRaceDetail(USER, raceId);
  if (race === null) throw new Error('the race is not in the library');
  return renderToStaticMarkup(createElement(RaceDetailView, {
    race, longHaulThresholdSec: TWENTY_FOUR_HOUR_CONFIG.longHaulThresholdSec,
  }));
}

/** The page's words, one `|` between elements. */
function words(html: string): string {
  return html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
}

describe('the race page', () => {
  it('never reads 100% while 30 seconds of a Story Complete race are still to watch', async () => {
    const lemans = await addRace(USER, { name: '24 Hours of Le Mans', hours: 24 });
    await logStint(USER, lemans, { from: 0, to: 24 * H - 30, now: new Date(2026, 5, 15, 21) });
    const race = await getRaceDetail(USER, lemans);
    expect(race).toMatchObject({ storyComplete: true, coverageSec: 24 * H - 30, timelineRemainingSec: 30 });
    expect(race!.coveragePercent).toBe(99.9);

    const html = await page(lemans);
    const text = words(html);
    expect(text).toContain('|Complete|99.9%|');
    // The 24-hour clock: its label and what it says to a screen reader.
    expect(html).toContain('aria-label="99.9% of the race watched"');
    expect(text).toContain('|99.9%|23h 59m watched|');
    // The Expedition panel on the same page agrees.
    expect(text).toContain('|99.9%| of the story watched');
    expect(text).not.toContain('100%');
    expect(text).not.toContain('100.0%');
  });

  it('its season\'s collection card agrees: 99%, not 100%', async () => {
    const championship = await prisma.championship.create({
      data: { userId: USER, name: 'World Endurance', slug: 'race-page-wec' }, select: { id: true },
    });
    const season = await prisma.championshipSeason.create({
      data: { championshipId: championship.id, year: 2026, plannedRaceCount: 2 }, select: { id: true },
    });
    const lemans = await addRace(USER, { name: '24 Hours of Le Mans', hours: 24, championshipId: championship.id, seasonId: season.id });
    await logStint(USER, lemans, { from: 0, to: 24 * H - 30, now: new Date(2026, 5, 15, 21) });

    const collections = (await getCollections(USER)).filter((collection) => collection.cards.some((card) => card.raceId === lemans));
    expect(collections).toHaveLength(1);
    expect(collections[0]!.cards.find((card) => card.raceId === lemans)!.coveragePercent).toBe(99.9);
    const text = words(renderToStaticMarkup(createElement(CollectionGrid, { collections })));
    expect(text).toContain('|99%|24h 00m|');
    expect(text).not.toContain('|100%|');
  });

  it('says 100% once every second is watched', async () => {
    const lemans = await addRace(USER, { name: '24 Hours of Le Mans', hours: 24 });
    await logStint(USER, lemans, { from: 0, to: 24 * H, now: new Date(2026, 5, 15, 21) });
    const html = await page(lemans);
    expect(words(html)).toContain('|Complete|100%|');
    expect(html).toContain('aria-label="100% of the race watched"');
  });

  it('hands what an Expedition Mode switch did to the page, wherever the switch is drawn', async () => {
    // Not an Expedition: the switch is in the header line.
    const fuji = await addRace(USER, { name: '6 Hours of Fuji', hours: 6 });
    await logStint(USER, fuji, { from: 0, to: 2 * H, now: new Date(2026, 5, 15, 21) });
    await page(fuji);
    // An Expedition by its length: the switch is in the Expedition panel.
    const lemans = await addRace(USER, { name: '24 Hours of Le Mans', hours: 24 });
    await page(lemans);

    expect(controls.map((control) => control.isExpedition)).toEqual([false, true]);
    // Both give the message to the page, which keeps it through the switch's
    // move (a control that kept it itself lost it when it was mounted anew).
    for (const control of controls) expect(typeof control.onMessage).toBe('function');
  });
});
