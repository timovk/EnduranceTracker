/**
 * "What's new", shown once per account per version.
 *
 * Remembered per account rather than per installation: two people sharing a
 * PC each get to see what changed, and nobody sees it twice. A brand-new
 * account is marked as having seen the version it was created on — somebody
 * opening the app for the first time is not being told about an update.
 */

import { prisma } from '@/lib/db/client';
import { releaseNotesSince, type ChangelogEntry } from '@/lib/changelog';
import { APP_VERSION } from '@/lib/version';

/** The `ConfigOverride` key holding the last version whose notes were seen. */
export const LAST_SEEN_VERSION_KEY = 'lastSeenVersion';

/**
 * The notes this account has not seen yet, newest first: every version since
 * the last one it saw, so a skipped version is not skipped silently. Empty
 * when there is nothing new.
 */
export async function pendingReleaseNotes(userId: string): Promise<ChangelogEntry[]> {
  const row = await prisma.configOverride.findUnique({
    where: { userId_key: { userId, key: LAST_SEEN_VERSION_KEY } },
    select: { value: true },
  });
  const lastSeen = typeof row?.value === 'string' ? row.value : null;
  return releaseNotesSince(lastSeen, APP_VERSION);
}

export async function markReleaseNotesSeen(userId: string, version: string = APP_VERSION): Promise<void> {
  await prisma.configOverride.upsert({
    where: { userId_key: { userId, key: LAST_SEEN_VERSION_KEY } },
    update: { value: version },
    create: { userId, key: LAST_SEEN_VERSION_KEY, value: version },
  });
}
