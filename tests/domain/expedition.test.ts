/**
 * Race Expeditions: which races are one, what their checkpoints pay, and the
 * live figures an Expedition shows.
 */

import { describe, expect, it } from 'vitest';
import { EXPEDITION_CONFIG, EXPEDITION_SHAPE } from '@/lib/config';
import {
  checkpointSchedule, checkpointsPayXp, checkpointsSatisfied, expeditionDedupeKey, expeditionFigures, isExpedition,
} from '@/lib/domain/expedition';
import { replayRace } from '@/lib/domain/career-timeline';
import { localTime, race, stint } from '../helpers/timeline-fixture';
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
});

describe('the live figures', () => {
  inTimeZone(ZONES.london.zone, ZONES.london.offsets);

  it('reads an Expedition in progress from its replay', () => {
    const lm = race('lm', { hours: 24 });
    const first = stint(lm, '2026-06-13T21:00', { from: '0:00', to: '6:00' });
    const second = stint(lm, '2026-06-15T22:00', { from: '12:00', to: '14:00' });
    const history = replayRace(lm, [second, first]);
    const figures = expeditionFigures(history, 1.5, localTime('2026-06-16T15:00'), new Set([10]));

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
      { percent: 10, xp: 300, reachedAt: localTime('2026-06-13T21:00'), sessionId: first.id, held: true },
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
