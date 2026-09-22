/**
 * Demonstration data.
 *
 * Creates a small, entirely fictional endurance-racing career so the whole
 * application can be seen working: a completed race, a partially watched one,
 * an untouched one, a season most of the way through, a long-haul event with a
 * deliberate gap in the middle, and the progression that follows from all of
 * it.
 *
 * Nothing here comes from a real calendar, and there is no external API: the
 * championships and events below are invented, which is also a small
 * demonstration that custom championships behave exactly like the presets.
 *
 *     npm run db:seed:demo        add the demonstration career
 *     npm run db:unseed:demo      remove every trace of it
 *     npm run db:seed             set up an empty career only
 *
 * Everything the demonstration creates is tagged, so removing it is exact and
 * cannot touch anything you added yourself.
 */

// Next.js loads .env by itself; a script run through tsx does not, and the
// Prisma client is lazy, so this only has to happen before the first query.
import 'dotenv/config';

import { disconnectDb, prisma, USER_ID } from '@/lib/db/client';
import { ensureCareer, ensureChampionshipPresets } from '@/lib/server/bootstrap';
import { syncAchievementDefinitions } from '@/lib/engines/achievement-engine';
import { logViewingSession } from '@/lib/engines/session-engine';
import { circuitSlug } from '@/lib/engines/race-engine';
import { ensureChallenges } from '@/lib/engines/challenge-engine';
import { getMomentum } from '@/lib/engines/momentum-engine';
import { recomputeWeekAllocations } from '@/lib/engines/budget-engine';
import { formatDuration } from '@/lib/domain/time';

/** Marks everything the demonstration creates, so removal is exact. */
const DEMO_TAG = '[demo]';

const H = 3600;

interface DemoRace {
  key: string;
  name: string;
  championship: string;
  year: number;
  circuit: string;
  country: string;
  daysAgo: number;
  runtimeHours: number;
  isMajorEvent?: boolean;
  iconicKey?: string;
  excitement?: number;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'MUST_WATCH';
  /** Stints to log, as [startHours, endHours, playbackSpeed, daysAgo]. */
  sessions?: [number, number, number, number][];
}

const CHAMPIONSHIPS = [
  { slug: 'demo-world-endurance', name: `Continental Endurance Cup ${DEMO_TAG}`, shortName: 'CEC', accentColor: '#c0504d' },
  { slug: 'demo-atlantic-series', name: `Atlantic Sportscar Series ${DEMO_TAG}`, shortName: 'ASS', accentColor: '#3f7fb5' },
  { slug: 'demo-gt-challenge', name: `Northern GT Challenge ${DEMO_TAG}`, shortName: 'NGT', accentColor: '#3fa06b' },
];

/**
 * The demonstration library.
 *
 * Shaped to show every state at once: one race finished straight through, one
 * finished across many stints, one abandoned mid-race with a visible gap, one
 * in progress, one queued and untouched, and a 24-hour expedition part-way
 * through — including a skipped section, so the Story Complete mechanic is
 * visible rather than merely described.
 */
const RACES: DemoRace[] = [
  {
    key: 'cec-r1', name: '6 Hours of Northport', championship: 'demo-world-endurance', year: 2026,
    circuit: 'Northport Raceway', country: 'Ireland', daysAgo: 96, runtimeHours: 6, excitement: 4,
    sessions: [[0, 2.5, 1.25, 94], [2.5, 4.75, 1.25, 92], [4.75, 6, 1, 91]],
  },
  {
    key: 'cec-r2', name: '4 Hours of Vallegrande', championship: 'demo-world-endurance', year: 2026,
    circuit: 'Autodromo di Vallegrande', country: 'Italy', daysAgo: 72, runtimeHours: 4, excitement: 3,
    sessions: [[0, 4, 1.5, 70]],
  },
  {
    key: 'cec-r3', name: '10 Hours of Karoo', championship: 'demo-world-endurance', year: 2026,
    circuit: 'Karoo International', country: 'South Africa', daysAgo: 54, runtimeHours: 10, excitement: 5,
    isMajorEvent: true, priority: 'HIGH',
    sessions: [[0, 2.2, 1.25, 52], [2.2, 4.4, 1.25, 51], [4.4, 7.1, 1.25, 48], [7.1, 10, 1.1, 47]],
  },
  {
    key: 'cec-r4', name: '6 Hours of Harbour Point', championship: 'demo-world-endurance', year: 2026,
    circuit: 'Harbour Point Circuit', country: 'Singapore', daysAgo: 30, runtimeHours: 6, excitement: 4,
    // Partially watched, and deliberately left with a gap in the middle so the
    // interval tracking is visible: 01:12 to 02:40 has never been watched.
    sessions: [[0, 1.2, 1.25, 28], [2.667, 4.3, 1.25, 5]],
  },
  {
    key: 'cec-r5', name: '6 Hours of Silverpine', championship: 'demo-world-endurance', year: 2026,
    circuit: 'Silverpine Park', country: 'Canada', daysAgo: 12, runtimeHours: 6, excitement: 4,
    priority: 'HIGH',
  },
  {
    key: 'cec-r6', name: '8 Hours of Cape Meridian', championship: 'demo-world-endurance', year: 2026,
    circuit: 'Cape Meridian', country: 'Australia', daysAgo: -14, runtimeHours: 8, excitement: 5,
    priority: 'MUST_WATCH',
  },
  {
    key: 'atl-24', name: '24 Hours of Fort Aurelia', championship: 'demo-atlantic-series', year: 2026,
    circuit: 'Fort Aurelia Speedway', country: 'United States', daysAgo: 64, runtimeHours: 24,
    isMajorEvent: true, iconicKey: 'fort-aurelia-24', excitement: 5, priority: 'MUST_WATCH',
    // An expedition in progress: nine hours in, across five stints.
    sessions: [[0, 2.5, 1, 62], [2.5, 4.6, 1.25, 61], [4.6, 6.3, 1.25, 59], [6.3, 8.1, 1.5, 44], [8.1, 9.4, 1.25, 6], [9.4, 11.2, 1.25, 2], [11.2, 12.6, 1.25, 1]],
  },
  {
    key: 'atl-24-prev', name: '24 Hours of Fort Aurelia', championship: 'demo-atlantic-series', year: 2025,
    circuit: 'Fort Aurelia Speedway', country: 'United States', daysAgo: 430, runtimeHours: 24,
    isMajorEvent: true, iconicKey: 'fort-aurelia-24', excitement: 5,
    // Last year's edition, watched all the way through — so Race Mastery has
    // a lifetime history to show rather than a single entry.
    sessions: [
      [0, 3, 1.25, 428], [3, 6.5, 1.25, 427], [6.5, 10, 1.25, 426],
      [10, 14, 1.5, 425], [14, 18.5, 1.5, 424], [18.5, 24, 1.25, 423],
    ],
  },
  {
    key: 'atl-12', name: '12 Hours of Redstone', championship: 'demo-atlantic-series', year: 2026,
    circuit: 'Redstone Park', country: 'United States', daysAgo: 108, runtimeHours: 12,
    isMajorEvent: true, excitement: 4,
    sessions: [[0, 3, 1.25, 106], [3, 6.2, 1.25, 105], [6.2, 9.1, 1.5, 103], [9.1, 12, 1.25, 102]],
  },
  {
    key: 'ngt-r1', name: '3 Hours of Glasmoor', championship: 'demo-gt-challenge', year: 2026,
    circuit: 'Glasmoor', country: 'Scotland', daysAgo: 40, runtimeHours: 3, excitement: 3,
    sessions: [[0, 3, 1.5, 38]],
  },
  {
    key: 'ngt-r2', name: '3 Hours of Kaltenberg', championship: 'demo-gt-challenge', year: 2026,
    circuit: 'Kaltenberg Ring', country: 'Germany', daysAgo: 20, runtimeHours: 3, excitement: 3,
  },
];

async function seedDemo(): Promise<void> {
  await ensureCareer();

  // Running this twice should refresh the demonstration, not stack a second
  // copy of it on top of the first. Anything the user added themselves is
  // untouched by the removal, so this is safe to repeat.
  const existing = await prisma.race.count({ where: { userId: USER_ID, notes: DEMO_TAG } });
  if (existing > 0) {
    console.log(`Refreshing the demonstration career (${existing} races already present)…\n`);
    await removeDemo({ quiet: true });
  } else {
    console.log('Building the demonstration career…\n');
  }

  await syncAchievementDefinitions();

  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

  // -- Championships and seasons ------------------------------------------
  const championshipIds = new Map<string, string>();
  for (const preset of CHAMPIONSHIPS) {
    const championship = await prisma.championship.upsert({
      where: { userId_slug: { userId: USER_ID, slug: preset.slug } },
      update: {},
      create: {
        userId: USER_ID,
        slug: preset.slug,
        name: preset.name,
        shortName: preset.shortName,
        accentColor: preset.accentColor,
        isCustom: true,
      },
      select: { id: true },
    });
    championshipIds.set(preset.slug, championship.id);
  }
  console.log(`  ${CHAMPIONSHIPS.length} championships`);

  // The flagship season declares six races, five of which exist: a partially
  // completed collection, which is exactly what the spec asks to demonstrate.
  // Only the seasons that actually receive races. An empty season would show
  // up as a collectible set with no cards in it, which is noise rather than
  // demonstration.
  const usedSeasons = new Set(RACES.map((race) => `${race.championship}:${race.year}`));

  const seasonIds = new Map<string, string>();
  for (const [slug, id] of championshipIds) {
    for (const year of [2025, 2026]) {
      if (!usedSeasons.has(`${slug}:${year}`)) continue;
      const declared = slug === 'demo-world-endurance' && year === 2026 ? 6 : null;
      const season = await prisma.championshipSeason.upsert({
        where: { championshipId_year: { championshipId: id, year } },
        update: { plannedRaceCount: declared },
        create: { championshipId: id, year, plannedRaceCount: declared },
        select: { id: true },
      });
      seasonIds.set(`${slug}:${year}`, season.id);
    }
  }

  // -- Races ---------------------------------------------------------------
  const raceIds = new Map<string, string>();
  for (const demo of RACES) {
    const championshipId = championshipIds.get(demo.championship);
    const seasonId = seasonIds.get(`${demo.championship}:${demo.year}`);
    if (!championshipId || !seasonId) continue;

    const race = await prisma.race.create({
      data: {
        userId: USER_ID,
        name: demo.name,
        // The tag lives in the notes rather than the name, so the demonstration
        // library still reads like a real one.
        notes: DEMO_TAG,
        championshipId,
        seasonId,
        circuit: demo.circuit,
        circuitSlug: circuitSlug(demo.circuit),
        country: demo.country,
        raceDate: daysAgo(demo.daysAgo),
        raceType: raceTypeFor(demo.runtimeHours),
        scheduledDurationSec: Math.round(demo.runtimeHours * H),
        runtimeSec: Math.round(demo.runtimeHours * H),
        priority: demo.priority ?? 'NORMAL',
        excitement: demo.excitement ?? 3,
        status: demo.sessions ? 'WATCHING' : 'QUEUED',
        isMajorEvent: demo.isMajorEvent ?? false,
        iconicKey: demo.iconicKey ?? null,
      },
      select: { id: true },
    });
    raceIds.set(demo.key, race.id);
  }
  console.log(`  ${raceIds.size} races`);

  // -- Viewing history -----------------------------------------------------
  //
  // Logged through the real session engine rather than written directly, so the
  // demonstration career is produced by exactly the same code path a genuine
  // one would be: XP, momentum, challenges, mastery, collections and the Hall
  // of Fame all fall out of it naturally.
  // Flattened and sorted oldest-first. Logging in chronological order matters:
  // momentum, streaks and the weekly budget are all computed against the date
  // of the stint, and replaying a career out of order would produce figures no
  // real career could ever have had.
  const stints = RACES.flatMap((demo) => {
    const raceId = raceIds.get(demo.key);
    if (!raceId || !demo.sessions) return [];
    return demo.sessions.map(([startHours, endHours, speed, when]) => ({
      raceId, startHours, endHours, speed, when,
    }));
  }).sort((a, b) => b.when - a.when);

  // Wind the momentum clock back before the replayed history begins.
  //
  // `applyMomentumForSession` deliberately never moves the settle clock
  // backwards — logging last Tuesday's stint today must not charge decay twice
  // for the days in between. That is right for real use, but it means a career
  // replayed from the past would otherwise accumulate every gain with no decay
  // at all and arrive at the ceiling. Starting the clock before the first
  // stint makes the replay faithful to the career it is pretending to be.
  const earliest = stints[0];
  if (earliest !== undefined) {
    await prisma.careerProfile.update({
      where: { userId: USER_ID },
      data: { momentumUpdatedAt: daysAgo(earliest.when + 1), momentumPoints: 0, momentumTierKey: 'cold_tyres' },
    });
  }

  let sessionCount = 0;
  for (const stint of stints) {
    const watchedAt = daysAgo(stint.when);
    await logViewingSession(
      USER_ID,
      {
        raceId: stint.raceId,
        mode: 'RANGE',
        startTimestamp: Math.round(stint.startHours * H),
        endTimestamp: Math.round(stint.endHours * H),
        playbackSpeed: stint.speed,
        watchedAt,
        note: undefined,
      },
      watchedAt,
    );
    sessionCount += 1;
  }
  console.log(`  ${sessionCount} stints logged, oldest first`);

  // -- Derived systems -----------------------------------------------------
  await ensureChallenges(USER_ID);
  await recomputeWeekAllocations(USER_ID);

  await printSummary();
}

function raceTypeFor(hours: number) {
  if (hours >= 24) return 'H24' as const;
  if (hours >= 12) return 'H12' as const;
  if (hours >= 10) return 'H10' as const;
  if (hours >= 8) return 'H8' as const;
  if (hours >= 6) return 'H6' as const;
  if (hours >= 4) return 'H4' as const;
  return 'SPRINT_ENDURANCE' as const;
}

/**
 * Remove the demonstration career.
 *
 * Deletes only what the seed created, identified by the tag, so anything the
 * user added themselves is untouched. Cascades take the sessions, intervals and
 * collection cards with the races.
 */
async function removeDemo(options: { quiet?: boolean } = {}): Promise<void> {
  const say = (line: string) => { if (!options.quiet) say(line); };
  say('Removing the demonstration data…\n');

  const races = await prisma.race.findMany({
    where: { userId: USER_ID, notes: DEMO_TAG },
    select: { id: true },
  });
  const raceIds = races.map((r) => r.id);

  if (raceIds.length > 0) {
    // XP transactions reference sessions with SetNull, so the ledger keeps its
    // history. That is deliberate: the ledger is append-only by design. The
    // demo's own entries are removed explicitly below.
    await prisma.xPTransaction.deleteMany({
      where: { userId: USER_ID, sourceRef: { in: raceIds } },
    });
    await prisma.race.deleteMany({ where: { id: { in: raceIds } } });
  }

  const championships = await prisma.championship.findMany({
    where: { userId: USER_ID, name: { contains: DEMO_TAG } },
    select: { id: true },
  });
  const championshipIds = championships.map((c) => c.id);

  if (championshipIds.length > 0) {
    await prisma.masteryTree.deleteMany({ where: { userId: USER_ID, championshipId: { in: championshipIds } } });
    await prisma.championship.deleteMany({ where: { id: { in: championshipIds } } });
  }

  // Anything that referenced only demonstration races is now orphaned.
  await prisma.collection.deleteMany({ where: { userId: USER_ID, season: null, kind: 'SEASON' } });
  await prisma.raceMastery.deleteMany({ where: { userId: USER_ID, races: { none: {} } } });

  say(`  ${raceIds.length} races and ${championshipIds.length} championships removed`);

  // If the library was nothing but demonstration data, the career it produced
  // was demonstration data too, and leaving it behind would quietly inflate a
  // real career started afterwards. If there are genuine races as well, the
  // permanent record is left exactly alone — progression is never destroyed to
  // tidy something up.
  const realRacesLeft = await prisma.race.count({ where: { userId: USER_ID } });

  if (realRacesLeft === 0) {
    await prisma.$transaction([
      prisma.xPTransaction.deleteMany({ where: { userId: USER_ID } }),
      prisma.achievementProgress.deleteMany({ where: { userId: USER_ID } }),
      prisma.milestoneProgress.deleteMany({ where: { userId: USER_ID } }),
      prisma.masteryProgress.deleteMany({ where: { userId: USER_ID } }),
      prisma.masteryTree.deleteMany({ where: { userId: USER_ID } }),
      prisma.collection.deleteMany({ where: { userId: USER_ID } }),
      prisma.trophy.deleteMany({ where: { userId: USER_ID } }),
      prisma.hallOfFameEntry.deleteMany({ where: { userId: USER_ID } }),
      prisma.challenge.deleteMany({ where: { userId: USER_ID } }),
      prisma.seasonPass.deleteMany({ where: { userId: USER_ID } }),
      prisma.momentumHistory.deleteMany({ where: { userId: USER_ID } }),
      prisma.budgetYear.deleteMany({ where: { userId: USER_ID } }),
      prisma.raceMastery.deleteMany({ where: { userId: USER_ID } }),
      prisma.careerProfile.update({
        where: { userId: USER_ID },
        data: {
          careerXp: BigInt(0), level: 1, prestige: 0, titleKey: null,
          currentStreakDays: 0, longestStreakDays: 0,
          lifetimeActiveDays: 0, lifetimeActiveWeeks: 0, lastActiveDate: null,
          momentumPoints: 0, momentumTierKey: 'cold_tyres',
        },
      }),
    ]);
    say('  the career it produced was removed with it — the library was');
    say('  entirely demonstration data, so there was nothing real to keep');
  } else {
    const plural = realRacesLeft === 1 ? 'race of your own remains' : 'races of your own remain';
    say(`\n  ${realRacesLeft} ${plural}, so the permanent record —`);
    say('  career XP, achievements, trophies, the Hall of Fame — is untouched.');
    say('  Run `npm run db:recompute` to rebuild the derived totals around');
    say('  what is left.');
  }
}

async function printSummary(): Promise<void> {
  const [profile, races, sessions, trophies, hallOfFame, momentum] = await Promise.all([
    prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER_ID } }),
    prisma.race.aggregate({
      where: { userId: USER_ID },
      _count: true,
      _sum: { coverageSec: true, realViewingSec: true },
    }),
    prisma.raceViewingSession.count({ where: { userId: USER_ID } }),
    prisma.trophy.count({ where: { userId: USER_ID } }),
    prisma.hallOfFameEntry.count({ where: { userId: USER_ID } }),
    // Read through the engine: momentum decays lazily, so the stored column is
    // whatever it was at the last stint, not what it is now.
    getMomentum(USER_ID),
  ]);

  const storyComplete = await prisma.race.count({
    where: { userId: USER_ID, storyCompletedAt: { not: null } },
  });

  console.log('\nThe demonstration career');
  console.log(`  career level        ${profile.level}`);
  console.log(`  career XP           ${Number(profile.careerXp).toLocaleString('en-GB')}`);
  console.log(`  momentum            ${momentum.tierName.toLowerCase()}`);
  console.log(`  races               ${races._count}`);
  console.log(`  story complete      ${storyComplete}`);
  console.log(`  stints              ${sessions}`);
  console.log(`  unique coverage     ${formatDuration(races._sum.coverageSec ?? 0)}`);
  console.log(`  real viewing time   ${formatDuration(races._sum.realViewingSec ?? 0)}`);
  console.log(`  trophies            ${trophies}`);
  console.log(`  hall of fame        ${hallOfFame}`);
  console.log('\nRun `npm run dev` and open http://localhost:3000');
  console.log('Remove it again with `npm run db:unseed:demo`.');
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (args.has('--remove-demo')) {
    await removeDemo();
    return;
  }

  await ensureCareer();

  if (args.has('--demo')) {
    await seedDemo();
    return;
  }

  // The plain seed: an empty career, ready to have real races added to it.
  await syncAchievementDefinitions();
  const created = await ensureChampionshipPresets(USER_ID);
  console.log('Career ready.');
  console.log(`  ${created} preset championships added (delete any you do not want).`);
  console.log('\n  Add your first race at /races/new, or run `npm run db:seed:demo`');
  console.log('  to see the application with a demonstration career in it.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
