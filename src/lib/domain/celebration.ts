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

/** How loudly a whole stint is celebrated (`SessionOutcome.celebrate`). */
export type CelebrationLevel = 'QUIET' | 'NOTABLE' | 'SPECTACULAR';

/** How loudly one Career Milestone asks to be celebrated (`CareerMilestoneDef.celebration`). */
export type MilestoneCelebration = 'none' | 'notable' | 'spectacular';

/** What this module needs to know about a milestone a stint reached. */
export interface CelebratedMilestone {
  title: string;
  celebration: MilestoneCelebration;
}

const LEVEL_RANK: Readonly<Record<CelebrationLevel, number>> = { QUIET: 0, NOTABLE: 1, SPECTACULAR: 2 };
const MILESTONE_RANK: Readonly<Record<MilestoneCelebration, number>> = { none: 0, notable: 1, spectacular: 2 };

/** The loudest celebration among a stint's career milestones; `none` when there are none. */
export function highestMilestoneCelebration(
  milestones: readonly Pick<CelebratedMilestone, 'celebration'>[],
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

export interface CelebrationView<M extends CelebratedMilestone> {
  level: CelebrationLevel;
  /** Milestones drawn as highlighted blocks, loudest first, in catalogue order otherwise. */
  highlighted: M[];
  /** The summary's heading. */
  headline: string;
}

/**
 * Everything the stint summary decides about celebrating.
 *
 *   - The level is the engine's, raised to what the stint's milestones ask
 *     for (a summary rebuilt from an older engine's outcome still honours
 *     them).
 *   - A milestone that celebrates at all is highlighted. The very objects of
 *     the outcome are returned, so the summary can tell them from the ones it
 *     lists as rows.
 *   - The heading is "Expedition complete" when the stint completed an
 *     Expedition's story, "Story Complete" when it finished any other story —
 *     that is the stint's own moment — and otherwise the loudest highlighted
 *     milestone's title, or the ordinary heading chosen by stint length.
 */
export function celebrationView<M extends CelebratedMilestone>(outcome: {
  celebrate: CelebrationLevel;
  careerMilestones: readonly M[];
  storyCompleted: boolean;
  heading: string;
  expedition?: { completed: boolean } | null;
}): CelebrationView<M> {
  const highlighted = outcome.careerMilestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(({ milestone }) => milestone.celebration !== 'none')
    .sort((a, b) =>
      MILESTONE_RANK[b.milestone.celebration] - MILESTONE_RANK[a.milestone.celebration] || a.index - b.index)
    .map(({ milestone }) => milestone);

  const level = louderLevel(outcome.celebrate, levelForMilestone(highestMilestoneCelebration(highlighted)));
  const headline = outcome.expedition?.completed
    ? 'Expedition complete'
    : outcome.storyCompleted
      ? 'Story Complete'
      : highlighted[0]?.title ?? outcome.heading;

  return { level, highlighted, headline };
}
