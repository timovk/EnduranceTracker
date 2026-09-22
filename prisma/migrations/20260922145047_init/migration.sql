-- CreateEnum
CREATE TYPE "RaceType" AS ENUM ('SPRINT_ENDURANCE', 'H4', 'H6', 'H8', 'H10', 'H12', 'H24', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RaceStatus" AS ENUM ('UNWATCHED', 'QUEUED', 'WATCHING', 'PAUSED', 'COMPLETED', 'ABANDONED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RacePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'MUST_WATCH');

-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');

-- CreateEnum
CREATE TYPE "ChallengeScope" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'SEASONAL');

-- CreateEnum
CREATE TYPE "ChallengeState" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "XPSource" AS ENUM ('VIEWING', 'REWATCH', 'STORY_COMPLETE', 'RACE_COMPLETE', 'ACHIEVEMENT', 'CHALLENGE', 'MASTERY_NODE', 'SEASON_COMPLETE', 'MAJOR_EVENT', 'MILESTONE', 'SEASON_PASS_TIER', 'PRESTIGE', 'HALL_OF_FAME', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MasteryKind" AS ENUM ('CHAMPIONSHIP', 'RACE_EVENT', 'GLOBAL');

-- CreateEnum
CREATE TYPE "CollectionKind" AS ENUM ('SEASON', 'MAJOR_EVENT', 'CIRCUIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TrophyCategory" AS ENUM ('SEASON', 'MAJOR_EVENT', 'MASTERY', 'PRESTIGE', 'ACHIEVEMENT', 'SEASON_PASS', 'MILESTONE');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('BADGE', 'TITLE', 'THEME', 'RACE_CARD', 'TROPHY_ITEM', 'PATCH', 'EMBLEM', 'BANNER', 'POSTER', 'XP_BONUS', 'HALL_OF_FAME_COLLECTIBLE');

-- CreateEnum
CREATE TYPE "HallOfFameCategory" AS ENUM ('FIRST', 'MILESTONE', 'SEASON', 'MAJOR_EVENT', 'CAREER', 'MASTERY', 'SEASON_PASS', 'PRESTIGE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Driver',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "weekStart" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "careerXp" BIGINT NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "prestige" INTEGER NOT NULL DEFAULT 0,
    "titleKey" TEXT,
    "themeKey" TEXT NOT NULL DEFAULT 'graphite',
    "raceCardKey" TEXT NOT NULL DEFAULT 'classic',
    "bannerKey" TEXT,
    "badgeKey" TEXT,
    "currentStreakDays" INTEGER NOT NULL DEFAULT 0,
    "longestStreakDays" INTEGER NOT NULL DEFAULT 0,
    "lifetimeActiveDays" INTEGER NOT NULL DEFAULT 0,
    "lifetimeActiveWeeks" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TIMESTAMP(3),
    "momentumPoints" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "momentumTierKey" TEXT NOT NULL DEFAULT 'cold_tyres',
    "momentumUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "career_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "championships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortName" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "isCustom" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "championships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "championship_seasons" (
    "id" TEXT NOT NULL,
    "championshipId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "label" TEXT,
    "plannedRaceCount" INTEGER,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "championship_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "races" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "championshipId" TEXT,
    "seasonId" TEXT,
    "circuit" TEXT,
    "circuitSlug" TEXT,
    "country" TEXT,
    "raceDate" TIMESTAMP(3),
    "scheduledDurationSec" INTEGER NOT NULL,
    "actualDurationSec" INTEGER,
    "runtimeSec" INTEGER NOT NULL,
    "raceType" "RaceType" NOT NULL DEFAULT 'H6',
    "priority" "RacePriority" NOT NULL DEFAULT 'NORMAL',
    "excitement" INTEGER NOT NULL DEFAULT 3,
    "status" "RaceStatus" NOT NULL DEFAULT 'UNWATCHED',
    "isMajorEvent" BOOLEAN NOT NULL DEFAULT false,
    "iconicKey" TEXT,
    "notes" TEXT,
    "replayUrl" TEXT,
    "posterUrl" TEXT,
    "coverageSec" INTEGER NOT NULL DEFAULT 0,
    "realViewingSec" INTEGER NOT NULL DEFAULT 0,
    "timelineWatchedSec" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "furthestTimestampSec" INTEGER NOT NULL DEFAULT 0,
    "avgPlaybackSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastWatchedAt" TIMESTAMP(3),
    "storyCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "raceMasteryId" TEXT,

    CONSTRAINT "races_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_viewing_sessions" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTimestampSec" INTEGER NOT NULL,
    "endTimestampSec" INTEGER NOT NULL,
    "playbackSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "timelineSeconds" INTEGER NOT NULL,
    "realSeconds" INTEGER NOT NULL,
    "newCoverageSeconds" INTEGER NOT NULL,
    "coverageBeforeSec" INTEGER NOT NULL DEFAULT 0,
    "coverageAfterSec" INTEGER NOT NULL DEFAULT 0,
    "careerXpAwarded" INTEGER NOT NULL DEFAULT 0,
    "seasonXpAwarded" INTEGER NOT NULL DEFAULT 0,
    "watchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "race_viewing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watched_intervals" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "startSec" INTEGER NOT NULL,
    "endSec" INTEGER NOT NULL,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watched_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_masteries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "editionsTracked" INTEGER NOT NULL DEFAULT 0,
    "editionsStoryComplete" INTEGER NOT NULL DEFAULT 0,
    "totalRealSec" INTEGER NOT NULL DEFAULT 0,
    "totalTimelineSec" INTEGER NOT NULL DEFAULT 0,
    "firstCompletedYear" INTEGER,
    "latestCompletedYear" INTEGER,
    "longestConsecutiveEditions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "race_masteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "XPSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "seasonAmount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sessionId" TEXT,
    "seasonPassId" TEXT,
    "careerXpAfter" BIGINT NOT NULL DEFAULT 0,
    "levelAfter" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rarity" "Rarity" NOT NULL DEFAULT 'COMMON',
    "metric" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "iconKey" TEXT NOT NULL DEFAULT 'trophy',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievement_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "reachedAt" TIMESTAMP(3),
    "valueAtReach" DOUBLE PRECISION,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ChallengeScope" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "seasonXpReward" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_progress" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "state" "ChallengeState" NOT NULL DEFAULT 'ACTIVE',
    "completedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenge_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_passes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "seasonXp" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_pass_progress" (
    "id" TEXT NOT NULL,
    "seasonPassId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "xpRequired" INTEGER NOT NULL,
    "rewardKey" TEXT NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "rewardName" TEXT NOT NULL,
    "rewardRarity" "Rarity" NOT NULL DEFAULT 'COMMON',
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "unlockedAt" TIMESTAMP(3),

    CONSTRAINT "season_pass_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastery_trees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MasteryKind" NOT NULL,
    "championshipId" TEXT,
    "iconicKey" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mastery_trees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastery_nodes" (
    "id" TEXT NOT NULL,
    "treeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "rarity" "Rarity" NOT NULL DEFAULT 'COMMON',

    CONSTRAINT "mastery_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastery_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "unlockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mastery_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "CollectionKind" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "seasonId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "raceId" TEXT,
    "filledAt" TIMESTAMP(3),
    "storyComplete" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trophies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "TrophyCategory" NOT NULL,
    "rarity" "Rarity" NOT NULL DEFAULT 'RARE',
    "iconKey" TEXT NOT NULL DEFAULT 'trophy',
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trophies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hall_of_fame_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "category" "HallOfFameCategory" NOT NULL,
    "rarity" "Rarity" NOT NULL DEFAULT 'RARE',
    "raceId" TEXT,
    "championshipName" TEXT,
    "seasonLabel" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hall_of_fame_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_years" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "annualBudgetHours" DOUBLE PRECISION NOT NULL DEFAULT 336,
    "weeklyTargetHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_weeks" (
    "id" TEXT NOT NULL,
    "budgetYearId" TEXT NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "recommendedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rationale" JSONB NOT NULL DEFAULT '[]',
    "isRestWeek" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "momentum_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "tierKey" TEXT NOT NULL,
    "realSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "momentum_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "career_profiles_userId_key" ON "career_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "championships_userId_slug_key" ON "championships"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "championship_seasons_championshipId_year_key" ON "championship_seasons"("championshipId", "year");

-- CreateIndex
CREATE INDEX "races_userId_status_idx" ON "races"("userId", "status");

-- CreateIndex
CREATE INDEX "races_userId_championshipId_idx" ON "races"("userId", "championshipId");

-- CreateIndex
CREATE INDEX "races_userId_seasonId_idx" ON "races"("userId", "seasonId");

-- CreateIndex
CREATE INDEX "races_userId_iconicKey_idx" ON "races"("userId", "iconicKey");

-- CreateIndex
CREATE INDEX "races_userId_raceDate_idx" ON "races"("userId", "raceDate");

-- CreateIndex
CREATE INDEX "race_viewing_sessions_userId_watchedAt_idx" ON "race_viewing_sessions"("userId", "watchedAt");

-- CreateIndex
CREATE INDEX "race_viewing_sessions_raceId_watchedAt_idx" ON "race_viewing_sessions"("raceId", "watchedAt");

-- CreateIndex
CREATE INDEX "watched_intervals_raceId_startSec_idx" ON "watched_intervals"("raceId", "startSec");

-- CreateIndex
CREATE UNIQUE INDEX "race_masteries_userId_key_key" ON "race_masteries"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "xp_transactions_dedupeKey_key" ON "xp_transactions"("dedupeKey");

-- CreateIndex
CREATE INDEX "xp_transactions_userId_createdAt_idx" ON "xp_transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "xp_transactions_userId_source_idx" ON "xp_transactions"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_key_key" ON "achievements"("key");

-- CreateIndex
CREATE INDEX "achievement_progress_userId_unlockedAt_idx" ON "achievement_progress"("userId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "achievement_progress_userId_achievementKey_key" ON "achievement_progress"("userId", "achievementKey");

-- CreateIndex
CREATE INDEX "milestone_progress_userId_metric_idx" ON "milestone_progress"("userId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "milestone_progress_userId_metric_threshold_key" ON "milestone_progress"("userId", "metric", "threshold");

-- CreateIndex
CREATE INDEX "challenges_userId_scope_periodEnd_idx" ON "challenges"("userId", "scope", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "challenges_userId_scope_templateKey_periodStart_key" ON "challenges"("userId", "scope", "templateKey", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_progress_challengeId_key" ON "challenge_progress"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "season_passes_userId_year_quarter_key" ON "season_passes"("userId", "year", "quarter");

-- CreateIndex
CREATE INDEX "season_pass_progress_seasonPassId_unlockedAt_idx" ON "season_pass_progress"("seasonPassId", "unlockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "season_pass_progress_seasonPassId_tier_key" ON "season_pass_progress"("seasonPassId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "mastery_trees_userId_key_key" ON "mastery_trees"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "mastery_nodes_treeId_key_key" ON "mastery_nodes"("treeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "mastery_progress_userId_nodeId_key" ON "mastery_progress"("userId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "collections_userId_key_key" ON "collections"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "collection_items_collectionId_key_key" ON "collection_items"("collectionId", "key");

-- CreateIndex
CREATE INDEX "trophies_userId_awardedAt_idx" ON "trophies"("userId", "awardedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trophies_userId_key_key" ON "trophies"("userId", "key");

-- CreateIndex
CREATE INDEX "hall_of_fame_entries_userId_occurredAt_idx" ON "hall_of_fame_entries"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "hall_of_fame_entries_userId_key_key" ON "hall_of_fame_entries"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "budget_years_userId_year_key" ON "budget_years"("userId", "year");

-- CreateIndex
CREATE INDEX "budget_weeks_budgetYearId_weekStart_idx" ON "budget_weeks"("budgetYearId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "budget_weeks_budgetYearId_isoYear_isoWeek_key" ON "budget_weeks"("budgetYearId", "isoYear", "isoWeek");

-- CreateIndex
CREATE INDEX "momentum_history_userId_date_idx" ON "momentum_history"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "momentum_history_userId_date_key" ON "momentum_history"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "config_overrides_userId_key_key" ON "config_overrides"("userId", "key");

-- AddForeignKey
ALTER TABLE "career_profiles" ADD CONSTRAINT "career_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "championships" ADD CONSTRAINT "championships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "championship_seasons" ADD CONSTRAINT "championship_seasons_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "championships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "races" ADD CONSTRAINT "races_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "races" ADD CONSTRAINT "races_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "championships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "races" ADD CONSTRAINT "races_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "championship_seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "races" ADD CONSTRAINT "races_raceMasteryId_fkey" FOREIGN KEY ("raceMasteryId") REFERENCES "race_masteries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_viewing_sessions" ADD CONSTRAINT "race_viewing_sessions_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_viewing_sessions" ADD CONSTRAINT "race_viewing_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watched_intervals" ADD CONSTRAINT "watched_intervals_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watched_intervals" ADD CONSTRAINT "watched_intervals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "race_viewing_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "race_masteries" ADD CONSTRAINT "race_masteries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "race_viewing_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "season_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_achievementKey_fkey" FOREIGN KEY ("achievementKey") REFERENCES "achievements"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone_progress" ADD CONSTRAINT "milestone_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_progress" ADD CONSTRAINT "challenge_progress_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_passes" ADD CONSTRAINT "season_passes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_pass_progress" ADD CONSTRAINT "season_pass_progress_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "season_passes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_trees" ADD CONSTRAINT "mastery_trees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_trees" ADD CONSTRAINT "mastery_trees_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "championships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_nodes" ADD CONSTRAINT "mastery_nodes_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "mastery_trees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_progress" ADD CONSTRAINT "mastery_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mastery_progress" ADD CONSTRAINT "mastery_progress_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "mastery_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "championship_seasons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trophies" ADD CONSTRAINT "trophies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hall_of_fame_entries" ADD CONSTRAINT "hall_of_fame_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hall_of_fame_entries" ADD CONSTRAINT "hall_of_fame_entries_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_years" ADD CONSTRAINT "budget_years_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_weeks" ADD CONSTRAINT "budget_weeks_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "budget_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "momentum_history" ADD CONSTRAINT "momentum_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_overrides" ADD CONSTRAINT "config_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
