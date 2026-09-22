import { totalXpForLevel, levelFromXp, xpForSession, storyCompleteBonus, prestigeForLevel, prestigeLabel, titleForLevel } from '@/lib/domain/progression';

const XP_PER_HOUR = 30 * 60; // viewing only
console.log('level | total XP      | viewing hours | years @336h/yr (viewing only)');
for (const lvl of [5, 10, 25, 50, 75, 100, 150, 250, 500, 1000]) {
  const xp = totalXpForLevel(lvl);
  const hours = xp / XP_PER_HOUR;
  console.log(`${String(lvl).padStart(5)} | ${String(xp).padStart(13)} | ${hours.toFixed(0).padStart(13)} | ${(hours/336).toFixed(1)}`);
}
console.log('\nround-trip check:');
for (const lvl of [1, 2, 10, 47, 100, 333]) {
  const xp = totalXpForLevel(lvl);
  const st = levelFromXp(xp);
  console.log(`  L${lvl} -> xp ${xp} -> resolved L${st.level} (into ${st.xpIntoLevel}/${st.xpForLevel})  ${st.level === lvl ? 'OK' : 'MISMATCH'}`);
}
console.log('\nsession XP examples:');
const ex = xpForSession({ timelineSeconds: 4331, newCoverageSeconds: 4331, playbackSpeed: 1.25 });
console.log('  1h12m11s new coverage @1.25x ->', ex.careerXp, 'career /', ex.seasonXp, 'season; real', ex.newRealSeconds, 's');
const rw = xpForSession({ timelineSeconds: 3600, newCoverageSeconds: 0, playbackSpeed: 1 });
console.log('  1h pure rewatch @1x ->', rw.careerXp, 'career (vs', xpForSession({timelineSeconds:3600,newCoverageSeconds:3600,playbackSpeed:1}).careerXp, 'if new)');
const slow = xpForSession({ timelineSeconds: 3600, newCoverageSeconds: 3600, playbackSpeed: 0.1 });
console.log('  1h new @0.1x (exploit attempt) ->', slow.careerXp, 'guard:', slow.speedGuardApplied, '(vs 1x =', xpForSession({timelineSeconds:3600,newCoverageSeconds:3600,playbackSpeed:1}).careerXp, ')');
const fast = xpForSession({ timelineSeconds: 3600, newCoverageSeconds: 3600, playbackSpeed: 3 });
console.log('  1h new @3x ->', fast.careerXp, '(less XP for less real time - no speed exploit)');

console.log('\na full 336h year, all new coverage @1.25x avg:');
const yearTimeline = 336 * 3600 * 1.25;
const yearXp = xpForSession({ timelineSeconds: yearTimeline, newCoverageSeconds: yearTimeline, playbackSpeed: 1.25 });
console.log('  viewing XP:', yearXp.careerXp.toLocaleString(), '-> level', levelFromXp(yearXp.careerXp).level);
console.log('  with ~2x from bonuses/challenges:', (yearXp.careerXp*2).toLocaleString(), '-> level', levelFromXp(yearXp.careerXp*2).level);
console.log('  after 10 such years:', (yearXp.careerXp*2*10).toLocaleString(), '-> level', levelFromXp(yearXp.careerXp*2*10).level, '|', titleForLevel(levelFromXp(yearXp.careerXp*2*10).level).title, '|', prestigeLabel(prestigeForLevel(levelFromXp(yearXp.careerXp*2*10).level)));

console.log('\nstory bonuses:');
for (const h of [4,6,8,12,24]) { const b = storyCompleteBonus(h*3600); console.log(`  ${h}h -> +${b.careerXp} career (${b.label})`); }
