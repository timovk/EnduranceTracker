/**
 * The look every chart shares, and the two rules every chart keeps.
 *
 * Colours are the theme's own tokens, so a chart follows the accent the user
 * picked; the second and third series are theme variables too (`--chart-2`,
 * `--chart-3` in `globals.css`), set per theme so neither is ever the accent's
 * colour. The grid and axis greys are the instrument panel's hairlines and
 * dim ink.
 *
 * THE MOTION RULE. No chart passes `isAnimationActive={true}`. Recharts'
 * default, `'auto'`, animates only when the user has not asked for reduced
 * motion (`recharts/lib/animation/JavascriptAnimate.js`); forcing it on would
 * animate for everyone. Leave the prop out.
 *
 * THE DECORATION RULE. A chart is drawn only when it has something to show:
 * below `CAREER_STATS_SHAPE.chartMinimumPoints` points its figures are said in
 * a sentence instead (`ChartFrame`). A line through two points says nothing a
 * sentence would not say better.
 */

import { CAREER_STATS_SHAPE } from '@/lib/config';

export const CHART_COLORS = {
  /** The series a chart is about: the user's accent. */
  primary: 'var(--accent)',
  /** A second series beside it: azure, or gold where the accent is azure. */
  secondary: 'var(--chart-2)',
  /** A third, where a chart has one: verde, or violet where the accent is green. */
  tertiary: 'var(--chart-3)',
  grid: '#222c37',
  axis: '#64717e',
  /** The hover band behind a bar, and the hover line across a line chart. */
  cursorFill: 'rgba(255,255,255,0.03)',
  cursorStroke: '#31404e',
} as const;

/** Shared by every axis: small, dim, no ticks or axis line — the grid does that work. */
export const AXIS_PROPS = {
  stroke: CHART_COLORS.axis,
  fontSize: 10,
  tickLine: false,
  axisLine: false,
} as const;

/** Whether a chart of this many points is worth drawing. */
export function hasEnoughPoints(points: number): boolean {
  return points >= CAREER_STATS_SHAPE.chartMinimumPoints;
}
