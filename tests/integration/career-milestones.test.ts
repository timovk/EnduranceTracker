/**
 * Career Milestones (0.4.0): the permanent moments of a career, and when each
 * happened.
 *
 * Reaching and dating are two steps. `syncCareerMilestones` writes and pays
 * the new rungs once, from the same rounded figures the ladders use;
 * `fillLandmarkDates` then finds in the replay the moment each undated
 * landmark actually happened and writes it, once. Deleting or editing stints
 * afterwards changes statistics and never a milestone or its date.
 *
 * Most of this file follows one career logged through the real engine: seven
 * 48-hour races in March 2025, one every 49 hours so that no stint's window is
 * cut by the one before it, and eight more in March 2026. Its hours cross 100
 * inside the third stint, 250 inside the sixth, and a full year's plan at the
 * very end of the seventh stint of each year.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUDGET_CONFIG, CAREER_MILESTONES_BY_ID, careerMilestoneTitle } from '@/lib/config';
import { disconnectDb, prisma, type Tx } from '@/lib/db/client';
import type { TimelineRaceRow, TimelineSessionRow } from '@/lib/domain/career-timeline';
import {
  fillLandmarkDates, getCareerMilestonesView, listRecentCareerMilestones, syncCareerMilestones,
} from '@/lib/engines/career-milestone-engine';
import { loadTimelineInputs } from '@/lib/engines/career-timeline-engine';
import type { SessionOutcome } from '@/lib/engines/contracts';
import { computeCareerMetrics, emptyMetrics } from '@/lib/engines/metrics';
import { resyncAfterRaceEdit } from '@/lib/engines/progression-resync';
import { rebuildRaceIntervals, recomputeRaceAggregates } from '@/lib/engines/race-engine';
import { deleteRace, deleteViewingSession } from '@/lib/engines/session-engine';
import { awardXp } from '@/lib/engines/xp-ledger';
import { getDashboard } from '@/lib/server/dashboard';
import { buildOutcomeForSession } from '@/lib/server/session-summary';
import { addRace, createCareerUser, H, ledgerProblems, logStint } from '../helpers/career-db';
import { race as raceRow, stint as stintRow } from '../helpers/timeline-fixture';

const HOURS = '00000000-0000-4000-8000-0000000004a1';
const FRESH = '00000000-0000-4000-8000-0000000004a2';
const NEIGHBOURS = '00000000-0000-4000-8000-0000000004a3';
const DIRECT = '00000000-0000-4000-8000-0000000004a4';
const RETUNED = '00000000-0000-4000-8000-0000000004a5';
const EDITED = '00000000-0000-4000-8000-0000000004a6';
const RECOGNISED = '00000000-0000-4000-8000-0000000004a7';
const CELEBRATED = '00000000-0000-4000-8000-0000000004a8';
const EVENT_STEP = '00000000-0000-4000-8000-0000000004a9';
const USERS = [HOURS, FRESH, NEIGHBOURS, DIRECT, RETUNED, EDITED, RECOGNISED, CELEBRATED, EVENT_STEP];

const MINUTE = 60_000;
const ANNUAL = BUDGET_CONFIG.annualHours;
const LONG = 48;

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  await disconnectDb();
});

/** Every milestone row an account holds, in a stable order. */
function milestoneRows(userId: string) {
  return prisma.milestoneProgress.findMany({
    where: { userId },
    orderBy: [{ metric: 'asc' }, { threshold: 'asc' }],
  });
}

function row(userId: string, metric: string, threshold: number) {
  return prisma.milestoneProgress.findUnique({ where: { userId_metric_threshold: { userId, metric, threshold } } });
}

function ledgerRows(userId: string, dedupeKey: string) {
  return prisma.xPTransaction.findMany({ where: { userId, dedupeKey } });
}

describe('a career watched through the engine', () => {
  const first2025 = new Date(2025, 2, 1, 8, 0);
  const first2026 = new Date(2026, 2, 1, 8, 0);
  const stints: { raceId: string; watchedAt: Date; outcome: SessionOutcome }[] = [];

  /** The n-th stint of the career, counting from 1. */
  const nth = (n: number) => stints[n - 1]!;

  beforeAll(async () => {
    await createCareerUser(HOURS, 'CareerMilestonesTest');
    const plan = [
      ...Array.from({ length: 7 }, (_, index) => new Date(first2025.getTime() + index * 49 * H * 1000)),
      ...Array.from({ length: 8 }, (_, index) => new Date(first2026.getTime() + index * 49 * H * 1000)),
    ];
    for (const [index, watchedAt] of plan.entries()) {
      const raceId = await addRace(HOURS, { name: `Race ${index + 1}`, hours: LONG });
      const outcome = await logStint(HOURS, raceId, { from: 0, to: LONG * H, watchedAt, now: watchedAt });
      stints.push({ raceId, watchedAt, outcome });
    }
  }, 120_000);

  it('crossing 250 hours creates the row and pays 1,000 once', async () => {
    const title = CAREER_MILESTONES_BY_ID.get('hours-250')!.title;
    // 240 hours after the fifth stint, 288 after the sixth.
    expect(nth(5).outcome.careerMilestones.map((milestone) => milestone.id)).not.toContain('hours-250');
    expect(nth(6).outcome.careerMilestones.find((milestone) => milestone.id === 'hours-250'))
      .toMatchObject({ title, metric: 'realHours', threshold: 250, xpAwarded: 1_000, precision: 'INTERPOLATED' });
    expect(nth(6).outcome.xpBreakdown).toContainEqual({ label: `Career milestone — ${title}`, amount: 1_000 });
    for (const later of stints.slice(6)) {
      expect(later.outcome.xpBreakdown.map((line) => line.label)).not.toContain(`Career milestone — ${title}`);
    }

    expect((await row(HOURS, 'realHours', 250))?.xpAwarded).toBe(1_000);
    const paid = await ledgerRows(HOURS, 'milestone:realHours:250');
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ source: 'MILESTONE', amount: 1_000, seasonAmount: 0, sessionId: null });
    expect(await ledgerProblems(HOURS)).toEqual([]);
  });

  it('achievedAt equals the interpolated instant to the second', async () => {
    // Each window is the whole 48 hours before its stint was logged. 250 hours
    // are recognised at 249.95 (as the rounded ladders do), 10 hours minus
    // three minutes into the sixth stint.
    const hours250 = await row(HOURS, 'realHours', 250);
    expect(hours250).toMatchObject({
      achievedPrecision: 'INTERPOLATED',
      sessionId: nth(6).outcome.sessionId,
      raceId: nth(6).raceId,
      subjectName: 'Race 6',
    });
    expect(hours250?.achievedAt).toEqual(new Date(nth(6).watchedAt.getTime() - (38 * H + 180) * 1000));

    // The ladder's 100th hour, the same way, inside the third stint.
    const hours100 = await row(HOURS, 'realHours', 100);
    expect(hours100?.achievedPrecision).toBe('INTERPOLATED');
    expect(hours100?.achievedAt).toEqual(new Date(nth(3).watchedAt.getTime() - (44 * H + 180) * 1000));
    expect(hours100?.sessionId).toBe(nth(3).outcome.sessionId);

    // Counts take the stint that reached them.
    const firstStory = await row(HOURS, 'storyCompletes', 1);
    expect(firstStory).toMatchObject({ achievedPrecision: 'STINT', achievedAt: nth(1).watchedAt, sessionId: nth(1).outcome.sessionId });
  });

  it('a full viewing year is reached once per year', async () => {
    const years = (await milestoneRows(HOURS)).filter((candidate) => candidate.metric.startsWith('realHoursYear:'));
    expect(years.map((candidate) => [candidate.metric, candidate.threshold, candidate.xpAwarded])).toEqual([
      ['realHoursYear:2025', ANNUAL, 1_000],
      ['realHoursYear:2026', ANNUAL, 1_000],
    ]);
    // Reached at the very end of each year's seventh 48-hour stint.
    expect(years[0]).toMatchObject({ achievedAt: nth(7).watchedAt, achievedPrecision: 'INTERPOLATED', sessionId: nth(7).outcome.sessionId });
    expect(years[1]).toMatchObject({ achievedAt: nth(14).watchedAt, achievedPrecision: 'INTERPOLATED', sessionId: nth(14).outcome.sessionId });
    for (const year of [2025, 2026]) {
      const paid = await ledgerRows(HOURS, `milestone:realHoursYear:${year}`);
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ amount: 1_000, seasonAmount: 0 });
    }

    const reached = nth(7).outcome.careerMilestones.find((milestone) => milestone.id === 'year-plan');
    expect(reached).toMatchObject({
      title: careerMilestoneTitle(CAREER_MILESTONES_BY_ID.get('year-plan')!, 2025),
      metric: 'realHoursYear:2025',
      celebration: 'notable',
    });
    expect(reached?.title).toBe(`${ANNUAL} hours in 2025 — two full weeks of racing`);
    // The eighth stint of 2026 finds its year already reached.
    expect(nth(15).outcome.careerMilestones.map((milestone) => milestone.id)).not.toContain('year-plan');
  });

  it('lists a stint’s milestones with it, and the same again when its summary is reopened', async () => {
    const opening = nth(1).outcome;
    expect(opening.careerMilestones.map((milestone) => milestone.id)).toEqual(
      expect.arrayContaining(['first-race-started', 'first-race-completed', 'first-6h', 'first-12h', 'first-24h']),
    );
    // A ladder rung that is also a Career Milestone is listed once, with the milestones.
    const ladders = opening.milestones.map((rung) => `${rung.metric}:${rung.threshold}`);
    expect(ladders).toContain('sessions:1');
    expect(ladders).not.toContain('storyCompletes:1');
    expect(ladders).not.toContain('stories24h:1');

    for (const n of [1, 3, 6, 7, 14]) {
      const reopened = await buildOutcomeForSession(HOURS, nth(n).outcome.sessionId);
      expect(reopened?.careerMilestones, `stint ${n}`).toEqual(nth(n).outcome.careerMilestones);
      expect(reopened?.milestones, `stint ${n}`).toEqual(nth(n).outcome.milestones);
    }
  });

  it('reopening an old stint’s summary lists only what that stint unlocked', async () => {
    // Before 0.4.0 a reopened summary listed everything unlocked from its
    // stint onwards; now it is bounded by the stints either side of it.
    for (const n of [1, 2, 7]) {
      const reopened = await buildOutcomeForSession(HOURS, nth(n).outcome.sessionId);
      const live = nth(n).outcome;
      expect(new Set(reopened?.achievements.map((a) => a.key)), `stint ${n}`).toEqual(new Set(live.achievements.map((a) => a.key)));
      expect(new Set(reopened?.mastery.map((m) => m.nodeKey)), `stint ${n}`).toEqual(new Set(live.mastery.map((m) => m.nodeKey)));
      expect(new Set(reopened?.trophies.map((t) => t.key)), `stint ${n}`).toEqual(new Set(live.trophies.map((t) => t.key)));
    }
  });

  it('builds the Career Milestones page from the rows, with links, plaques and only the years reached', async () => {
    const view = await getCareerMilestonesView(HOURS, new Date(2026, 8, 24, 20, 0));
    expect(view.groups.map((group) => group.group)).toEqual(['firsts', 'stories', 'hours', 'races', 'years', 'events']);
    expect(view.groups.map((group) => group.title)).toEqual([
      'Firsts', 'Complete race stories', 'Career hours', 'Races experienced', 'Years', 'Recurring events',
    ]);

    const byId = new Map(view.groups.flatMap((group) => group.items).map((item) => [item.id, item]));
    const started = byId.get('first-race-started')!;
    expect(started).toMatchObject({
      reached: true, xp: 0, precision: 'STINT', date: nth(1).watchedAt,
      subject: { kind: 'race', href: `/races/${nth(1).raceId}`, name: 'Race 1' },
    });
    expect(started.alsoPaidBy.length).toBeGreaterThan(0);

    const plaque = await prisma.hallOfFameEntry.findFirst({ where: { userId: HOURS, key: 'first:race-24h' } });
    expect(plaque).not.toBeNull();
    expect(byId.get('first-24h')?.hallOfFame).toEqual({ title: plaque!.title, href: '/hall-of-fame#first:race-24h' });

    expect(byId.get('hours-250')).toMatchObject({ reached: true, xp: 1_000, progress: null });
    const ahead = byId.get('hours-1000')!;
    expect(ahead.reached).toBe(false);
    expect(ahead.progress).toEqual({ value: 720, target: 1_000, unit: 'hours' });

    const years = view.groups.find((group) => group.group === 'years')!;
    expect(years.items.map((item) => item.id)).toEqual(['year-plan:2025', 'year-plan:2026']);
    for (const item of years.items) expect(item.progress).toBeNull();
    expect(view.currentYear).toEqual({ year: 2026, creditedSeconds: 8 * LONG * H, reached: true });

    // The timeline: every reached milestone, newest first.
    expect(view.timeline.every((item) => item.reached)).toBe(true);
    const dates = view.timeline.map((item) => item.date!.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    expect(view.timeline).toHaveLength([...byId.values()].filter((item) => item.reached).length);

    // The Career page's panel and the dashboard shelf show the newest of them.
    const recent = await listRecentCareerMilestones(HOURS, 3);
    expect(recent.map((item) => item.date)).toEqual(view.timeline.slice(0, 3).map((item) => item.date));
    const dashboard = await getDashboard(HOURS, new Date(2026, 8, 24, 20, 0));
    const shelf = dashboard.unlocks.filter((unlock) => unlock.kind === 'milestone');
    expect(shelf.length).toBeGreaterThan(0);
    for (const unlock of shelf) expect(unlock.href).toBe('/career/milestones');
  });

  it('deleting stints keeps milestones and their dates', async () => {
    const kept = await milestoneRows(HOURS);
    const milestoneXp = await prisma.xPTransaction.findMany({
      where: { userId: HOURS, source: 'MILESTONE' },
      select: { id: true, dedupeKey: true, amount: true },
    });

    const now = new Date(2026, 8, 24, 20, 0);
    await deleteViewingSession(HOURS, nth(6).outcome.sessionId, now);
    await deleteViewingSession(HOURS, nth(3).outcome.sessionId, now);
    await deleteRace(HOURS, nth(1).raceId, now);
    // And a stint after it all, which re-dates nothing and pays nothing again.
    const again = await addRace(HOURS, { name: 'Race 16', hours: LONG });
    const outcome = await logStint(HOURS, again, { from: 0, to: LONG * H, watchedAt: now, now });

    const after = await milestoneRows(HOURS);
    for (const before of kept) {
      const still = after.find((candidate) => candidate.id === before.id);
      expect(still, `${before.metric}:${before.threshold}`).toEqual(before);
    }
    expect(outcome.careerMilestones.map((milestone) => milestone.id)).not.toContain('hours-250');
    const stillPaid = await prisma.xPTransaction.findMany({
      where: { id: { in: milestoneXp.map((award) => award.id) } },
      select: { id: true, dedupeKey: true, amount: true },
    });
    expect(stillPaid).toHaveLength(milestoneXp.length);
    expect(await ledgerProblems(HOURS)).toEqual([]);

    // The race it happened in is gone; the milestone still names it.
    const view = await getCareerMilestonesView(HOURS, now);
    const started = view.groups[0]!.items.find((item) => item.id === 'first-race-started');
    expect(started?.subject).toEqual({ kind: 'race', href: null, name: 'Race 1' });
  });
});

describe('a new account', () => {
  it('shows its first race started with a date, and everything else as where it stands', async () => {
    await createCareerUser(FRESH, 'CareerMilestonesTest Fresh');
    const now = new Date(2026, 8, 24, 20, 0);
    const first = await addRace(FRESH, { name: 'Six Hours of Somewhere' });
    await addRace(FRESH, { name: 'Twelve Hours of Elsewhere', hours: 12 });
    const outcome = await logStint(FRESH, first, { from: 0, to: 600, now });

    expect(outcome.careerMilestones).toEqual([
      expect.objectContaining({
        id: 'first-race-started', precision: 'STINT', achievedAt: now.toISOString(), xpAwarded: 0,
        subjectName: 'Six Hours of Somewhere', celebration: 'none',
      }),
    ]);
    // Recorded at 0 XP: the Green Flag and the first session rung pay this moment.
    expect(await ledgerRows(FRESH, 'milestone:racesStarted:1')).toEqual([]);

    const view = await getCareerMilestonesView(FRESH, now);
    const firsts = view.groups[0]!.items;
    expect(firsts[0]).toMatchObject({ id: 'first-race-started', reached: true, date: now });
    for (const item of firsts.slice(1)) {
      expect(item.reached).toBe(false);
      expect(item.progress).toEqual({ value: 0, target: 1, unit: 'count' });
    }
    const hours = view.groups.find((group) => group.group === 'hours')!.items;
    expect(hours[0]).toMatchObject({ id: 'hours-100', progress: { value: 0.2, target: 100, unit: 'hours' } });
    expect(view.groups.find((group) => group.group === 'years')!.items).toEqual([]);
    expect(view.currentYear).toEqual({ year: 2026, creditedSeconds: 600, reached: false });
    expect(view.timeline.map((item) => item.id)).toEqual(['first-race-started']);
  });
});

describe('two stints logged minutes apart', () => {
  it('never claim each other’s unlocks', async () => {
    await createCareerUser(NEIGHBOURS, 'CareerMilestonesTest Neighbours');
    const at = new Date(2026, 8, 24, 20, 0);
    const raceId = await addRace(NEIGHBOURS, { name: 'Short Race', hours: 1 });
    // The first stint starts the career; the second, two minutes later, finishes the race.
    const opening = await logStint(NEIGHBOURS, raceId, { from: 0, to: 600, now: at });
    const closing = await logStint(NEIGHBOURS, raceId, { from: 600, to: H, now: new Date(at.getTime() + 2 * MINUTE) });
    expect(opening.achievements.length).toBeGreaterThan(0);
    expect(closing.storyCompleted).toBe(true);
    expect(closing.careerMilestones.map((milestone) => milestone.id)).toContain('first-race-completed');

    for (const live of [opening, closing]) {
      const reopened = await buildOutcomeForSession(NEIGHBOURS, live.sessionId);
      expect(new Set(reopened?.achievements.map((a) => a.key))).toEqual(new Set(live.achievements.map((a) => a.key)));
      expect(reopened?.milestones).toEqual(live.milestones);
      expect(reopened?.careerMilestones).toEqual(live.careerMilestones);
    }
  });
});

describe('syncing and dating directly', () => {
  /** Seven 48-hour races watched whole in March 2024: a full year's plan exactly. */
  function history(): { sessions: TimelineSessionRow[]; races: TimelineRaceRow[] } {
    const races = Array.from({ length: 7 }, (_, index) => raceRow(`direct-${index}`, { hours: LONG, name: `Direct ${index}` }));
    const sessions = races.map((race, index) =>
      stintRow(race, new Date(2024, 2, 1 + index * 3, 8, 0), { from: '0:00', to: `${LONG}:00`, id: `direct-stint-${index}` }));
    return { sessions, races };
  }

  const metrics = { ...emptyMetrics(), racesStarted: 7, storyCompletes: 7, stories6h: 7, realHours: 336, racesExperienced: 120 };
  const now = new Date(2026, 8, 24, 20, 0);

  it('syncing twice creates no second row or XP', async () => {
    await createCareerUser(DIRECT, 'CareerMilestonesTest Direct');
    const input = { metrics, history: history(), now };

    const first = await prisma.$transaction((tx) => syncCareerMilestones(tx as Tx, DIRECT, input));
    expect(first.reached.map((reached) => [reached.id, reached.xpAwarded])).toEqual([
      ['first-race-started', 0], ['first-6h', 500], ['hours-250', 1_000], ['races-100', 500], ['year-plan', 1_000],
    ]);
    expect(first).toMatchObject({ created: 5, xpAwarded: 3_000 });
    const rowsAfterFirst = await milestoneRows(DIRECT);
    const ledgerAfterFirst = await prisma.xPTransaction.findMany({ where: { userId: DIRECT }, orderBy: { id: 'asc' } });
    // A rung with no XP writes no ledger row at all.
    expect(ledgerAfterFirst).toHaveLength(4);
    for (const award of ledgerAfterFirst) expect(award.seasonAmount).toBe(0);

    const second = await prisma.$transaction((tx) => syncCareerMilestones(tx as Tx, DIRECT, input));
    expect(second).toEqual({ created: 0, xpAwarded: 0, reached: [] });
    expect(await milestoneRows(DIRECT)).toEqual(rowsAfterFirst);
    expect(await prisma.xPTransaction.findMany({ where: { userId: DIRECT }, orderBy: { id: 'asc' } })).toEqual(ledgerAfterFirst);
  });

  it('dates every row once, and marks what history cannot place as recognised', async () => {
    const input = { history: history(), now };
    const dated = await prisma.$transaction((tx) => fillLandmarkDates(tx as Tx, DIRECT, input));
    // 100 races experienced cannot be placed: this history holds seven.
    expect(dated).toEqual({ milestones: 4, eventSteps: 0, recognised: 1 });
    expect(await row(DIRECT, 'racesExperienced', 100)).toMatchObject({ achievedPrecision: 'RECOGNISED', achievedAt: null, sessionId: null });
    expect(await row(DIRECT, 'realHoursYear:2024', ANNUAL)).toMatchObject({
      achievedPrecision: 'INTERPOLATED', achievedAt: new Date(2024, 2, 19, 8, 0), sessionId: 'direct-stint-6',
    });

    const datedRows = await milestoneRows(DIRECT);
    expect(await prisma.$transaction((tx) => fillLandmarkDates(tx as Tx, DIRECT, input)))
      .toEqual({ milestones: 0, eventSteps: 0, recognised: 0 });
    expect(await milestoneRows(DIRECT)).toEqual(datedRows);
  });

  it('re-tuning the annual hours never pays a year twice', async () => {
    await createCareerUser(RETUNED, 'CareerMilestonesTest Retuned');
    // The year was reached, and paid, when the plan was 36 hours smaller.
    const earlierPlan = ANNUAL - 36;
    await prisma.$transaction(async (tx) => {
      await awardXp(tx as Tx, RETUNED, {
        source: 'MILESTONE', amount: 1_000, description: 'Career milestone', sourceRef: `realHoursYear:2024:${earlierPlan}`,
        dedupeKey: 'milestone:realHoursYear:2024',
      });
      await tx.milestoneProgress.create({
        data: { userId: RETUNED, metric: 'realHoursYear:2024', threshold: earlierPlan, reachedAt: new Date(2024, 2, 17), valueAtReach: earlierPlan, xpAwarded: 1_000 },
      });
    });

    const synced = await prisma.$transaction((tx) =>
      syncCareerMilestones(tx as Tx, RETUNED, { metrics: emptyMetrics(), history: history(), now }));

    expect(synced.reached.map((reached) => reached.id)).not.toContain('year-plan');
    const years = (await milestoneRows(RETUNED)).filter((candidate) => candidate.metric.startsWith('realHoursYear:'));
    expect(years.map((candidate) => [candidate.metric, candidate.threshold])).toEqual([['realHoursYear:2024', earlierPlan]]);
    expect(await ledgerRows(RETUNED, 'milestone:realHoursYear:2024')).toHaveLength(1);
    // It is still that year's rung on the page.
    const view = await getCareerMilestonesView(RETUNED, now);
    expect(view.groups.find((group) => group.group === 'years')!.items.map((item) => item.id)).toEqual(['year-plan:2024']);
  });
});

describe('a race edit', () => {
  it('pays balances at once after a runtime edit, and writes the milestone at the next save, dated when it happened', async () => {
    await createCareerUser(EDITED, 'CareerMilestonesTest Edited');
    const at = new Date(2026, 8, 20, 20, 0);
    const now = new Date(2026, 8, 24, 20, 0);
    const raceId = await addRace(EDITED, { name: 'Seven Hours, Really Six', hours: 7 });
    const watched = await logStint(EDITED, raceId, { from: 0, to: 6 * H, now: at });
    expect(watched.storyCompleted).toBe(false);

    const edit = (runtimeChanged: boolean) => prisma.$transaction(async (tx) => {
      const db = tx as Tx;
      if (runtimeChanged) {
        await db.race.update({ where: { id: raceId }, data: { runtimeSec: 6 * H, scheduledDurationSec: 6 * H } });
        await rebuildRaceIntervals(db, raceId);
      }
      await recomputeRaceAggregates(db, raceId, now);
      return resyncAfterRaceEdit(db, EDITED, raceId, now, { runtimeChanged });
    });

    const runtimeEdit = await edit(true);
    expect(runtimeEdit.storyBonus.awarded).toBeGreaterThan(0);
    expect(await row(EDITED, 'stories6h', 1)).toBeNull();

    const nameEdit = await edit(false);
    const sixHours = await row(EDITED, 'stories6h', 1);
    expect(sixHours).toMatchObject({
      xpAwarded: 500, reachedAt: now, achievedPrecision: 'STINT', achievedAt: at, sessionId: watched.sessionId,
    });
    expect(nameEdit.xpAwarded).toBeGreaterThanOrEqual(500);
    expect(await ledgerRows(EDITED, 'milestone:stories6h:1')).toHaveLength(1);
    expect(await ledgerProblems(EDITED)).toEqual([]);
  });
});

describe('a milestone history cannot place', () => {
  it('is listed with the stint that recorded it, and only with that stint', async () => {
    await createCareerUser(RECOGNISED, 'CareerMilestonesTest Recognised');
    const at = new Date(2026, 8, 24, 20, 0);
    // Rows the replay cannot find a crossing for: one recorded by the stint
    // below, one recorded the day before.
    await prisma.milestoneProgress.createMany({
      data: [
        { userId: RECOGNISED, metric: 'racesExperienced', threshold: 100, reachedAt: at, valueAtReach: 100 },
        { userId: RECOGNISED, metric: 'racesExperienced', threshold: 250, reachedAt: new Date(at.getTime() - 86_400_000), valueAtReach: 250 },
      ],
    });
    const raceId = await addRace(RECOGNISED);
    const outcome = await logStint(RECOGNISED, raceId, { from: 0, to: 600, now: at });

    expect(outcome.careerMilestones.map((milestone) => [milestone.id, milestone.precision])).toEqual([
      ['first-race-started', 'STINT'],
      ['races-100', 'RECOGNISED'],
    ]);
    const recorded = outcome.careerMilestones.find((milestone) => milestone.id === 'races-100');
    expect(recorded).toMatchObject({ achievedAt: null, recordedAt: at.toISOString() });
    expect(await row(RECOGNISED, 'racesExperienced', 250)).toMatchObject({ achievedPrecision: 'RECOGNISED', sessionId: null });

    // Its metric is reached, so nothing is paid for it later either.
    const metrics = await computeCareerMetrics(RECOGNISED);
    expect(metrics.racesExperienced).toBe(0);
    expect(await ledgerRows(RECOGNISED, 'milestone:racesExperienced:100')).toEqual([]);
    // Neither milestone is one to celebrate, and nothing else in this stint is spectacular.
    expect(outcome.celebrate).not.toBe('SPECTACULAR');
  });

  it('celebrates the stint that recorded it as loudly as the milestone asks, live and reopened', async () => {
    await createCareerUser(CELEBRATED, 'CareerMilestonesTest Celebrated');
    const at = new Date(2026, 8, 24, 20, 0);
    // The same ten-minute first stint as above, which recorded the 1,000th race experienced.
    await prisma.milestoneProgress.create({
      data: { userId: CELEBRATED, metric: 'racesExperienced', threshold: 1_000, reachedAt: at, valueAtReach: 1_000 },
    });
    const raceId = await addRace(CELEBRATED);
    const outcome = await logStint(CELEBRATED, raceId, { from: 0, to: 600, now: at });

    expect(outcome.careerMilestones.find((milestone) => milestone.id === 'races-1000'))
      .toMatchObject({ precision: 'RECOGNISED', celebration: 'spectacular' });
    expect(outcome.celebrate).toBe('SPECTACULAR');
    expect((await buildOutcomeForSession(CELEBRATED, outcome.sessionId))?.celebrate).toBe('SPECTACULAR');
  });
});

describe('an event step', () => {
  it('is dated to the stint that completed its edition, from the replay of that event’s races', async () => {
    await createCareerUser(EVENT_STEP, 'CareerMilestonesTest Event Step');
    const at = new Date(2026, 8, 24, 20, 0);
    const raceId = await addRace(EVENT_STEP, {
      name: 'One Hour of Testing', hours: 1, iconicKey: 'one-hour-of-testing', raceDate: new Date(Date.UTC(2026, 5, 13)),
    });
    const opening = await logStint(EVENT_STEP, raceId, { from: 0, to: 1_800, now: new Date(at.getTime() - 60 * MINUTE) });
    const closing = await logStint(EVENT_STEP, raceId, { from: 1_800, to: H, now: at });
    expect(closing.storyCompleted).toBe(true);

    const step = () => prisma.masteryProgress.findFirstOrThrow({
      where: { userId: EVENT_STEP, node: { key: 'edition_1', tree: { kind: 'RACE_EVENT', iconicKey: 'one-hour-of-testing' } } },
    });
    const live = await step();
    expect(live).toMatchObject({ unlockedAt: at, achievedPrecision: 'STINT', achievedAt: at, achievedSessionId: closing.sessionId });

    // Undated again and dated with no stint being logged, the step can only
    // have its stint from the replay, never from the one recording it.
    await prisma.masteryProgress.update({
      where: { id: live.id },
      data: { achievedAt: null, achievedPrecision: null, achievedSessionId: null },
    });
    const history = await loadTimelineInputs(prisma, EVENT_STEP);
    const dated = await prisma.$transaction((tx) => fillLandmarkDates(tx as Tx, EVENT_STEP, { history, now: at }));
    expect(dated).toEqual({ milestones: 0, eventSteps: 1, recognised: 0 });
    const replayed = await step();
    expect(replayed).toMatchObject({ achievedPrecision: 'STINT', achievedAt: at, achievedSessionId: closing.sessionId });
    expect(replayed.achievedSessionId).not.toBe(opening.sessionId);
  });
});
