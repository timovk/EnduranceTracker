/**
 * The stint lanes of the Expedition timeline (0.4.0).
 *
 * Kept apart from `domain/expedition`, which holds the summary's schema, so
 * the timeline component — drawn on every race card — carries none of it into
 * the browser.
 *
 * Pure.
 */

/**
 * Stints placed on lanes for the expedition timeline: each on the first lane
 * where it overlaps no stint already there, so a re-watched stretch sits on a
 * row of its own under the first viewing of it. Stints are taken in the order
 * given (canonical), and those that would need more than `laneLimit` lanes
 * are counted in `hidden` rather than drawn.
 */
export function stintLanes<T extends { startTimestampSec: number; endTimestampSec: number }>(
  stints: readonly T[],
  laneLimit: number,
): { lanes: T[][]; hidden: number } {
  const lanes: T[][] = [];
  let hidden = 0;
  for (const stint of stints) {
    const fits = (lane: readonly T[]) => lane.every((other) =>
      stint.endTimestampSec <= other.startTimestampSec || stint.startTimestampSec >= other.endTimestampSec);
    const lane = lanes.find(fits);
    if (lane !== undefined) lane.push(stint);
    else if (lanes.length < laneLimit) lanes.push([stint]);
    else hidden += 1;
  }
  return { lanes, hidden };
}

