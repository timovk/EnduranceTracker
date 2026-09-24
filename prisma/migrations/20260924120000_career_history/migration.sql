-- AlterTable
ALTER TABLE "races" ADD COLUMN "creditedViewingSec" INTEGER;
ALTER TABLE "races" ADD COLUMN "expeditionMode" BOOLEAN;

-- AlterTable
ALTER TABLE "race_masteries" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "race_masteries" ADD COLUMN "createdByUser" BOOLEAN;
ALTER TABLE "race_masteries" ADD COLUMN "displayName" TEXT;
ALTER TABLE "race_masteries" ADD COLUMN "mergedIntoId" TEXT;

-- AlterTable
ALTER TABLE "milestone_progress" ADD COLUMN "achievedAt" DATETIME;
ALTER TABLE "milestone_progress" ADD COLUMN "achievedPrecision" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "eventId" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "raceId" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "milestone_progress" ADD COLUMN "subjectName" TEXT;

-- AlterTable
ALTER TABLE "mastery_progress" ADD COLUMN "achievedAt" DATETIME;
ALTER TABLE "mastery_progress" ADD COLUMN "achievedPrecision" TEXT;
ALTER TABLE "mastery_progress" ADD COLUMN "achievedSessionId" TEXT;

-- CreateTable
CREATE TABLE "expedition_summaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "raceId" TEXT,
    "raceName" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME NOT NULL,
    "retrospective" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expedition_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expedition_summaries_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "races" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chronicle_years" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "frozenAt" DATETIME NOT NULL,
    "rebuiltAt" DATETIME,
    "wrappedSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chronicle_years_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "event_step_credits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "fingerprint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_step_credits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "expedition_summaries_userId_completedAt_idx" ON "expedition_summaries"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "expedition_summaries_raceId_idx" ON "expedition_summaries"("raceId");

-- CreateIndex
CREATE UNIQUE INDEX "expedition_summaries_userId_raceId_key" ON "expedition_summaries"("userId", "raceId");

-- CreateIndex
CREATE UNIQUE INDEX "chronicle_years_userId_year_key" ON "chronicle_years"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "event_step_credits_userId_nodeKey_raceId_key" ON "event_step_credits"("userId", "nodeKey", "raceId");

-- CreateIndex
CREATE INDEX "races_userId_raceMasteryId_idx" ON "races"("userId", "raceMasteryId");

-- CreateIndex
CREATE INDEX "watched_intervals_sessionId_idx" ON "watched_intervals"("sessionId");

-- CreateIndex
CREATE INDEX "xp_transactions_sessionId_idx" ON "xp_transactions"("sessionId");

