/**
 * Upgrading a database the real 0.3.2 code wrote.
 *
 * `tests/fixtures/career-0.3.2.db` holds the demonstration career exactly as
 * 0.3.2 left it — ledger re-stamps, intervals built in insertion order, and
 * achievement, mastery, milestone and Hall of Fame rows across two calendar
 * years (see `tests/fixtures/README.md`). Each run works on a copy.
 *
 * This file grows with the release: the migration is checked here first, and
 * the career backfill, Event Legacy, Expeditions and the Chronicle add their
 * own checks against the same data. Prisma is pointed at the copy before the
 * first query, so the backfill runs on it exactly as it would at start-up.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { join, resolve } from 'node:path';
import { runMigrations } from '../../desktop/src/migrate';
import { disconnectDb, prisma } from '@/lib/db/client';
import {
  CAREER_BACKFILL_PHASES, deadlineClock, isCareerBackfillApplied, readCareerBackfillMarker, runCareerBackfill,
  runCareerBackfillFor,
} from '@/lib/server/upgrades/career-backfill';
import { expeditionSummarySnapshotSchema } from '@/lib/domain/expedition';
import { upgradeChapterSnapshot } from '@/lib/domain/chronicle';
import { getChronicleChapter, getChronicleIndex } from '@/lib/engines/chronicle-engine';
import { eventStepProblems, expeditionProblems, ledgerProblems } from '../helpers/career-db';
import type { FixtureCopy } from '../helpers/fixture-db';
import { FIXTURE_GENERATED_AT, FIXTURE_USER_ID, pointPrismaAtFixture } from '../helpers/fixture-db';

const MIGRATIONS = join(resolve(process.cwd()), 'prisma', 'migrations');
const CAREER_HISTORY = '20260924120000_career_history';

/** The first start after the update: a few minutes after the fixture was written. */
const STARTED = new Date(FIXTURE_GENERATED_AT.getTime() + 20 * 60_000);

/** A start-up clock that always has time: the fixture is small. */
const PLENTY_OF_TIME = { shouldStartChunk: () => true };

let copy: FixtureCopy;

beforeAll(() => {
  copy = pointPrismaAtFixture();
});

afterAll(async () => {
  await disconnectDb();
  copy.cleanup();
});

function counts(file: string): Record<string, number> {
  const db = new Database(file, { readonly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]).map((row) => row.name);
    return Object.fromEntries(tables.map((table) => [
      table, (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n,
    ]));
  } finally {
    db.close();
  }
}

/** Every row of the tables a migration must never touch, in a stable order. */
function history(file: string): unknown[][] {
  const db = new Database(file, { readonly: true });
  try {
    return ['race_viewing_sessions', 'watched_intervals', 'xp_transactions', 'milestone_progress', 'mastery_progress', 'races']
      .map((table) => db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all() as unknown[]);
  } finally {
    db.close();
  }
}

describe('migrating the 0.3.2 fixture', () => {
  let before: Record<string, number>;
  let rowsBefore: unknown[][];

  beforeAll(() => {
    before = counts(copy.file);
    rowsBefore = history(copy.file);
  });

  it('is the career 0.3.2 wrote', () => {
    const db = new Database(copy.file, { readonly: true });
    try {
      const applied = (db.prepare('SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "migration_name"').all() as { migration_name: string }[])
        .map((row) => row.migration_name);
      expect(applied).not.toContain(CAREER_HISTORY);
      expect(applied).toHaveLength(3);
      const user = db.prepare('SELECT "id" FROM "users"').all() as { id: string }[];
      expect(user).toEqual([{ id: FIXTURE_USER_ID }]);
    } finally {
      db.close();
    }
    expect(before.race_viewing_sessions).toBeGreaterThan(0);
    expect(before.xp_transactions).toBeGreaterThan(0);
  });

  it('applies only the 0.4.0 migration and keeps every row', () => {
    const report = runMigrations(copy.file, MIGRATIONS);
    expect(report.applied.map((migration) => migration.name)).toEqual([CAREER_HISTORY]);
    expect(report.checksumMismatches).toEqual([]);

    const after = counts(copy.file);
    for (const [table, count] of Object.entries(before)) {
      expect(after[table], table).toBe(table === '_prisma_migrations' ? count + 1 : count);
    }
    for (const table of ['expedition_summaries', 'chronicle_years', 'event_step_credits']) {
      expect(after[table], table).toBe(0);
    }
    // Not a value changed in the stints, the intervals, the ledger, the
    // landmarks or the races, and every new column is empty on every old row.
    const rowsAfter = history(copy.file);
    for (const [index, rows] of rowsBefore.entries()) {
      const upgraded = rowsAfter[index] as Record<string, unknown>[];
      const oldColumns = new Set(Object.keys((rows[0] ?? {}) as object));
      expect(upgraded).toHaveLength(rows.length);
      expect(upgraded.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => oldColumns.has(column)))))
        .toEqual(rows);
      for (const row of upgraded) {
        for (const [column, value] of Object.entries(row)) {
          if (!oldColumns.has(column)) expect(value, column).toBeNull();
        }
      }
    }
  });

  it('leaves no foreign key violation and an intact file', () => {
    const db = new Database(copy.file, { readonly: true });
    try {
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  });

  it('is a no-op the second time', () => {
    const settled = counts(copy.file);
    const again = runMigrations(copy.file, MIGRATIONS);
    expect(again.applied).toEqual([]);
    expect(counts(copy.file)).toEqual(settled);
  });
});

describe('the 0.4.0 career backfill on the 0.3.2 fixture', () => {
  /** What the backfill writes to a race: the credited-time cache, and so its `updatedAt`. */
  const CACHE_COLUMNS = new Set(['creditedViewingSec', 'updatedAt']);

  /** The rows the backfill may not change: stints and intervals whole, races but for the credited-time cache. */
  function untouchable(file: string): { stints: unknown[]; intervals: unknown[]; races: unknown[] } {
    const db = new Database(file, { readonly: true });
    try {
      return {
        stints: db.prepare('SELECT * FROM "race_viewing_sessions" ORDER BY "id"').all(),
        intervals: db.prepare('SELECT * FROM "watched_intervals" ORDER BY "id"').all(),
        races: (db.prepare('SELECT * FROM "races" ORDER BY "id"').all() as Record<string, unknown>[])
          .map((race) => Object.fromEntries(Object.entries(race).filter(([column]) => !CACHE_COLUMNS.has(column)))),
      };
    } finally {
      db.close();
    }
  }

  /** Everything the backfill writes, for comparing one run with the next. */
  async function written() {
    const [ledger, milestones, steps, races, credits, summaries, chapters] = await Promise.all([
      prisma.xPTransaction.findMany({
        where: { userId: FIXTURE_USER_ID },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, amount: true, seasonAmount: true, careerXpAfter: true, levelAfter: true, dedupeKey: true },
      }),
      prisma.milestoneProgress.findMany({ where: { userId: FIXTURE_USER_ID }, orderBy: { id: 'asc' } }),
      prisma.masteryProgress.findMany({
        where: { userId: FIXTURE_USER_ID },
        orderBy: { id: 'asc' },
        select: { id: true, unlockedAt: true, achievedAt: true, achievedPrecision: true, achievedSessionId: true },
      }),
      prisma.race.findMany({ where: { userId: FIXTURE_USER_ID }, orderBy: { id: 'asc' }, select: { id: true, creditedViewingSec: true } }),
      prisma.eventStepCredit.findMany({ where: { userId: FIXTURE_USER_ID }, orderBy: { id: 'asc' } }),
      prisma.expeditionSummary.findMany({ where: { userId: FIXTURE_USER_ID }, orderBy: { id: 'asc' } }),
      prisma.chronicleYear.findMany({ where: { userId: FIXTURE_USER_ID }, orderBy: { year: 'asc' } }),
    ]);
    return { ledger, milestones, steps, races, credits, summaries, chapters };
  }

  let before: ReturnType<typeof untouchable>;

  beforeAll(() => {
    before = untouchable(copy.file);
  });

  it('brings the career up to date in the first start after the update', async () => {
    expect(await readCareerBackfillMarker(FIXTURE_USER_ID)).toBeNull();
    const lines: string[] = [];
    const summaries = await runCareerBackfill({
      now: STARTED,
      clock: deadlineClock(Date.now() + 30_000),
      log: { info: (line) => lines.push(line), error: (line) => lines.push(line) },
    });

    expect(summaries.map((summary) => summary.userId)).toEqual([FIXTURE_USER_ID]);
    const [summary] = summaries;
    expect(summary).toMatchObject({ completed: true, skipped: false, pausedBefore: null, racesCredited: 11 });
    expect(summary?.datesFilled).toBeGreaterThan(0);
    expect(summary?.datesRecognised).toBeGreaterThan(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[career-backfill\] Demo Driver \(00000000-0000-4000-8000-000000000001\): credited 11 races/);

    expect(await isCareerBackfillApplied(FIXTURE_USER_ID)).toBe(true);
    const marker = await readCareerBackfillMarker(FIXTURE_USER_ID);
    expect(marker?.done).toEqual([...CAREER_BACKFILL_PHASES]);
    expect(marker?.lastRunAt).toBe(STARTED.toISOString());
  });

  it('leaves every stint, interval and race status as 0.3.2 wrote them', async () => {
    const after = untouchable(copy.file);
    expect(after.stints).toEqual(before.stints);
    expect(after.intervals).toEqual(before.intervals);
    expect(after.races).toEqual(before.races);
    // Credited time is the one thing written to the races, and every race has it.
    const races = await prisma.race.findMany({ where: { userId: FIXTURE_USER_ID }, select: { creditedViewingSec: true, realViewingSec: true } });
    expect(races).toHaveLength(11);
    for (const race of races) expect(race.creditedViewingSec).not.toBeNull();
  });

  it('dates every milestone and event step, from history wherever history can say', async () => {
    const milestones = await prisma.milestoneProgress.findMany({ where: { userId: FIXTURE_USER_ID } });
    expect(milestones.length).toBeGreaterThan(30);
    for (const row of milestones) {
      expect(row.achievedPrecision, `${row.metric}:${row.threshold}`).not.toBeNull();
      if (row.achievedPrecision === 'RECOGNISED') {
        expect(row.achievedAt).toBeNull();
      } else {
        // Never after the moment 0.3.2 recorded it.
        expect(row.achievedAt!.getTime(), `${row.metric}:${row.threshold}`).toBeLessThanOrEqual(row.reachedAt!.getTime() + 5 * 60_000);
        expect(row.sessionId).not.toBeNull();
        expect(row.subjectName).not.toBeNull();
      }
    }
    const precisionOf = (metric: string) => new Set(milestones.filter((row) => row.metric === metric).map((row) => row.achievedPrecision));
    expect(precisionOf('realHours')).toEqual(new Set(['INTERPOLATED']));
    expect(precisionOf('storyCompletes')).toEqual(new Set(['STINT']));
    // Counts of what else is in the library carry no instant of their own.
    for (const metric of ['circuits', 'countries', 'championshipsCompleted', 'racesCompleted', 'level']) {
      expect(precisionOf(metric), metric).toEqual(new Set(['RECOGNISED']));
    }

    const steps = await prisma.masteryProgress.findMany({
      where: { userId: FIXTURE_USER_ID, unlockedAt: { not: null }, node: { tree: { kind: 'RACE_EVENT' } } },
      include: { node: { select: { key: true, metric: true, tree: { select: { iconicKey: true } } } } },
    });
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step.achievedPrecision).not.toBeNull();

    // A step counted in editions is found in the replay of its own event's
    // races, and dated to the stint that reached it.
    const counted = steps.filter((step) => ['editionsStoryComplete', 'editionsExperienced'].includes(step.node.metric));
    expect(counted.length).toBeGreaterThan(0);
    const stints = new Map((await prisma.raceViewingSession.findMany({
      where: { userId: FIXTURE_USER_ID },
      select: { id: true, watchedAt: true, race: { select: { iconicKey: true } } },
    })).map((stint) => [stint.id, stint]));
    for (const step of counted) {
      const label = `${step.node.tree.iconicKey} ${step.node.key}`;
      expect(step.achievedPrecision, label).toBe('STINT');
      const stint = stints.get(step.achievedSessionId ?? '');
      expect(stint, label).toBeDefined();
      expect(stint!.race.iconicKey, label).toBe(step.node.tree.iconicKey);
      expect(step.achievedAt, label).toEqual(stint!.watchedAt);
      expect(step.achievedAt!.getTime(), label).toBeLessThanOrEqual(step.unlockedAt!.getTime() + 5 * 60_000);
    }
  });

  it('writes the new rungs the career had already passed, once, as career XP only', async () => {
    const started = await prisma.milestoneProgress.findUniqueOrThrow({
      where: { userId_metric_threshold: { userId: FIXTURE_USER_ID, metric: 'racesStarted', threshold: 1 } },
    });
    // Recorded now, dated when it happened: the first stint of the career.
    expect(started.reachedAt).toEqual(STARTED);
    expect(started.achievedPrecision).toBe('STINT');
    expect(started.achievedAt!.getTime()).toBeLessThan(new Date('2025-08-01T00:00:00Z').getTime());
    expect(started.xpAwarded).toBe(0);
    expect(await prisma.xPTransaction.count({ where: { userId: FIXTURE_USER_ID, dedupeKey: 'milestone:racesStarted:1' } })).toBe(0);

    const sixHours = await prisma.xPTransaction.findMany({ where: { userId: FIXTURE_USER_ID, dedupeKey: 'milestone:stories6h:1' } });
    expect(sixHours).toHaveLength(1);
    expect(sixHours[0]).toMatchObject({ source: 'MILESTONE', amount: 500, seasonAmount: 0 });
  });

  it('brings the fixture’s recurring event up to 0.4.0: its new steps, once, and a credit for every step it reached', async () => {
    const tree = await prisma.masteryTree.findFirstOrThrow({
      where: { userId: FIXTURE_USER_ID, key: 'event:fort-aurelia-24' },
      select: {
        name: true,
        nodes: {
          select: {
            key: true, name: true, xpReward: true,
            progress: { where: { userId: FIXTURE_USER_ID }, select: { unlockedAt: true, achievedPrecision: true } },
          },
        },
      },
    });
    const byKey = new Map(tree.nodes.map((node) => [node.key, node]));
    // Every step 0.4.0 knows, under its 0.4.0 name.
    expect(tree.nodes).toHaveLength(17);
    expect(byKey.get('edition_1')?.name).toBe('First Complete Edition');
    expect(byKey.get('experienced_1')?.name).toBe('First Edition Experienced');

    // The fixture follows Fort Aurelia over two years, 2025 complete and 2026 experienced, 28 credited hours in all.
    const reached = tree.nodes.filter((node) => node.progress[0]?.unlockedAt != null).map((node) => node.key).sort();
    expect(reached).toEqual(['edition_1', 'event_hours_25', 'experienced_1']);
    for (const key of reached) expect(byKey.get(key)?.progress[0]?.achievedPrecision, key).not.toBeNull();

    // Of the new steps it had passed, 25 Hours Here pays, once, as career XP; the first experienced edition pays nothing.
    const paid = await prisma.xPTransaction.findMany({
      where: { userId: FIXTURE_USER_ID, dedupeKey: { startsWith: 'mastery:event:fort-aurelia-24:' } },
      select: { dedupeKey: true, amount: true, seasonAmount: true },
      orderBy: { dedupeKey: 'asc' },
    });
    expect(paid).toEqual([
      { dedupeKey: 'mastery:event:fort-aurelia-24:edition_1', amount: 1_000, seasonAmount: 0 },
      { dedupeKey: 'mastery:event:fort-aurelia-24:event_hours_25', amount: 500, seasonAmount: 0 },
    ]);

    // Every step it reached is credited to the races that reached it, for this event.
    const races = await prisma.race.findMany({
      where: { userId: FIXTURE_USER_ID, iconicKey: 'fort-aurelia-24' },
      select: { id: true, storyCompletedAt: true },
    });
    const complete = races.filter((race) => race.storyCompletedAt !== null).map((race) => race.id);
    const credits = await prisma.eventStepCredit.findMany({ where: { userId: FIXTURE_USER_ID } });
    const creditedFor = (nodeKey: string) => credits.filter((credit) => credit.nodeKey === nodeKey).map((credit) => credit.raceId).sort();
    expect(creditedFor('edition_1')).toEqual(complete);
    expect(creditedFor('experienced_1')).toEqual(races.map((race) => race.id).sort());
    expect(creditedFor('event_hours_25')).toEqual(races.map((race) => race.id).sort());
    expect(credits.every((credit) => credit.eventKey === 'fort-aurelia-24' && credit.fingerprint === null)).toBe(true);
    expect(await eventStepProblems(FIXTURE_USER_ID)).toEqual([]);
  });

  it('pays each Expedition the checkpoints it had already reached, naming no stint, and sums up every completed one', async () => {
    // The fixture's races of ten hours or more: two editions of Fort Aurelia (24 h,
    // one complete, one a little over half watched), Redstone (12 h) and Karoo (10 h).
    const races = await prisma.race.findMany({
      where: { userId: FIXTURE_USER_ID, runtimeSec: { gte: 10 * 3600 } },
      select: { id: true, name: true, runtimeSec: true, coverageSec: true, storyCompletedAt: true },
    });
    expect(races).toHaveLength(4);
    const rows = await prisma.xPTransaction.findMany({
      where: { userId: FIXTURE_USER_ID, source: 'EXPEDITION' },
      select: { sourceRef: true, dedupeKey: true, amount: true, seasonAmount: true, sessionId: true },
    });
    // I3: every checkpoint held is one its race's coverage reaches, once.
    expect(await expeditionProblems(FIXTURE_USER_ID)).toEqual([]);
    for (const row of rows) expect(row).toMatchObject({ seasonAmount: 0, sessionId: null });
    const percentsOf = (raceId: string) => rows.filter((row) => row.sourceRef === raceId)
      .map((row) => Number(row.dedupeKey!.split(':')[2])).sort((a, b) => a - b);
    for (const race of races) {
      const expected = race.storyCompletedAt !== null ? [10, 25, 50, 75, 90] : [10, 25, 50];
      expect(percentsOf(race.id), race.name).toEqual(expected);
    }
    expect(rows.filter((row) => row.sourceRef === races.find((race) => race.runtimeSec === 86_400 && race.storyCompletedAt !== null)?.id)
      .reduce((sum, row) => sum + row.amount, 0)).toBe(3_000);

    const summaries = await prisma.expeditionSummary.findMany({ where: { userId: FIXTURE_USER_ID } });
    const complete = races.filter((race) => race.storyCompletedAt !== null);
    expect(summaries.map((summary) => summary.raceId).sort()).toEqual(complete.map((race) => race.id).sort());
    for (const summary of summaries) {
      const race = complete.find((candidate) => candidate.id === summary.raceId)!;
      expect(summary).toMatchObject({ retrospective: true, raceName: race.name, createdAt: STARTED });
      const snapshot = expeditionSummarySnapshotSchema.parse(summary.snapshot);
      expect(snapshot).toMatchObject({
        unlocks: 'reconstructed', mastery: { championship: null }, uniqueCoverageSeconds: race.runtimeSec, finalCompletionText: '100%',
      });
      // Completed by one of its own stints, in the history 0.3.2 recorded.
      const completing = await prisma.raceViewingSession.findFirstOrThrow({ where: { id: snapshot.completingSessionId }, select: { raceId: true, watchedAt: true } });
      expect(completing.raceId).toBe(race.id);
      expect(summary.completedAt).toEqual(completing.watchedAt);
      expect(snapshot.xp.total).toBe(snapshot.xp.viewing + snapshot.xp.rewatch + snapshot.xp.storyComplete + snapshot.xp.checkpoints);
      expect(snapshot.xp.storyComplete).toBeGreaterThan(0);
    }
  });

  it('freezes the 2025 chapter, with its dates and its Expedition, and leaves 2026 to be written', async () => {
    const rows = await prisma.chronicleYear.findMany({ where: { userId: FIXTURE_USER_ID } });
    expect(rows.map((row) => row.year)).toEqual([2025]);
    const [row] = rows;
    expect(row).toMatchObject({ frozenAt: STARTED, rebuiltAt: null, wrappedSeenAt: null, schemaVersion: 1 });
    const chapter = upgradeChapterSnapshot(row!.snapshot);
    expect(chapter).toMatchObject({ year: 2025, complete: true, generatedAt: STARTED.toISOString() });
    // The demo career's first year: one 24-hour race, watched to the end over a week of July.
    expect(chapter.summary).toMatchObject({ racesStarted: 1, racesExperienced: 1, storyCompletes: 1, expeditionsCompleted: 1 });
    expect(chapter.beginnings?.firstStint?.raceName).toBe('24 Hours of Fort Aurelia');
    // Frozen after the upgrade dated them: every landmark it lists has its historical date.
    expect(chapter.milestones.career.length).toBeGreaterThan(0);
    for (const milestone of chapter.milestones.career) expect(milestone.at.startsWith('2025-'), milestone.id).toBe(true);
    const [expedition] = chapter.expeditions;
    const summary = await prisma.expeditionSummary.findFirstOrThrow({ where: { userId: FIXTURE_USER_ID, id: expedition!.summaryId } });
    expect(summary.completedAt.getFullYear()).toBe(2025);

    // 2026 is the year in progress: shown live, never frozen yet.
    const index = await getChronicleIndex(FIXTURE_USER_ID, STARTED);
    expect(index.years.map((year) => [year.year, year.kind === 'chapter' ? year.state : year.kind])).toEqual([
      [2026, 'year-to-date'], [2025, 'frozen'],
    ]);
    expect(index.pendingWrapped).toEqual({ year: 2025 });
    const live = await getChronicleChapter(FIXTURE_USER_ID, 2026, STARTED);
    expect(live).toMatchObject({ state: 'year-to-date', careerYear: 2, frozen: null });
    expect(live!.chapter.previousYear).toMatchObject({ year: 2025, careerBeganInYear: true, storyCompletes: 1 });
  });

  it('keeps the ledger whole: every dedupe key once, and every running total right', async () => {
    const keys = await prisma.xPTransaction.groupBy({
      by: ['dedupeKey'],
      where: { userId: FIXTURE_USER_ID, dedupeKey: { not: null } },
      _count: { _all: true },
    });
    expect(keys.filter((key) => key._count._all > 1)).toEqual([]);
    expect(await ledgerProblems(FIXTURE_USER_ID)).toEqual([]);
  });

  it('changes nothing on the next start, or when it is forced to run again', async () => {
    const settled = await written();
    expect(await runCareerBackfill({ now: new Date(STARTED.getTime() + 86_400_000), clock: PLENTY_OF_TIME, log: { info: () => undefined, error: () => undefined } }))
      .toEqual([]);
    const forced = await runCareerBackfillFor(FIXTURE_USER_ID, { now: new Date(STARTED.getTime() + 86_400_000), clock: PLENTY_OF_TIME, force: true });
    expect(forced).toMatchObject({
      completed: true, racesCredited: 0, storyBonusesAwarded: 0, storyBonusesRevoked: 0,
      eventStepsUnlocked: 0, eventStepXp: 0, creditsWritten: 0,
      milestonesCreated: 0, milestoneXp: 0, datesFilled: 0, datesRecognised: 0,
      expeditionCheckpoints: 0, expeditionXp: 0, summariesWritten: 0, chaptersFrozen: 0,
    });
    const again = await written();
    expect(again.ledger).toEqual(settled.ledger);
    expect(again.milestones).toEqual(settled.milestones);
    expect(again.steps).toEqual(settled.steps);
    expect(again.races).toEqual(settled.races);
    expect(again.credits).toEqual(settled.credits);
    expect(again.summaries).toEqual(settled.summaries);
    expect(again.chapters).toEqual(settled.chapters);
  });
});
