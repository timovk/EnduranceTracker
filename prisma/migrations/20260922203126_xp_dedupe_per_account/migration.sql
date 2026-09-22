-- DropIndex
DROP INDEX "xp_transactions_dedupeKey_key";

-- CreateIndex
CREATE UNIQUE INDEX "xp_transactions_userId_dedupeKey_key" ON "xp_transactions"("userId", "dedupeKey");

