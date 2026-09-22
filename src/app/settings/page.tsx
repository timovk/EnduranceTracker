import { PageHeader } from '@/components/layout/page-header';
import { SettingsForm } from '@/components/dashboard/settings-form';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { prisma, USER_ID } from '@/lib/db/client';
import { ensureCareer, ensureBudgetYearRow } from '@/lib/server/bootstrap';
import { BUDGET_CONFIG, LEVEL_TITLES, RACE_CARD_STYLES, THEMES, XP_CONFIG, STORY_CONFIG, SEASON_PASS_CONFIG } from '@/lib/config';
import { levelFromXp, titleForLevel } from '@/lib/domain/progression';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await ensureCareer();
  const year = new Date().getFullYear();
  await ensureBudgetYearRow(USER_ID, year);

  const [user, profile, budgetYear, speedOverride, counts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: USER_ID } }),
    prisma.careerProfile.findUniqueOrThrow({ where: { userId: USER_ID } }),
    prisma.budgetYear.findUniqueOrThrow({ where: { userId_year: { userId: USER_ID, year } } }),
    prisma.configOverride.findUnique({ where: { userId_key: { userId: USER_ID, key: 'defaultPlaybackSpeed' } } }),
    Promise.all([
      prisma.race.count({ where: { userId: USER_ID } }),
      prisma.championship.count({ where: { userId: USER_ID } }),
      prisma.raceViewingSession.count({ where: { userId: USER_ID } }),
    ]),
  ]);

  const level = levelFromXp(Number(profile.careerXp)).level;
  const unlockedTitles = LEVEL_TITLES.filter((t) => t.level <= level);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        eyebrow="Settings"
        title="How the career works"
        description="The viewing plan and the cosmetic choices are yours. The progression economy is configurable too — these are its current values."
      />

      <SettingsForm
        name={user.name}
        weekStart={user.weekStart}
        annualBudgetHours={budgetYear.annualBudgetHours}
        weeklyTargetHours={budgetYear.weeklyTargetHours}
        themeKey={profile.themeKey}
        raceCardKey={profile.raceCardKey}
        titleKey={profile.titleKey ?? titleForLevel(level).title}
        defaultPlaybackSpeed={typeof speedOverride?.value === 'number' ? speedOverride.value : 1}
        themes={[...THEMES]}
        raceCards={[...RACE_CARD_STYLES]}
        titles={unlockedTitles.map((t) => t.title)}
        libraryCounts={{ races: counts[0], championships: counts[1], sessions: counts[2] }}
      />

      <Panel>
        <PanelHeader title="Progression economy" />
        <PanelBody className="space-y-3 text-sm">
          <p className="text-ink-dim">
            Every balance constant lives in one place, so the economy can be re-tuned without
            touching the rest of the application. Every XP award is also a ledger entry, which means
            a re-balance can be replayed rather than guessed at.
          </p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-hairline pt-3 sm:grid-cols-3">
            <Value label="XP per real minute" value={`${XP_CONFIG.xpPerRealMinute}`} />
            <Value label="Re-watch multiplier" value={`${XP_CONFIG.rewatchXpMultiplier}×`} />
            <Value label="Season XP per minute" value={`${XP_CONFIG.seasonXpPerRealMinute}`} />
            <Value label="Story Complete at" value={`${(STORY_CONFIG.coverageRatio * 100).toFixed(1)}%`} />
            <Value label="Max timeline missing" value={`${STORY_CONFIG.maxUncoveredSeconds}s`} />
            <Value label="Season pass tiers" value={`${SEASON_PASS_CONFIG.tierCount}`} />
            <Value label="Annual plan" value={`${BUDGET_CONFIG.annualHours}h`} />
            <Value label="Weekly anchor" value={`${BUDGET_CONFIG.weeklyTargetHours}h`} />
            <Value label="Major-event week cap" value={`${BUDGET_CONFIG.maxMajorEventWeeklyHours}h`} />
          </dl>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="A note on the design" />
        <PanelBody className="space-y-2.5 text-sm leading-relaxed text-ink-dim">
          <p>
            Nothing in this application can reduce your XP, your level, your statistics or your
            collections. Challenges expire without penalty, streaks freeze rather than break, and
            exceeding the annual plan costs nothing at all.
          </p>
          <p>
            Completion percentages always apply to something you defined — a season, a mastery tree,
            a pass, your own library. There is deliberately no figure implying that every endurance
            race in existence is waiting to be watched.
          </p>
          <p className="text-ink-faint">Watching endurance racing is the hobby. This is only the scoreboard.</p>
        </PanelBody>
      </Panel>
    </div>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label mb-0.5">{label}</dt>
      <dd className="timing text-sm text-ink-muted">{value}</dd>
    </div>
  );
}
