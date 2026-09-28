/**
 * Figures drawn by components, checked as the server draws them (0.4.0
 * review fixes): coverage on a library card, and the Story Complete dots the
 * Chronicle's month chart carries under its own month labels.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkedTick, MAX_MARKS } from '@/components/charts/monthly-bars';
import { RaceCard, type RaceCardData } from '@/components/races/race-card';

const H = 3600;

describe('a race card in the library', () => {
  function card(coverageSec: number, variant?: 'classic' | 'timing'): string {
    const race: RaceCardData = {
      id: 'r', name: '24 Hours of Le Mans', championshipName: null, championshipColor: null, seasonYear: null,
      circuit: null, country: null, raceDate: null, runtimeSec: 24 * H, coverageSec, realViewingSec: coverageSec,
      sessionCount: 1, status: 'WATCHING', priority: 'NORMAL', excitement: 3, isMajorEvent: false, isExpedition: true,
      storyComplete: coverageSec >= 24 * H - 120, intervals: [{ start: 0, end: coverageSec }],
    };
    return renderToStaticMarkup(createElement(RaceCard, { race, variant, preview: true }))
      .replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  }

  it('never reads 100% while 30 seconds are still to watch', () => {
    expect(card(24 * H - 30)).toContain('|99%|');
    expect(card(24 * H - 30, 'timing')).toContain('|099.9%|');
    expect(card(24 * H)).toContain('|100%|');
    expect(card(24 * H, 'timing')).toContain('|100.0%|');
    expect(card(12 * H + 60)).toContain('|50%|');
  });
});

describe('the marks under a month\'s label', () => {
  const data = [{ label: 'Feb', full: 'February 2026', n: 0 }, { label: 'Mar', full: 'March 2026', n: 4 }, { label: 'Apr', full: 'April 2026', n: 9 }];
  const marks = { count: (row: (typeof data)[number]) => row.n, title: (row: (typeof data)[number], count: number) => `${row.full}: ${count} complete` };

  function tick(label: string, x: number): string {
    return renderToStaticMarkup(createElement('svg', null, createElement(MarkedTick<(typeof data)[number]>, {
      x, y: 200, fill: '#64717e', payload: { value: label, coordinate: x, index: 0, offset: 0 }, data, marks,
    })));
  }

  const circles = (svg: string) => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);

  it('draws them centred on the tick, so each sits under its own month\'s bars', () => {
    const march = tick('Mar', 120);
    expect(march).toContain('>Mar</tspan>');
    expect(march).toContain('<title>March 2026: 4 complete</title>');
    const dots = circles(march);
    expect(dots).toHaveLength(4);
    // Three in the first row, centred on x = 120; the fourth alone, under it.
    expect(dots.map(([cx]) => cx)).toEqual([113.5, 120, 126.5, 120]);
    expect(new Set(dots.slice(0, 3).map(([, cy]) => cy)).size).toBe(1);
    expect(dots[3]![1]).toBeGreaterThan(dots[0]![1]);
  });

  it('draws at most six, and says how many there were', () => {
    const april = tick('Apr', 160);
    expect(circles(april)).toHaveLength(MAX_MARKS);
    expect(april).toContain('<title>April 2026: 9 complete</title>');
  });

  it('draws only the label for a month without any', () => {
    const february = tick('Feb', 80);
    expect(february).toContain('>Feb</tspan>');
    expect(circles(february)).toHaveLength(0);
    expect(february).not.toContain('<title>');
  });
});
