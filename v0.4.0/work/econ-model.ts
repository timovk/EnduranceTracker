// Reference model for SPEC.md §7.3. Run from the repo root:
//   npx tsx --tsconfig tsconfig.json <path-to-this-file>
import { ACHIEVEMENTS, MASTERY_CONFIG, MILESTONES, SEASON_PASS_CONFIG, XP_CONFIG, BUDGET_CONFIG } from '@/lib/config';
import { milestoneXpFor } from '@/lib/engines/achievement-engine';
import { storyCompleteBonus, levelFromXp } from '@/lib/domain/progression';

const NEW_EVENT_NODES = [
  { metric: 'editionsWatched', threshold: 1, xp: 0 },   // recorded only (review M2)
  { metric: 'editionsWatched', threshold: 3, xp: 300 },
  { metric: 'editionsWatched', threshold: 5, xp: 500 },
  { metric: 'editionsWatched', threshold: 10, xp: 1000 },
  { metric: 'editionsWatched', threshold: 25, xp: 2500 },
  { metric: 'consecutiveEditions', threshold: 10, xp: 5000 },
  { metric: 'realHours', threshold: 25, xp: 500 },
  { metric: 'realHours', threshold: 100, xp: 1500 },
  { metric: 'realHours', threshold: 250, xp: 3000 },
];
const CAREER_RUNGS = [
  { metric: 'realHours', threshold: 250, xp: 1000 },
  { metric: 'racesExperienced', threshold: 100, xp: 500 },
  { metric: 'racesExperienced', threshold: 250, xp: 750 },
  { metric: 'racesExperienced', threshold: 500, xp: 1000 },
  { metric: 'racesExperienced', threshold: 1000, xp: 1500 },
  { metric: 'stories6h', threshold: 1, xp: 500 },
];
function pool(runtimeH: number) { return Math.round(storyCompleteBonus(runtimeH*3600).careerXp * 0.4); }

function career(hours: number, withNew: boolean) {
  const stories = Math.floor(hours / 7);
  const metrics: Record<string, number> = {
    realHours: hours, timelineHours: hours * 1.2, racesCompleted: stories, storyCompletes: stories,
    championshipsCompleted: Math.min(8, 1 + Math.floor(stories / 10)), seasonsCompleted: Math.floor(stories / 8),
    seasonsStoryComplete: Math.floor(stories / 10), circuits: Math.min(60, stories), countries: Math.min(30, Math.floor(stories * 0.7)),
    majorEventStories: Math.floor(stories / 6), stories8h: Math.floor(stories / 5), stories10h: Math.floor(stories / 8),
    stories12h: Math.floor(stories / 10), stories24h: Math.floor(stories / 20), sessions: Math.floor(hours / 2.2),
    longestSessionHours: 3, lifetimeActiveDays: Math.floor(hours / 1.6), distinctRaceTypesStoried: Math.min(6, Math.floor(stories / 4)),
    masteryTreesCompleted: 0, seasonPassesCompleted: Math.floor(hours / 336) * 2,
    longestConsecutiveEditions: Math.min(5, Math.floor(hours / 700)), maxEditionsOfOneEvent: Math.min(10, Math.floor(hours / 400)),
    puristStories: Math.floor(stories / 6), maxSessionsForOneStory: 6, longBreakReturns: Math.floor(hours / 500), level: 0, prestige: 0, careerXpMillions: 0,
    racesExperienced: Math.ceil(stories * 1.25), stories6h: stories,
  };
  const viewing = hours * 60 * XP_CONFIG.xpPerRealMinute;
  const storyBonuses = stories * storyCompleteBonus(6 * 3600).careerXp;
  let milestones = 0;
  for (const def of MILESTONES) { const v = metrics[def.metric] ?? 0; def.thresholds.forEach((t, i) => { if (v >= t) milestones += milestoneXpFor(def, i); }); }
  let achievements = 0; for (const a of ACHIEVEMENTS) if ((metrics[a.metric] ?? 0) >= a.threshold) achievements += a.xpReward;
  let mastery = 0;
  for (const n of MASTERY_CONFIG.globalNodes) if ((metrics[n.metric] ?? 0) >= n.threshold) mastery += n.xpReward;
  const ch = metrics.championshipsCompleted ?? 1;
  for (const n of MASTERY_CONFIG.championshipNodes) { const per = (metrics[n.metric] ?? 0) / ch; if (per >= n.threshold) mastery += n.xpReward * ch; }
  const quarters = Math.max(1, Math.floor(hours / (336 / 4)));
  const passXp = quarters * (SEASON_PASS_CONFIG.tierCount / 10) * 3_000;
  let careerNew = 0, expedition = 0, eventNew = 0, eventExisting = 0;
  if (withNew) {
    for (const r of CAREER_RUNGS) if ((metrics[r.metric] ?? 0) >= r.threshold) careerNew += r.xp;
    careerNew += Math.floor(hours / BUDGET_CONFIG.annualHours) * 1000;
    expedition = metrics.stories24h * pool(24) + (metrics.stories10h - metrics.stories24h) * pool(10);
    // one representative followed event: editions watched = years of watching (+1 in first year), SC editions = maxEditionsOfOneEvent
    const years = Math.max(1, Math.ceil(hours / 336));
    const eventsFollowed = stories === 0 ? 0 : Math.min(6, Math.max(1, Math.floor(stories / 12)));
    const ev: Record<string, number> = { editionsWatched: Math.min(years, 25), consecutiveEditions: metrics.longestConsecutiveEditions, realHours: Math.min(hours * 0.15, 24 * years), editionsStoryComplete: metrics.maxEditionsOfOneEvent };
    for (const n of NEW_EVENT_NODES) if ((ev[n.metric] ?? 0) >= n.threshold) eventNew += n.xp * eventsFollowed;
    // Existing raceEventNodes stay unmodelled, exactly as in the 0.3.2 test (SPEC §7.3).
    void MASTERY_CONFIG.raceEventNodes;
  }
  const other = storyBonuses + milestones + careerNew + achievements + mastery + eventNew + eventExisting + passXp + expedition;
  return { hours, viewing, storyBonuses, milestones: milestones + careerNew, achievements, mastery: mastery + eventNew + eventExisting, passXp, expedition, careerNew, eventNew, eventExisting, other, total: viewing + other };
}
for (const h of [20, 58, 150, 336, 672, 1680, 3360]) {
  const a = career(h, false), b = career(h, true);
  console.log(h, 'share old', (a.viewing/a.total).toFixed(4), 'new', (b.viewing/b.total).toFixed(4),
   'careerNew', b.careerNew, 'exp', b.expedition, 'eventNew', b.eventNew, 'eventExisting', b.eventExisting,
   'milestones<0.5view', b.milestones < b.viewing*0.5, (b.milestones/b.viewing).toFixed(3),
   'maxOther', Math.max(b.storyBonuses,b.milestones,b.achievements,b.mastery,b.passXp) < b.viewing,
   'level', levelFromXp(b.total).level, 'headroomXP', Math.round(b.viewing/0.4 - b.total));
}

// --- Review m14: a long-race-heavy first career. 65% of hours on 24h races,
// checkpoints paid by coverage (not only on completion), the rest on 6h races.
function checkpointsFor(runtimeH: number, coveredShare: number): number {
  const p = pool(runtimeH); const cps = [[10,0.1],[25,0.15],[50,0.25],[75,0.25],[90,0.25]] as const;
  let xp = 0; for (const [pct, share] of cps) if (coveredShare*100 >= pct) xp += Math.round(p*share/10)*10; return xp;
}
function longRaceCareer(hours: number) {
  const base = career(hours, true);
  const longHours = hours * 0.65;
  const full24 = Math.floor(longHours / 24);
  const partialShare = (longHours - full24 * 24) / 24;
  const checkpoints = full24 * checkpointsFor(24, 1) + checkpointsFor(24, partialShare);
  const other = base.other - base.expedition + checkpoints;
  return { hours, viewing: base.viewing, checkpoints, share: base.viewing / (base.viewing + other) };
}
for (const h of [20, 58, 150, 336, 672, 1680, 3360]) {
  const r = longRaceCareer(h);
  console.log('long-race', h, 'checkpoints', r.checkpoints, 'viewing share', r.share.toFixed(4));
}
let worst = 0, worstH = 0;
for (let m = 6 * 60; m <= 48 * 60; m += 1) {
  const h = m / 60; const total = checkpointsFor(h, 1); const viewing = h * 60 * XP_CONFIG.xpPerRealMinute;
  if (total / viewing > worst) { worst = total / viewing; worstH = h; }
}
console.log('per-race worst checkpoint/viewing', worst.toFixed(4), 'at', worstH.toFixed(2), 'h');
// Review I-m13: checkpoints per real minute at the fastest playback (8×) stay below viewing's rate.
let worstPerMinute = 0, worstPerMinuteH = 0;
for (let m = 6 * 60; m <= 48 * 60; m += 1) {
  const h = m / 60; const realMinutes = (h * 60) / 8; const perMinute = checkpointsFor(h, 1) / realMinutes;
  if (perMinute > worstPerMinute) { worstPerMinute = perMinute; worstPerMinuteH = h; }
}
console.log('8x worst checkpoint XP per real minute', worstPerMinute.toFixed(2), 'at', worstPerMinuteH.toFixed(2), 'h; viewing pays', XP_CONFIG.xpPerRealMinute);
