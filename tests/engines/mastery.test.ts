/**
 * Mastery metrics.
 *
 * The pure scope computations: how many stories, hours, seasons and editions a
 * championship or recurring event has to its name. Consecutive editions in
 * particular is the sort of thing that is easy to get subtly wrong.
 */

import { describe, expect, it } from 'vitest';
import {
  computeChampionshipMetrics, computeEventMetrics,
  type MasteryRaceInput, type MasterySeasonInput,
} from '@/lib/engines/mastery-engine';
import { MASTERY_CONFIG } from '@/lib/config';
import { longestRun } from '@/lib/engines/metrics';

const H = 3600;

function masteryRace(overrides: Partial<MasteryRaceInput> = {}): MasteryRaceInput {
  const storyComplete = overrides.storyComplete ?? true;
  return {
    id: 'r1',
    championshipId: 'c1',
    seasonId: 's1',
    iconicKey: null,
    circuitSlug: 'circuit-one',
    runtimeSec: 6 * H,
    realViewingSec: 6 * H,
    timelineWatchedSec: 6 * H,
    isMajorEvent: false,
    storyComplete,
    completed: storyComplete,
    year: 2026,
    ...overrides,
  };
}

function masterySeason(overrides: Partial<MasterySeasonInput> = {}): MasterySeasonInput {
  return { id: 's1', championshipId: 'c1', year: 2026, plannedRaceCount: null, ...overrides };
}

describe('mastery configuration', () => {
  it('has unique node keys in every template set', () => {
    for (const [name, nodes] of Object.entries({
      championship: MASTERY_CONFIG.championshipNodes,
      raceEvent: MASTERY_CONFIG.raceEventNodes,
      global: MASTERY_CONFIG.globalNodes,
    })) {
      expect(new Set(nodes.map((n) => n.key)).size, name).toBe(nodes.length);
    }
  });

  it('has ascending thresholds within a metric', () => {
    for (const nodes of [MASTERY_CONFIG.championshipNodes, MASTERY_CONFIG.globalNodes]) {
      const byMetric = new Map<string, number[]>();
      for (const node of nodes) {
        byMetric.set(node.metric, [...(byMetric.get(node.metric) ?? []), node.threshold]);
      }
      for (const [metric, thresholds] of byMetric) {
        const sorted = [...thresholds].sort((a, b) => a - b);
        expect(thresholds, metric).toEqual(sorted);
      }
    }
  });

  it('pays more for later tiers', () => {
    const nodes = [...MASTERY_CONFIG.championshipNodes];
    const tier1 = nodes.filter((n) => n.tier <= 2).reduce((s, n) => s + n.xpReward, 0) / nodes.filter((n) => n.tier <= 2).length;
    const tier7 = nodes.filter((n) => n.tier >= 6).reduce((s, n) => s + n.xpReward, 0) / nodes.filter((n) => n.tier >= 6).length;
    expect(tier7).toBeGreaterThan(tier1);
  });

  it('gives every championship a long-term tree, not a short one', () => {
    expect(MASTERY_CONFIG.championshipNodes.length).toBeGreaterThanOrEqual(12);
    expect(MASTERY_CONFIG.raceEventNodes.length).toBeGreaterThanOrEqual(6);
    expect(MASTERY_CONFIG.globalNodes.length).toBeGreaterThanOrEqual(8);
  });
});

describe('computeChampionshipMetrics', () => {
  it('counts story completions, not merely started races', () => {
    const metrics = computeChampionshipMetrics(
      [
        masteryRace({ id: 'a', storyComplete: true }),
        masteryRace({ id: 'b', storyComplete: false }),
        masteryRace({ id: 'c', storyComplete: true }),
      ],
      [],
    );
    expect(metrics.storyCompletes).toBe(2);
  });

  it('measures real viewing hours, including time on unfinished races', () => {
    const metrics = computeChampionshipMetrics(
      [
        masteryRace({ id: 'a', realViewingSec: 10 * H }),
        masteryRace({ id: 'b', realViewingSec: 5 * H, storyComplete: false }),
      ],
      [],
    );
    expect(metrics.realHours).toBeCloseTo(15, 1);
  });

  it('counts long races by their runtime', () => {
    const metrics = computeChampionshipMetrics(
      [
        masteryRace({ id: 'a', runtimeSec: 24 * H }),
        masteryRace({ id: 'b', runtimeSec: 12 * H }),
        masteryRace({ id: 'c', runtimeSec: 6 * H }),
        masteryRace({ id: 'd', runtimeSec: 12 * H, storyComplete: false }),
      ],
      [],
    );
    expect(metrics.stories24h).toBe(1);
    expect(metrics.stories12h).toBe(2); // the 24h race is also 12h or more
    expect(metrics.storyCompletes).toBe(3);
  });

  it('counts distinct circuits, not races', () => {
    const metrics = computeChampionshipMetrics(
      [
        masteryRace({ id: 'a', circuitSlug: 'spa' }),
        masteryRace({ id: 'b', circuitSlug: 'spa' }),
        masteryRace({ id: 'c', circuitSlug: 'fuji' }),
        masteryRace({ id: 'd', circuitSlug: null }),
      ],
      [masterySeason()],
    );
    expect(metrics.circuits).toBe(2);
  });

  it('counts major events', () => {
    const metrics = computeChampionshipMetrics(
      [
        masteryRace({ id: 'a', isMajorEvent: true }),
        masteryRace({ id: 'b', isMajorEvent: true, storyComplete: false }),
        masteryRace({ id: 'c', isMajorEvent: false }),
      ],
      [],
    );
    expect(metrics.majorEventStories).toBe(1);
  });

  it('counts a season complete only when every race in it is finished', () => {
    const metrics = computeChampionshipMetrics(
      [
        // s1: both races finished.
        masteryRace({ id: 'a', seasonId: 's1' }),
        masteryRace({ id: 'b', seasonId: 's1' }),
        // s2: one of two still going.
        masteryRace({ id: 'c', seasonId: 's2' }),
        masteryRace({ id: 'd', seasonId: 's2', storyComplete: false, completed: false }),
      ],
      [masterySeason({ id: 's1' }), masterySeason({ id: 's2' })],
    );
    expect(metrics.seasonsComplete).toBe(1);
  });

  it('respects the user\u2019s own declaration of a season\u2019s length', () => {
    // Two races filed, both finished — but the user says the season has eight.
    // It is not complete, and nothing should claim otherwise.
    const metrics = computeChampionshipMetrics(
      [masteryRace({ id: 'a', seasonId: 's1' }), masteryRace({ id: 'b', seasonId: 's1' })],
      [masterySeason({ id: 's1', plannedRaceCount: 8 })],
    );
    expect(metrics.seasonsComplete).toBe(0);
  });

  it('treats a season with no declared length as "whatever I have added"', () => {
    const metrics = computeChampionshipMetrics(
      [masteryRace({ id: 'a', seasonId: 's1' }), masteryRace({ id: 'b', seasonId: 's1' })],
      [masterySeason({ id: 's1', plannedRaceCount: null })],
    );
    expect(metrics.seasonsComplete).toBe(1);
  });

  it('returns zeroes for an empty scope', () => {
    const metrics = computeChampionshipMetrics([], []);
    expect(metrics.storyCompletes).toBe(0);
    expect(metrics.realHours).toBe(0);
    expect(metrics.seasonsComplete).toBe(0);
    expect(metrics.circuits).toBe(0);
  });

  it('never returns a negative figure', () => {
    const metrics = computeChampionshipMetrics(
      [masteryRace({ realViewingSec: -100, runtimeSec: -5 })],
      [],
    );
    for (const value of Object.values(metrics)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('computeEventMetrics — recurring events build a lifetime history', () => {
  /** Editions are grouped by `iconicKey`, so every edition must carry one. */
  const edition = (overrides: Partial<MasteryRaceInput>): MasteryRaceInput =>
    masteryRace({ iconicKey: 'le-mans-24', ...overrides });

  it('counts editions story complete', () => {
    const metrics = computeEventMetrics([
      edition({ id: 'a', year: 2024 }),
      edition({ id: 'b', year: 2025 }),
      edition({ id: 'c', year: 2026, storyComplete: false }),
    ]);
    expect(metrics.editionsStoryComplete).toBe(2);
  });

  it('finds the longest run of consecutive editions', () => {
    const metrics = computeEventMetrics([
      edition({ id: 'a', year: 2018 }),
      edition({ id: 'b', year: 2020 }),
      edition({ id: 'c', year: 2021 }),
      edition({ id: 'd', year: 2022 }),
      edition({ id: 'e', year: 2025 }),
    ]);
    expect(metrics.consecutiveEditions).toBe(3);
  });

  it('does not count an unfinished edition towards a run', () => {
    const metrics = computeEventMetrics([
      edition({ id: 'a', year: 2024 }),
      edition({ id: 'b', year: 2025, storyComplete: false }),
      edition({ id: 'c', year: 2026 }),
    ]);
    expect(metrics.consecutiveEditions).toBe(1);
  });

  it('treats two editions in the same year as one', () => {
    const metrics = computeEventMetrics([
      edition({ id: 'a', year: 2026 }),
      edition({ id: 'b', year: 2026 }),
    ]);
    expect(metrics.consecutiveEditions).toBe(1);
  });

  it('handles an edition with no year recorded', () => {
    const metrics = computeEventMetrics([
      edition({ id: 'a', year: null }),
      edition({ id: 'b', year: 2026 }),
    ]);
    expect(metrics.editionsStoryComplete).toBe(2);
    expect(metrics.consecutiveEditions).toBe(1);
  });

  it('accumulates hours across every edition', () => {
    const metrics = computeEventMetrics([
      edition({ id: 'a', year: 2025, realViewingSec: 20 * H }),
      edition({ id: 'b', year: 2026, realViewingSec: 18 * H }),
    ]);
    expect(metrics.realHours).toBeCloseTo(38, 1);
  });

  it('returns zeroes for no editions', () => {
    const metrics = computeEventMetrics([]);
    expect(metrics.editionsStoryComplete).toBe(0);
    expect(metrics.consecutiveEditions).toBe(0);
  });
});

describe('longestRun', () => {
  it('handles the cases the event metrics depend on', () => {
    expect(longestRun([])).toBe(0);
    expect(longestRun([2026])).toBe(1);
    expect(longestRun([2024, 2025, 2026])).toBe(3);
    expect(longestRun([2026, 2024, 2025])).toBe(3);
    expect(longestRun([2020, 2022, 2024])).toBe(1);
    expect(longestRun([2026, 2026, 2026])).toBe(1);
    expect(longestRun([2018, 2019, 2021, 2022, 2023, 2024])).toBe(4);
  });
});
