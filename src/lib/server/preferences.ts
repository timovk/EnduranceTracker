/**
 * Small per-account preferences that are remembered rather than configured.
 *
 * Stored as `ConfigOverride` rows, which already exist for per-account values,
 * so a new preference costs no database migration.
 */

import { prisma } from '@/lib/db/client';
import { isStintEntryMode, type StintEntryMode } from '@/lib/domain/race-clock';

/** The `ConfigOverride` key for the way stints were last entered. */
export const STINT_ENTRY_MODE_KEY = 'stintEntryMode';

/** How this account last entered a stint; elapsed timestamps until it has. */
export async function getStintEntryMode(userId: string): Promise<StintEntryMode> {
  const row = await prisma.configOverride.findUnique({
    where: { userId_key: { userId, key: STINT_ENTRY_MODE_KEY } },
    select: { value: true },
  });
  return isStintEntryMode(row?.value) ? row.value : 'RANGE';
}

export async function rememberStintEntryMode(userId: string, mode: StintEntryMode): Promise<void> {
  await prisma.configOverride.upsert({
    where: { userId_key: { userId, key: STINT_ENTRY_MODE_KEY } },
    update: { value: mode },
    create: { userId, key: STINT_ENTRY_MODE_KEY, value: mode },
  });
}
