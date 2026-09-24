/**
 * Races still to come (0.3.2), through a real database.
 *
 * A race dated after today is not suggested — on the planner or on the
 * dashboard — until its race day, unless a stint has already been logged on
 * it. The race dates are stored exactly as the add-race form stores them, by
 * running the typed date through the form's own schema. `now` is injected.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma, disconnectDb } from '@/lib/db/client';
import { getRecommendations, getStrategist } from '@/lib/engines/strategist-engine';
import { logViewingSession } from '@/lib/engines/session-engine';
import { getDashboard } from '@/lib/server/dashboard';
import { raceInputSchema } from '@/lib/validation/schemas';

const H = 3600;
const USER = '00000000-0000-4000-8000-0000000003b2';

/** An evening on 24 September 2026, local time. */
const TODAY = new Date(2026, 8, 24, 20);

async function addRace(name: string, raceDate: string | null, runtimeHours = 6): Promise<string> {
  const input = raceInputSchema.parse({
    name, raceDate: raceDate ?? '', scheduledDuration: `${String(runtimeHours).padStart(2, '0')}:00:00`,
  });
  const race = await prisma.race.create({
    data: {
      userId: USER, name: input.name, raceDate: input.raceDate,
      scheduledDurationSec: input.scheduledDuration, runtimeSec: input.scheduledDuration, raceType: 'H6',
    },
    select: { id: true },
  });
  return race.id;
}

function stint(raceId: string, hours: number) {
  return {
    raceId, mode: 'RANGE' as const, startTimestamp: 0, endTimestamp: hours * H,
    playbackSpeed: 1, watchedAt: null, note: undefined,
  };
}

const idsOf = (recs: { raceId: string }[]): string[] => recs.map((rec) => rec.raceId);

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, name: 'Still To Come', careerProfile: { create: {} } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await disconnectDb();
});

describe('the strategist and races still to come', () => {
  it('leaves out a race dated after today, and says how many and from when', async () => {
    const past = await addRace('6 Hours of Fuji', '2026-09-13');
    const undated = await addRace('Petit Le Mans replay', null);
    const future = await addRace('8 Hours of Bahrain', '2026-11-07', 8);
    const later = await addRace('24 Hours of Le Mans', '2027-06-12', 24);

    const view = await getStrategist(USER, { now: TODAY });
    expect(idsOf(view.recommendations)).toEqual(expect.arrayContaining([past, undated]));
    expect(idsOf(view.recommendations)).not.toContain(future);
    expect(idsOf(view.recommendations)).not.toContain(later);
    expect(view.stillToCome).toEqual({ count: 2, nextRaceDay: new Date(2026, 10, 7) });

    // The plain list the rest of the application reads agrees.
    expect(idsOf(await getRecommendations(USER, { now: TODAY }))).toEqual(idsOf(view.recommendations));
  });

  it('suggests nothing, rather than a race that has not been run, when that is all there is', async () => {
    await addRace('8 Hours of Bahrain', '2026-11-07', 8);
    const view = await getStrategist(USER, { now: TODAY });
    expect(view.recommendations).toEqual([]);
    expect(view.stillToCome.count).toBe(1);
  });

  it('suggests the race from its race day on', async () => {
    const future = await addRace('8 Hours of Bahrain', '2026-11-07', 8);

    const eveBefore = await getStrategist(USER, { now: new Date(2026, 10, 6, 23, 59) });
    expect(idsOf(eveBefore.recommendations)).not.toContain(future);

    const raceDay = await getStrategist(USER, { now: new Date(2026, 10, 7, 0, 1) });
    expect(idsOf(raceDay.recommendations)).toContain(future);
    expect(raceDay.stillToCome).toEqual({ count: 0, nextRaceDay: null });
  });

  it('keeps a race it has seen a stint of, whatever its date', async () => {
    const early = await addRace('12 Hours of Bathurst', '2026-09-25', 12);
    await logViewingSession(USER, stint(early, 2), TODAY);

    const view = await getStrategist(USER, { now: TODAY });
    const continuing = view.recommendations.find((rec) => rec.kind === 'CONTINUE');
    expect(continuing?.raceId).toBe(early);
    expect(view.stillToCome.count).toBe(0);
  });

  it('gives the dashboard the same answer as the planner', async () => {
    const past = await addRace('6 Hours of Fuji', '2026-09-13');
    const future = await addRace('8 Hours of Bahrain', '2026-11-07', 8);

    const dashboard = await getDashboard(USER, TODAY);
    expect(idsOf(dashboard.recommendations)).toContain(past);
    expect(idsOf(dashboard.recommendations)).not.toContain(future);
    expect(dashboard.stillToCome).toEqual({ count: 1, nextRaceDay: new Date(2026, 10, 7) });
  });
});
