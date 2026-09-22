-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Driver',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "weekStart" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "career_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "lastActiveDate" DATETIME,
    "momentumPoints" REAL NOT NULL DEFAULT 0,
    "momentumTierKey" TEXT NOT NULL DEFAULT 'cold_tyres',
    "momentumUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "career_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "championships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortName" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "isCustom" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "championships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "championship_seasons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "championshipId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "label" TEXT,
    "plannedRaceCount" INTEGER,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "championship_seasons_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "championships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "races" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "championshipId" TEXT,
    "seasonId" TEXT,
    "circuit" TEXT,
    "circuitSlug" TEXT,
    "country" TEXT,
    "raceDate" DATETIME,
    "scheduledDurationSec" INTEGER NOT NULL,
    "actualDurationSec" INTEGER,
    "runtimeSec" INTEGER NOT NULL,
    "raceType" TEXT NOT NULL DEFAULT 'H6',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "excitement" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'UNWATCHED',
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
    "avgPlaybackSpeed" REAL NOT NULL DEFAULT 1,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "lastWatchedAt" DATETIME,
    "storyCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "raceMasteryId" TEXT,
    CONSTRAINT "races_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "races_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "championships" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "races_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "championship_seasons" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "races_raceMasteryId_fkey" FOREIGN KEY ("raceMasteryId") REFERENCES "race_masteries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "race_viewing_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTimestampSec" INTEGER NOT NULL,
    "endTimestampSec" INTEGER NOT NULL,
    "playbackSpeed" REAL NOT NULL DEFAULT 1,
    "timelineSeconds" INTEGER NOT NULL,
    "realSeconds" INTEGER NOT NULL,
    "newCoverageSeconds" INTEGER NOT NULL,
    "coverageBeforeSec" INTEGER NOT NULL DEFAULT 0,
    "coverageAfterSec" INTEGER NOT NULL DEFAULT 0,
    "careerXpAwarded" INTEGER NOT NULL DEFAULT 0,
    "seasonXpAwarded" INTEGER NOT NULL DEFAULT 0,
    "watchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "race_viewing_sessions_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "race_viewing_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "watched_intervals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "raceId" TEXT NOT NULL,
    "startSec" INTEGER NOT NULL,
    "endSec" INTEGER NOT NULL,
    "sessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "watched_intervals_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "watched_intervals_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "race_viewing_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "race_masteries" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "race_masteries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "xp_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "seasonAmount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "sourceRef" TEXT,
    "sessionId" TEXT,
    "seasonPassId" TEXT,
    "careerXpAfter" BIGINT NOT NULL DEFAULT 0,
    "levelAfter" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "xp_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "xp_transactions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "race_viewing_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "xp_transactions_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "season_passes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "metric" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "iconKey" TEXT NOT NULL DEFAULT 'trophy',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100
);

-- CreateTable
CREATE TABLE "achievement_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "achievementKey" TEXT NOT NULL,
    "value" REAL NOT NULL DEFAULT 0,
    "target" REAL NOT NULL,
    "unlockedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "achievement_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "achievement_progress_achievementKey_fkey" FOREIGN KEY ("achievementKey") REFERENCES "achievements" ("key") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "milestone_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "reachedAt" DATETIME,
    "valueAtReach" REAL,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "milestone_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "target" REAL NOT NULL,
    "params" JSONB NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "seasonXpReward" INTEGER NOT NULL DEFAULT 0,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "challenge_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challengeId" TEXT NOT NULL,
    "value" REAL NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "completedAt" DATETIME,
    "expiredAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "challenge_progress_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "season_passes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "seasonXp" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "season_passes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "season_pass_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonPassId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "xpRequired" INTEGER NOT NULL,
    "rewardKey" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardName" TEXT NOT NULL,
    "rewardRarity" TEXT NOT NULL DEFAULT 'COMMON',
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "unlockedAt" DATETIME,
    CONSTRAINT "season_pass_progress_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "season_passes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mastery_trees" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "championshipId" TEXT,
    "iconicKey" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "mastery_trees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mastery_trees_championshipId_fkey" FOREIGN KEY ("championshipId") REFERENCES "championships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mastery_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    CONSTRAINT "mastery_nodes_treeId_fkey" FOREIGN KEY ("treeId") REFERENCES "mastery_trees" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mastery_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "value" REAL NOT NULL DEFAULT 0,
    "target" REAL NOT NULL,
    "unlockedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "mastery_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mastery_progress_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "mastery_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "seasonId" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "collections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collections_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "championship_seasons" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "raceId" TEXT,
    "filledAt" DATETIME,
    "storyComplete" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "collection_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_items_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trophies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'RARE',
    "iconKey" TEXT NOT NULL DEFAULT 'trophy',
    "accentColor" TEXT NOT NULL DEFAULT '#c8a45c',
    "metadata" JSONB NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trophies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "hall_of_fame_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "category" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'RARE',
    "raceId" TEXT,
    "championshipName" TEXT,
    "seasonLabel" TEXT,
    "snapshot" JSONB NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hall_of_fame_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hall_of_fame_entries_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "budget_years" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "annualBudgetHours" REAL NOT NULL DEFAULT 336,
    "weeklyTargetHours" REAL NOT NULL DEFAULT 8,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "budget_years_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "budget_weeks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budgetYearId" TEXT NOT NULL,
    "isoYear" INTEGER NOT NULL,
    "isoWeek" INTEGER NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "weekEnd" DATETIME NOT NULL,
    "recommendedHours" REAL NOT NULL DEFAULT 0,
    "rationale" JSONB NOT NULL,
    "isRestWeek" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "budget_weeks_budgetYearId_fkey" FOREIGN KEY ("budgetYearId") REFERENCES "budget_years" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "momentum_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "points" REAL NOT NULL,
    "tierKey" TEXT NOT NULL,
    "realSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "momentum_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "config_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "config_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
