/**
 * Freezing finished years of the Career Chronicle (0.4.0), from the places
 * that may read the clock: the server's start-up, and the pages and actions
 * that freeze what is due before they read or write.
 *
 * A finished year is frozen once its 72-hour grace period is over and the
 * account's 0.4.0 backfill is complete (`ensureChroniclesFrozen`). At start-up
 * every such account is given the chance, oldest-served first in the same
 * start-up budget the backfill uses; after that, whatever is still due is
 * frozen by the first Chronicle page, dashboard or write that account makes.
 * A failure is logged and never stops anything: the year simply stays live,
 * marked "finalising", until the next try.
 */

import { prisma } from '@/lib/db/client';
import { ensureChroniclesFrozen } from '@/lib/engines/chronicle-engine';
import { isCareerBackfillApplied, type Logger } from './career-backfill';

const CONSOLE: Logger = {
  info: (line) => console.log(line),
  error: (line, error) => console.error(line, error),
};

export interface ChronicleFreezeSummary {
  userId: string;
  /** The years frozen for the account, oldest first. */
  frozen: number[];
}

/** "2025", "2024 and 2025", "2023, 2024 and 2025". */
function yearList(years: readonly number[]): string {
  return years.length <= 1
    ? years.join('')
    : `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;
}

/**
 * The start-up freeze pass (§5.4): every account whose backfill is complete,
 * while `shouldContinue()` says there is still time, has its due years frozen.
 * An account the backfill has not finished is left for the backfill, whose
 * last phase freezes its years. Cheap when nothing is due, which is every
 * start but the first few of a year. One line per account that had a year
 * frozen; nothing at all for the rest.
 */
export async function freezeAllChronicles(options: {
  now: Date;
  shouldContinue: () => boolean;
  log?: Logger;
}): Promise<ChronicleFreezeSummary[]> {
  const log = options.log ?? CONSOLE;
  const users = await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });

  const summaries: ChronicleFreezeSummary[] = [];
  for (const user of users) {
    if (!options.shouldContinue()) break;
    try {
      if (!(await isCareerBackfillApplied(user.id))) continue;
      const frozen = await ensureChroniclesFrozen(user.id, options.now);
      summaries.push({ userId: user.id, frozen });
      if (frozen.length > 0) {
        log.info(`[chronicle] ${user.name} (${user.id}): froze the ${yearList(frozen)} ${frozen.length === 1 ? 'chapter' : 'chapters'}`);
      }
    } catch (error) {
      log.error(`[chronicle] ${user.name} (${user.id}): could not freeze its finished years; the Chronicle will try again when opened`, error);
    }
  }
  return summaries;
}

/**
 * Freeze an account's finished years before a page reads them or a write
 * changes the history behind them (§4.0, §4.5.2). A failure is logged, never
 * thrown: the page or the write goes ahead, the year stays live, and the next
 * one tries again.
 */
export async function freezeFinishedYears(userId: string, now: Date): Promise<number[]> {
  try {
    return await ensureChroniclesFrozen(userId, now);
  } catch (error) {
    CONSOLE.error(`[chronicle] ${userId}: could not freeze its finished years; they stay live until the next try`, error);
    return [];
  }
}
