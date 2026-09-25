/**
 * Career Milestones: the permanent moments of a career (0.4.0).
 *
 * This is the catalogue the Career Milestones page is built from. It is an
 * upgrade of the lifetime ladders in `milestones.ts`, not a second system:
 * most rows are rungs those ladders already reach and pay (`owner: 'ladder'`),
 * shown here with the exact date they happened. Only the rows marked
 * `owner: 'career'` are new, and they are written and paid by
 * `syncCareerMilestones`.
 *
 * One moment, one payer. A new row that would pay for something another system
 * already pays — the first stint, the 2,500th hour, an event's fifth edition —
 * pays 0 XP and says who does pay it (`alsoPaidBy`). The tests in
 * `tests/domain/config.test.ts` hold the catalogue to that:
 *
 *   - every ladder row is a real rung of `MILESTONES`;
 *   - no career row is, so the two can never share a dedupe key;
 *   - a career row pays 0 XP exactly when it names who pays instead;
 *   - no dedupe key carries a configurable number, so a re-balance can never
 *     pay a moment a second time.
 *
 * Every row is written once and never taken back, whatever later happens to
 * the stints behind it.
 */

import { BUDGET_CONFIG } from './economy';

export type CareerMilestoneGroup = 'firsts' | 'stories' | 'hours' | 'races' | 'years' | 'events';

export type CareerMilestoneMetric =
  | 'racesStarted' | 'racesExperienced' | 'storyCompletes' | 'stories6h' | 'stories12h' | 'stories24h'
  | 'realHours' | 'realHoursYear' | 'eventEditions';

export interface CareerMilestoneDef {
  /** Stable, never reused. */
  id: string;
  group: CareerMilestoneGroup;
  /** May hold `{year}`, filled by `careerMilestoneTitle`. */
  title: string;
  description: string;
  /** `MilestoneProgress.metric`; `realHoursYear` rows are stored as `realHoursYear:<year>`. */
  metric: CareerMilestoneMetric;
  /** `'annualHours'` reads `BUDGET_CONFIG.annualHours`, so the figure lives in one place. */
  threshold: number | 'annualHours';
  kind: 'time' | 'count';
  /** `ladder` = an existing `MILESTONES` rung, created and paid by `syncMilestones`. */
  owner: 'ladder' | 'career';
  /** Paid by `syncCareerMilestones` when `owner === 'career'`; 0 = recorded only. */
  xp: number;
  /** Why `xp` is 0: whoever already pays this moment, in words. */
  alsoPaidBy: readonly string[];
  /** Hall of Fame entries the milestone links to. Nothing is minted from here. */
  hallOfFameKeys: readonly string[];
  /** `none` = listed in the stint summary only. */
  celebration: 'none' | 'notable' | 'spectacular';
}

/** Number words for the year rung's title, so it reads as prose. */
const WEEK_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;

/**
 * "two full weeks of racing" for the plan's hours, worked out rather than
 * written down, so the title stays true if the annual plan is re-balanced.
 */
function planSpan(hours: number): string {
  const weeks = hours / (7 * 24);
  if (Number.isInteger(weeks) && weeks >= 1 && weeks < WEEK_WORDS.length) {
    return `${WEEK_WORDS[weeks]} full ${weeks === 1 ? 'week' : 'weeks'} of racing`;
  }
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days.toLocaleString('en-GB')} days of racing, end to end`;
}

const ANNUAL = BUDGET_CONFIG.annualHours;

export const CAREER_MILESTONES: readonly CareerMilestoneDef[] = [
  // -- Firsts ---------------------------------------------------------------
  {
    id: 'first-race-started', group: 'firsts', title: 'First race started',
    description: 'The first stint of your first race.',
    metric: 'racesStarted', threshold: 1, kind: 'count', owner: 'career', xp: 0,
    // The same instant as the first stint, which both of these already pay.
    alsoPaidBy: ['The Green Flag achievement', 'The first viewing-session rung'],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'first-race-completed', group: 'firsts', title: 'First complete race story',
    description: 'Every minute of a race watched. Here a race is completed when its story is.',
    metric: 'storyCompletes', threshold: 1, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['first:story-complete', 'first:race-completed'], celebration: 'notable',
  },
  {
    id: 'first-6h', group: 'firsts', title: 'First 6-hour race completed',
    description: 'The whole story of a race of six hours or more.',
    metric: 'stories6h', threshold: 1, kind: 'count', owner: 'career', xp: 500, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'first-12h', group: 'firsts', title: 'First 12-hour race completed',
    description: 'The whole story of a race of twelve hours or more.',
    metric: 'stories12h', threshold: 1, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['first:race-12h'], celebration: 'notable',
  },
  {
    // The stint is already SPECTACULAR through the long-haul Story Complete
    // rule, so the milestone itself only needs to be notable.
    id: 'first-24h', group: 'firsts', title: 'First 24-hour race completed',
    description: 'The whole story of a 24-hour race, night and all.',
    metric: 'stories24h', threshold: 1, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['first:race-24h'], celebration: 'notable',
  },

  // -- Complete race stories ------------------------------------------------
  {
    id: 'stories-10', group: 'stories', title: '10 complete race stories',
    description: 'Ten races watched from start to finish.',
    metric: 'storyCompletes', threshold: 10, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['milestone:stories:10'], celebration: 'none',
  },
  {
    id: 'stories-25', group: 'stories', title: '25 complete race stories',
    description: 'Twenty-five races watched from start to finish.',
    metric: 'storyCompletes', threshold: 25, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'stories-50', group: 'stories', title: '50 complete race stories',
    description: 'Fifty races watched from start to finish.',
    metric: 'storyCompletes', threshold: 50, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['milestone:stories:50'], celebration: 'notable',
  },
  {
    id: 'stories-100', group: 'stories', title: '100 complete race stories',
    description: 'A hundred races watched from start to finish.',
    metric: 'storyCompletes', threshold: 100, kind: 'count', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['milestone:stories:100'], celebration: 'spectacular',
  },

  // -- Career hours -----------------------------------------------------------
  // Credited hours, counted the way XP counts them, so very slow playback
  // cannot bring one forward.
  {
    id: 'hours-100', group: 'hours', title: '100 career hours',
    description: 'A hundred hours of endurance racing.',
    metric: 'realHours', threshold: 100, kind: 'time', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['milestone:real-hours:100'], celebration: 'none',
  },
  {
    // Not a rung of the hours ladder, so it is new and pays its own modest amount.
    id: 'hours-250', group: 'hours', title: '250 career hours',
    description: 'Two hundred and fifty hours of endurance racing.',
    metric: 'realHours', threshold: 250, kind: 'time', owner: 'career', xp: 1_000, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'hours-500', group: 'hours', title: '500 career hours',
    description: 'Five hundred hours of endurance racing.',
    metric: 'realHours', threshold: 500, kind: 'time', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['milestone:real-hours:500'], celebration: 'notable',
  },
  {
    id: 'hours-1000', group: 'hours', title: '1,000 career hours',
    description: 'A thousand hours of endurance racing.',
    metric: 'realHours', threshold: 1_000, kind: 'time', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: ['milestone:real-hours:1000'], celebration: 'spectacular',
  },
  {
    id: 'hours-2500', group: 'hours', title: '2,500 career hours',
    description: 'Two and a half thousand hours of endurance racing.',
    metric: 'realHours', threshold: 2_500, kind: 'time', owner: 'career', xp: 0,
    alsoPaidBy: ['The Archive achievement'],
    hallOfFameKeys: [], celebration: 'spectacular',
  },
  {
    id: 'hours-5000', group: 'hours', title: '5,000 career hours',
    description: 'Five thousand hours of endurance racing.',
    metric: 'realHours', threshold: 5_000, kind: 'time', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'spectacular',
  },
  {
    id: 'hours-10000', group: 'hours', title: '10,000 career hours',
    description: 'Ten thousand hours of endurance racing.',
    metric: 'realHours', threshold: 10_000, kind: 'time', owner: 'ladder', xp: 0, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'spectacular',
  },

  // -- Races experienced ------------------------------------------------------
  // Experienced: ten credited minutes and a tenth of the race (or an hour of
  // it). A glimpse of a race counts for nothing here.
  {
    id: 'races-100', group: 'races', title: '100 races experienced',
    description: 'A hundred races with at least a tenth of each watched, or an hour of it.',
    metric: 'racesExperienced', threshold: 100, kind: 'count', owner: 'career', xp: 500, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'races-250', group: 'races', title: '250 races experienced',
    description: 'Two hundred and fifty races with at least a tenth of each watched, or an hour of it.',
    metric: 'racesExperienced', threshold: 250, kind: 'count', owner: 'career', xp: 750, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'races-500', group: 'races', title: '500 races experienced',
    description: 'Five hundred races with at least a tenth of each watched, or an hour of it.',
    metric: 'racesExperienced', threshold: 500, kind: 'count', owner: 'career', xp: 1_000, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'notable',
  },
  {
    id: 'races-1000', group: 'races', title: '1,000 races experienced',
    description: 'A thousand races with at least a tenth of each watched, or an hour of it.',
    metric: 'racesExperienced', threshold: 1_000, kind: 'count', owner: 'career', xp: 1_500, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'spectacular',
  },

  // -- Years ------------------------------------------------------------------
  // One row per calendar year that reached the plan's hours. Only the years
  // that did are ever listed; a year that did not is simply a year.
  {
    id: 'year-plan', group: 'years', title: `${ANNUAL} hours in {year} — ${planSpan(ANNUAL)}`,
    description: `A whole year's viewing plan, ${ANNUAL} hours, watched inside one calendar year.`,
    metric: 'realHoursYear', threshold: 'annualHours', kind: 'time', owner: 'career', xp: 1_000, alsoPaidBy: [],
    hallOfFameKeys: [], celebration: 'notable',
  },

  // -- Recurring events -------------------------------------------------------
  // Editions experienced of one event. That event's own steps pay these, once
  // per event, so the career-wide card is recorded at 0 XP.
  {
    id: 'event-editions-5', group: 'events', title: '5 editions of one recurring event',
    description: 'Five editions of the same recurring event experienced.',
    metric: 'eventEditions', threshold: 5, kind: 'count', owner: 'career', xp: 0,
    alsoPaidBy: ["That event's own Five Editions Experienced step"],
    hallOfFameKeys: [], celebration: 'none',
  },
  {
    id: 'event-editions-10', group: 'events', title: '10 editions of one recurring event',
    description: 'Ten editions of the same recurring event experienced.',
    metric: 'eventEditions', threshold: 10, kind: 'count', owner: 'career', xp: 0,
    alsoPaidBy: ["That event's own Ten Editions Experienced step"],
    hallOfFameKeys: [], celebration: 'notable',
  },
  {
    id: 'event-editions-25', group: 'events', title: '25 editions of one recurring event',
    description: 'Twenty-five editions of the same recurring event experienced.',
    metric: 'eventEditions', threshold: 25, kind: 'count', owner: 'career', xp: 0,
    alsoPaidBy: ["That event's own Twenty-Five Editions Experienced step"],
    hallOfFameKeys: [], celebration: 'notable',
  },
];

/** The number a milestone asks for, with `'annualHours'` resolved from the budget. */
export function careerMilestoneThreshold(def: CareerMilestoneDef): number {
  return def.threshold === 'annualHours' ? BUDGET_CONFIG.annualHours : def.threshold;
}

/**
 * The `MilestoneProgress.metric` a row is stored under. The year rung carries
 * its year in the metric (`realHoursYear:2027`), so the existing unique index
 * on `(userId, metric, threshold)` keeps one row per year.
 */
export function careerMilestoneMetricKey(def: CareerMilestoneDef, year?: number): string {
  if (def.metric !== 'realHoursYear') return def.metric;
  if (year === undefined) throw new Error(`Career milestone "${def.id}" needs a year.`);
  return `${def.metric}:${year}`;
}

/**
 * The ledger dedupe key of a paid career milestone.
 *
 * `milestone:<metric>:<threshold>` for every rung — the shape the ladders
 * already use, which is why no career row may share a pair with a ladder — and
 * `milestone:realHoursYear:<year>` for the year rung, with no number in it: a
 * re-balance of the annual hours must never be able to pay a year twice.
 */
export function careerMilestoneDedupeKey(def: CareerMilestoneDef, year?: number): string {
  if (def.metric === 'realHoursYear') return `milestone:${careerMilestoneMetricKey(def, year)}`;
  return `milestone:${def.metric}:${careerMilestoneThreshold(def)}`;
}

/** The title with its year filled in; "a calendar year" when there is none to name. */
export function careerMilestoneTitle(def: CareerMilestoneDef, year?: number): string {
  return def.title.replace('in {year}', year === undefined ? 'in a calendar year' : `in ${year}`);
}

export const CAREER_MILESTONES_BY_ID: ReadonlyMap<string, CareerMilestoneDef> = new Map(
  CAREER_MILESTONES.map((def) => [def.id, def]),
);

/** Every rung but the year's, by the `metric:threshold` pair it is stored under. */
const BY_STORED_PAIR: ReadonlyMap<string, CareerMilestoneDef> = new Map(
  CAREER_MILESTONES
    .filter((def) => def.metric !== 'realHoursYear')
    .map((def) => [`${def.metric}:${careerMilestoneThreshold(def)}`, def]),
);

const YEAR_ROW = /^realHoursYear:(\d{4})$/;

/**
 * The catalogue milestone a stored `MilestoneProgress` row is, if it is one,
 * with the year of a year's rung. A year's rung is recognised by its metric
 * alone, whatever threshold it was reached at, so a row written before the
 * annual hours were re-balanced is still that year's rung.
 */
export function careerMilestoneOfRow(
  metric: string,
  threshold: number,
): { def: CareerMilestoneDef; year?: number } | null {
  const year = YEAR_ROW.exec(metric);
  if (year) {
    const def = CAREER_MILESTONES.find((candidate) => candidate.metric === 'realHoursYear');
    return def === undefined ? null : { def, year: Number.parseInt(year[1]!, 10) };
  }
  const def = BY_STORED_PAIR.get(`${metric}:${threshold}`);
  return def === undefined ? null : { def };
}

/** A milestone big enough to be celebrated when it is reached, not only listed. */
export function isMajorMilestone(def: CareerMilestoneDef): boolean {
  return def.celebration !== 'none';
}
