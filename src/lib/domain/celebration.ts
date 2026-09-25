/**
 * How loudly a stint summary celebrates (0.4.0).
 *
 * The engine decides the level (`chooseCelebration`); this decides what the
 * summary does with it once Career Milestones are in play: which milestones
 * are drawn as highlighted blocks rather than list rows, and what the heading
 * says. It is pure, so the stint summary and the tests share one answer.
 *
 * Celebration stays graded. Most milestones are listed and nothing more; a
 * `notable` one lifts an ordinary stint to NOTABLE, a `spectacular` one to
 * the full treatment. Nothing here ever lowers a level the engine chose.
 */

import type { CareerMilestoneUnlock, SessionOutcome } from '@/lib/engines/contracts';

export type CelebrationLevel = SessionOutcome['celebrate'];
export type MilestoneCelebration = CareerMilestoneUnlock['celebration'];

const LEVEL_RANK: Readonly<Record<CelebrationLevel, number>> = { QUIET: 0, NOTABLE: 1, SPECTACULAR: 2 };
const MILESTONE_RANK: Readonly<Record<MilestoneCelebration, number>> = { none: 0, notable: 1, spectacular: 2 };

/** The loudest celebration among a stint's career milestones; `none` when there are none. */
export function highestMilestoneCelebration(
  milestones: readonly Pick<CareerMilestoneUnlock, 'celebration'>[],
): MilestoneCelebration {
  let highest: MilestoneCelebration = 'none';
  for (const milestone of milestones) {
    if (MILESTONE_RANK[milestone.celebration] > MILESTONE_RANK[highest]) highest = milestone.celebration;
  }
  return highest;
}

/** The level a milestone celebration asks for at least. */
export function levelForMilestone(celebration: MilestoneCelebration): CelebrationLevel {
  if (celebration === 'spectacular') return 'SPECTACULAR';
  if (celebration === 'notable') return 'NOTABLE';
  return 'QUIET';
}

/** The louder of two levels. */
export function louderLevel(a: CelebrationLevel, b: CelebrationLevel): CelebrationLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export interface CelebrationView {
  level: CelebrationLevel;
  /** Milestones drawn as highlighted blocks, loudest first, in catalogue order otherwise. */
  highlighted: CareerMilestoneUnlock[];
  /** The summary's heading. */
  headline: string;
}

/**
 * Everything the stint summary decides about celebrating.
 *
 *   - The level is the engine's, raised to what the stint's milestones ask
 *     for (a summary rebuilt from an older engine's outcome still honours
 *     them).
 *   - A milestone that celebrates at all is highlighted.
 *   - The heading is "Story Complete" when the stint finished a story — that
 *     is the stint's own moment — and otherwise the loudest highlighted
 *     milestone's title, or the ordinary heading chosen by stint length.
 */
export function celebrationView(
  outcome: Pick<SessionOutcome, 'celebrate' | 'careerMilestones' | 'storyCompleted' | 'heading'>,
): CelebrationView {
  const highlighted = outcome.careerMilestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(({ milestone }) => milestone.celebration !== 'none')
    .sort((a, b) =>
      MILESTONE_RANK[b.milestone.celebration] - MILESTONE_RANK[a.milestone.celebration] || a.index - b.index)
    .map(({ milestone }) => milestone);

  const level = louderLevel(outcome.celebrate, levelForMilestone(highestMilestoneCelebration(highlighted)));
  const headline = outcome.storyCompleted
    ? 'Story Complete'
    : highlighted[0]?.title ?? outcome.heading;

  return { level, highlighted, headline };
}
