/**
 * Race Expeditions: which races are one, what their checkpoints pay, and the
 * live figures an Expedition shows.
 */

import { describe, expect, it } from 'vitest';
import { EXPEDITION_CONFIG, EXPEDITION_SHAPE } from '@/lib/config';
import {
  buildExpeditionSummarySnapshot, checkpointOfKey, checkpointSchedule, checkpointsCrossedBy, checkpointsPayXp,
  checkpointsSatisfied, checkpointTicks, coverageReaches, eventStandingAt, expeditionDedupeKey, expeditionFigures,
  expeditionSummarySnapshotSchema, isExpedition, nextCheckpoint, parseExpeditionSummarySnapshot,
  type ExpeditionSummaryInput,
} from '@/lib/domain/expedition';
import { replayRace } from '@/lib/domain/career-timeline';
import { stintLanes } from '@/lib/domain/stint-lanes';
import { careerRecordOptions, computeRecordProgression } from '@/lib/domain/records';
import { career, localTime, race, stint } from '../helpers/timeline-fixture';
import { inTimeZone, ZONES } from '../helpers/time-zone';

const H = 3600;

describe('eligibility', () => {
  it('a race scheduled for 10h is automatic and 9h59m is not', () => {
    expect(isExpedition({ scheduledDurationSec: 10 * H, expeditionMode: null })).toBe(true);
    expect(isExpedition({ scheduledDurationSec: 10 * H - 60, expeditionMode: null })).toBe(false);
    expect(EXPEDITION_SHAPE.autoThresholdHours).toBe(10);
  });

  it('a 10h race cut short by a red flag stays automatic', () => {
    // Eligibility reads the scheduled length; the runtime is what was run.
    const redFlagged = race('r', { hours: 9 + 50 / 60, scheduledDurationSec: 10 * H });
    expect(isExpedition(redFlagged)).toBe(true);
  });

  it('any race can be switched on', () => {
    expect(isExpedition({ scheduledDurationSec: 2 * H, expeditionMode: true })).toBe(true);
    expect(isExpedition({ scheduledDurationSec: 20 * 60, expeditionMode: true })).toBe(true);
  });

  it('off always wins', () => {
    expect(isExpedition({ scheduledDurationSec: 24 * H, expeditionMode: false })).toBe(false);
  });

  it('checkpoints pay XP from 6 hours of runtime', () => {
    expect(checkpointsPayXp(6 * H)).toBe(true);
    expect(checkpointsPayXp(6 * H - 1)).toBe(false);
  });
});

describe('checkpoints', () => {
  it('checkpoint schedule per race length', () => {
    const amounts = (hours: number) => checkpointSchedule(hours * H).map((checkpoint) => checkpoint.xp);
    expect(checkpointSchedule(6 * H).map((checkpoint) => checkpoint.percent)).toEqual([10, 25, 50, 75, 90]);
    expect(amounts(6)).toEqual([60, 90, 150, 150, 150]);
    expect(amounts(8)).toEqual([80, 120, 200, 200, 200]);
    expect(amounts(10)).toEqual([120, 180, 300, 300, 300]);
    expect(amounts(12)).toEqual([120, 180, 300, 300, 300]);
    expect(amounts(18)).toEqual([180, 270, 450, 450, 450]);
    expect(amounts(24)).toEqual([300, 450, 750, 750, 750]);
    const total = (hours: number) => amounts(hours).reduce((sum, xp) => sum + xp, 0);
    expect([6, 8, 10, 18, 24].map(total)).toEqual([600, 800, 1_200, 1_800, 3_000]);
  });

  it('a 5-hour race switched on earns no checkpoint XP', () => {
    expect(checkpointSchedule(5 * H).map((checkpoint) => checkpoint.xp)).toEqual([0, 0, 0, 0, 0]);
    // Still listed, so the checkpoints can be shown and dated.
    expect(checkpointSchedule(5 * H)).toHaveLength(EXPEDITION_CONFIG.checkpoints.length);
  });

  it('checkpoint keys contain no amount', () => {
    expect(expeditionDedupeKey('race-1', 50)).toBe('expedition:race-1:50');
    for (const { xp } of checkpointSchedule(24 * H)) {
      expect(expeditionDedupeKey('race-1', 50)).not.toContain(`${xp}`);
    }
  });

  it('reaches a checkpoint only when the coverage does, in whole seconds', () => {
    // 50% of 10 hours is exactly five hours.
    expect(checkpointsSatisfied(5 * H - 1, 10 * H)).toEqual([10, 25]);
    expect(checkpointsSatisfied(5 * H, 10 * H)).toEqual([10, 25, 50]);
    expect(checkpointsSatisfied(10 * H, 10 * H)).toEqual([10, 25, 50, 75, 90]);
    expect(checkpointsSatisfied(0, 0)).toEqual([]);
  });

  it('judges any percentage the same way, listed or not', () => {
    // A checkpoint an earlier configuration listed is still judged by its own
    // percentage: 33% of 10 hours is 3h 18m, 11,880 seconds.
    expect(coverageReaches(11_880, 10 * H, 33)).toBe(true);
    expect(coverageReaches(11_879, 10 * H, 33)).toBe(false);
    expect(coverageReaches(0, 0, 10)).toBe(false);
  });
});

describe('the live figures', () => {
  inTimeZone(ZONES.london.zone, ZONES.london.offsets);

  it('reads an Expedition in progress from its replay', () => {
    const lm = race('lm', { hours: 24 });
    const first = stint(lm, '2026-06-13T21:00', { from: '0:00', to: '6:00' });
    const second = stint(lm, '2026-06-15T22:00', { from: '12:00', to: '14:00' });
    const history = replayRace(lm, [second, first]);
    // Its 10% checkpoint held at 250 XP, as an earlier schedule paid it.
    const figures = expeditionFigures(history, 1.5, localTime('2026-06-16T15:00'), new Map([[10, 250]]));

    expect(figures).toMatchObject({
      runtimeSec: 24 * H,
      coverageSec: 8 * H,
      completionPercentText: '33.3%',
      remainingTimelineSec: 16 * H,
      remainingRealSec: Math.round((16 * H) / 1.5),
      resumeAtSec: 6 * H,
      creditedSeconds: 8 * H,
      rewatchSeconds: 0,
      sessions: 2,
      startedAt: localTime('2026-06-13T15:00'),
      // From 15:00 on 13 June to 15:00 on 16 June.
      elapsedSeconds: 72 * H,
      storyCompletedAt: null,
    });
    expect(figures.checkpoints).toEqual([
      { percent: 10, xp: 250, reachedAt: localTime('2026-06-13T21:00'), sessionId: first.id, held: true },
      { percent: 25, xp: 450, reachedAt: localTime('2026-06-13T21:00'), sessionId: first.id, held: false },
      { percent: 50, xp: 750, reachedAt: null, sessionId: null, held: false },
      { percent: 75, xp: 750, reachedAt: null, sessionId: null, held: false },
      { percent: 90, xp: 750, reachedAt: null, sessionId: null, held: false },
    ]);
    expect(figures.fragments).toEqual({
      watched: [{ start: 0, end: 6 * H }, { start: 12 * H, end: 14 * H }],
      gaps: [{ start: 6 * H, end: 12 * H }, { start: 14 * H, end: 24 * H }],
      furthestSec: 14 * H,
    });
  });

  it('never reads 100% while any second is uncovered, and stops the clock at completion', () => {
    const r = race('r', { hours: 6 });
    const history = replayRace(r, [
      stint(r, '2026-06-13T21:00', { from: '0:00', to: '3:00' }),
      // Forty seconds short of the end: Story Complete, but not all of it.
      stint(r, '2026-06-14T21:00', { from: '3:00:00', to: '5:59:20' }),
    ]);
    const figures = expeditionFigures(history, 1, localTime('2026-07-01T12:00'));
    expect(history.storyCompletedAt).toEqual(localTime('2026-06-14T21:00'));
    expect(figures.completionPercentText).toBe('99.8%');
    expect(figures.elapsedSeconds).toBe(Math.round((localTime('2026-06-14T21:00').getTime() - localTime('2026-06-13T18:00').getTime()) / 1000));
  });

  it('shows what exists before the first stint', () => {
    const figures = expeditionFigures(replayRace(race('r', { hours: 12 }), []), 1, localTime('2026-07-01T12:00'));
    expect(figures).toMatchObject({ startedAt: null, elapsedSeconds: null, completionPercentText: '0%', remainingTimelineSec: 12 * H, sessions: 0 });
    expect(figures.checkpoints.every((checkpoint) => checkpoint.reachedAt === null)).toBe(true);
  });
});

describe('which checkpoint a stint reached', () => {
  it('reads a checkpoint from its key, and only a key of that race', () => {
    expect(checkpointOfKey('race-1', 'expedition:race-1:50')).toBe(50);
    expect(checkpointOfKey('race-1', 'expedition:race-10:50')).toBeNull();
    expect(checkpointOfKey('race-1', 'story-complete:race-1')).toBeNull();
    expect(checkpointOfKey('race-1', 'expedition:race-1:half')).toBeNull();
    expect(checkpointOfKey('race-1', null)).toBeNull();
  });

  it('names the checkpoints a stint crossed, and none for a re-watch', () => {
    const r = race('r', { hours: 10 });
    const first = stint(r, '2026-06-13T21:00', { from: '0:00', to: '3:00' });
    const again = stint(r, '2026-06-13T22:00', { from: '0:00', to: '3:00' });
    const on = stint(r, '2026-06-14T21:00', { from: '3:00', to: '9:00' });
    const history = replayRace(r, [first, again, on]);
    expect(checkpointsCrossedBy(history, first.id)).toEqual([10, 25]);
    expect(checkpointsCrossedBy(history, again.id)).toEqual([]);
    expect(checkpointsCrossedBy(history, on.id)).toEqual([50, 75, 90]);
    expect(checkpointsCrossedBy(history, 'not-a-stint')).toEqual([]);
  });

  it('says which checkpoint is next, and marks the ticks reached', () => {
    expect(nextCheckpoint(0, 24 * H)).toEqual({ percent: 10, xp: 300 });
    expect(nextCheckpoint(12 * H, 24 * H)).toEqual({ percent: 75, xp: 750 });
    expect(nextCheckpoint(22 * H, 24 * H)).toBeNull();
    expect(nextCheckpoint(3 * H, 5 * H)).toEqual({ percent: 75, xp: 0 });
    expect(checkpointTicks(6 * H, 24 * H)).toEqual([
      { percent: 10, reached: true }, { percent: 25, reached: true }, { percent: 50, reached: false },
      { percent: 75, reached: false }, { percent: 90, reached: false },
    ]);
  });
});

describe('the expedition timeline’s lanes', () => {
  const at = (start: number, end: number) => ({ startTimestampSec: start * H, endTimestampSec: end * H });

  it('keeps a straight viewing on one lane and puts re-watches on lanes of their own', () => {
    const straight = [at(0, 2), at(2, 4), at(4, 6)];
    expect(stintLanes(straight, 6)).toEqual({ lanes: [straight], hidden: 0 });

    const rewatch = at(1, 3);
    const again = at(1, 2);
    const later = at(6, 8);
    const { lanes, hidden } = stintLanes([...straight, rewatch, again, later], 6);
    expect(lanes).toEqual([[...straight, later], [rewatch], [again]]);
    expect(hidden).toBe(0);
  });

  it('folds whatever needs more lanes than the limit into a count', () => {
    const same = Array.from({ length: 9 }, () => at(0, 1));
    const { lanes, hidden } = stintLanes(same, EXPEDITION_SHAPE.stintLaneLimit);
    expect(lanes).toHaveLength(EXPEDITION_SHAPE.stintLaneLimit);
    expect(hidden).toBe(9 - EXPEDITION_SHAPE.stintLaneLimit);
  });
});

describe('the Expedition Summary', () => {
  inTimeZone(ZONES.london.zone, ZONES.london.offsets);

  const CHECKPOINT_XP = new Map([[10, 120], [25, 180], [50, 300], [75, 300], [90, 300]]);
  const NO_UNLOCKS = { source: 'reconstructed' as const, nodes: [], milestones: [], achievements: [] };

  function inputFor(history: ExpeditionSummaryInput['history'], timeline: ExpeditionSummaryInput['timeline']): ExpeditionSummaryInput {
    return {
      history,
      timeline,
      progression: computeRecordProgression(timeline, careerRecordOptions(1)),
      xp: { viewing: 14_400, rewatch: 0, storyComplete: 3_000 },
      checkpointXp: CHECKPOINT_XP,
      championshipMastery: null,
      unlocks: NO_UNLOCKS,
    };
  }

  it('stops at the stint that completed the story, and counts days across a change of the clocks', () => {
    // The clocks go forward at 01:00 on 29 March 2026 in London.
    const lm = race('lm', { hours: 10, name: '10 Hours of Summary', championshipName: 'WEC', eventKey: 'ten', eventName: 'The Ten', editionYear: 2026 });
    const a = stint(lm, '2026-03-28T22:00', { from: '0:00', to: '4:00' });
    const b = stint(lm, '2026-03-29T22:00', { from: '4:00', to: '8:00', speed: 2 });
    const c = stint(lm, '2026-03-30T01:00', { from: '8:00', to: '10:00' });
    // A re-watch of the finish, days later: part of the race, not of the journey.
    const d = stint(lm, '2026-04-02T21:00', { from: '9:00', to: '10:00' });
    const sessions = [d, c, b, a];
    const snapshot = buildExpeditionSummarySnapshot(inputFor(replayRace(lm, sessions), career([lm], sessions)));

    const started = localTime('2026-03-28T18:00');
    const completed = localTime('2026-03-30T01:00');
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      race: { id: 'lm', name: '10 Hours of Summary', championshipName: 'WEC', eventKey: 'ten', eventName: 'The Ten', editionYear: 2026, runtimeSec: 10 * H },
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      completingSessionId: c.id,
      creditedSeconds: 8 * H,
      uniqueCoverageSeconds: 10 * H,
      rewatchSeconds: 0,
      sessions: 3,
      calendarDays: 3,
      // Thirty-one hours on the wall clock, thirty that passed.
      elapsedSeconds: 30 * H,
      averageSessionSeconds: Math.round((8 * H) / 3),
      longestSessionSeconds: 4 * H,
      finalCompletionText: '100%',
      xp: { viewing: 14_400, rewatch: 0, storyComplete: 3_000, checkpoints: 1_200, total: 18_600 },
      checkpoints: [
        { percent: 10, reachedAt: a.watchedAt.toISOString(), xp: 120 },
        { percent: 25, reachedAt: a.watchedAt.toISOString(), xp: 180 },
        { percent: 50, reachedAt: b.watchedAt.toISOString(), xp: 300 },
        { percent: 75, reachedAt: b.watchedAt.toISOString(), xp: 300 },
        { percent: 90, reachedAt: c.watchedAt.toISOString(), xp: 300 },
      ],
      mastery: { championship: null, event: { name: 'The Ten', editionsExperienced: 1, editionsStoryComplete: 1 }, nodes: [] },
      unlocks: 'reconstructed',
    });
    expect(snapshot.records.map((record) => record.kind)).toEqual([
      'longest-session', 'longest-race-story-completed', 'fastest-long-race-completion', 'longest-start-to-finish',
    ]);
    expect(snapshot.records[1]).toEqual({ kind: 'longest-race-story-completed', label: 'Longest race completed', valueText: '10h 00m' });
    // A JSON round trip is the same snapshot, and the schema reads it back.
    const stored: unknown = JSON.parse(JSON.stringify(snapshot));
    expect(expeditionSummarySnapshotSchema.parse(stored)).toEqual(snapshot);
    expect(parseExpeditionSummarySnapshot({ ...(stored as object), schemaVersion: 2 })).toBeNull();
  });

  it('says where the event stood at the completion, not where it stands now', () => {
    const edition = (id: string, year: number) => race(id, { hours: 10, eventKey: 'ten', eventName: 'The Ten', editionYear: year });
    const before = edition('ten-2025', 2025);
    const now = edition('ten-2026', 2026);
    const after = edition('ten-2024', 2024);
    const sessions = [
      stint(before, '2026-03-01T21:00', { from: '0:00', to: '10:00' }),
      stint(now, '2026-03-10T21:00', { from: '0:00', to: '10:00' }),
      stint(after, '2026-04-10T21:00', { from: '0:00', to: '10:00' }),
    ];
    const timeline = career([before, now, after], sessions);
    expect(eventStandingAt(timeline, 'ten', localTime('2026-03-10T21:00'))).toEqual({ editionsExperienced: 2, editionsStoryComplete: 2 });
    const snapshot = buildExpeditionSummarySnapshot(inputFor(replayRace(now, sessions), timeline));
    expect(snapshot.mastery.event).toEqual({ name: 'The Ten', editionsExperienced: 2, editionsStoryComplete: 2 });
  });

  it('never makes the journey shorter than the time watched, however quickly the stints were logged', () => {
    const r = race('batched', { hours: 12 });
    const sessions = [
      stint(r, '2026-06-13T20:00', { from: '0:00', to: '4:00' }),
      stint(r, '2026-06-13T20:01', { from: '4:00', to: '8:00' }),
      stint(r, '2026-06-13T20:02', { from: '8:00', to: '12:00' }),
    ];
    const snapshot = buildExpeditionSummarySnapshot(inputFor(replayRace(r, sessions), career([r], sessions)));
    expect(snapshot.creditedSeconds).toBe(12 * H);
    expect(snapshot.elapsedSeconds).toBe(12 * H);
    expect(snapshot.calendarDays).toBe(1);
  });

  it('is only ever built for a story that is complete', () => {
    const r = race('open', { hours: 12 });
    const sessions = [stint(r, '2026-06-13T20:00', { from: '0:00', to: '4:00' })];
    expect(() => buildExpeditionSummarySnapshot(inputFor(replayRace(r, sessions), career([r], sessions)))).toThrow();
  });
});
