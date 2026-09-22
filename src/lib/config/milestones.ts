/**
 * Milestones: numerical lifetime progression, as opposed to the discrete
 * accomplishments in `achievements.ts`.
 *
 * A label is rendered as "<count> <label>" and singularised on its final word,
 * so every label is written plural and ends with its noun — "Completed races",
 * not "Races completed", which would read "1 races completed".
 *
 * Thresholds deliberately extend decades into the future. A milestone is only
 * ever reached, never lost, and reaching one is the only thing that can
 * happen to it.
 */

export interface MilestoneDef {
  metric: string;
  label: string;
  unit: string;
  /** Formatter hint for the UI. */
  format: 'number' | 'hours' | 'days';
  thresholds: readonly number[];
  /** Career XP granted per threshold crossed, scaled by index. */
  xpPerThreshold: number;
  iconKey: string;
}

const HOUR_STEPS = [1, 5, 10, 25, 50, 100, 200, 336, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 7_500, 10_000, 15_000, 25_000, 50_000] as const;
const COUNT_STEPS = [1, 5, 10, 25, 50, 100, 200, 350, 500, 750, 1_000, 2_000, 5_000] as const;
const SMALL_STEPS = [1, 2, 3, 5, 8, 12, 20, 30, 50, 75, 100] as const;

export const MILESTONES: readonly MilestoneDef[] = [
  { metric: 'realHours', label: 'Real viewing hours', unit: 'h', format: 'hours', thresholds: HOUR_STEPS, xpPerThreshold: 1_000, iconKey: 'gauge' },
  { metric: 'timelineHours', label: 'Race timeline hours', unit: 'h', format: 'hours', thresholds: HOUR_STEPS, xpPerThreshold: 750, iconKey: 'film' },
  { metric: 'racesCompleted', label: 'Completed races', unit: '', format: 'number', thresholds: COUNT_STEPS, xpPerThreshold: 1_200, iconKey: 'flag' },
  { metric: 'storyCompletes', label: 'Story Complete races', unit: '', format: 'number', thresholds: COUNT_STEPS, xpPerThreshold: 1_800, iconKey: 'book' },
  { metric: 'championshipsCompleted', label: 'Championships', unit: '', format: 'number', thresholds: SMALL_STEPS, xpPerThreshold: 2_500, iconKey: 'grid' },
  { metric: 'seasonsCompleted', label: 'Completed seasons', unit: '', format: 'number', thresholds: SMALL_STEPS, xpPerThreshold: 4_000, iconKey: 'layers' },
  { metric: 'circuits', label: 'Circuits', unit: '', format: 'number', thresholds: [1, 3, 5, 10, 15, 25, 40, 60, 80, 100], xpPerThreshold: 2_000, iconKey: 'globe' },
  { metric: 'countries', label: 'Countries', unit: '', format: 'number', thresholds: [1, 3, 5, 8, 12, 20, 30, 45], xpPerThreshold: 2_000, iconKey: 'map' },
  { metric: 'majorEventStories', label: 'Completed major events', unit: '', format: 'number', thresholds: SMALL_STEPS, xpPerThreshold: 3_000, iconKey: 'star' },
  { metric: 'stories24h', label: 'Completed 24-hour races', unit: '', format: 'number', thresholds: [1, 2, 3, 5, 8, 12, 20, 30, 50], xpPerThreshold: 6_000, iconKey: 'clock' },
  { metric: 'stories12h', label: 'Completed 12-hour races', unit: '', format: 'number', thresholds: [1, 2, 3, 5, 10, 15, 25, 40, 60], xpPerThreshold: 3_500, iconKey: 'clock' },
  { metric: 'sessions', label: 'Viewing sessions', unit: '', format: 'number', thresholds: [1, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000], xpPerThreshold: 900, iconKey: 'list' },
  { metric: 'careerXpMillions', label: 'Career XP (millions)', unit: 'M', format: 'number', thresholds: [1, 2, 5, 10, 25, 50, 100, 250, 500], xpPerThreshold: 10_000, iconKey: 'zap' },
  { metric: 'level', label: 'Career level', unit: '', format: 'number', thresholds: [5, 10, 20, 25, 50, 75, 100, 150, 200, 250, 400, 500, 750, 1_000], xpPerThreshold: 2_500, iconKey: 'chevron' },
] as const;
