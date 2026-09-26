/**
 * Server start-up.
 *
 * Next calls `register` once per server start, and the server does not serve a
 * request until it has finished — which is what makes it the right place for
 * a one-time upgrade step: nobody can open a page, or log a stint, against a
 * career that is halfway through being upgraded.
 *
 * The work is Node-only (it needs Prisma and SQLite), so it sits behind the
 * `NEXT_RUNTIME` check with dynamic imports, as the Next docs require; a
 * static import would pull Prisma into the edge bundle.
 *
 * Next does not call `register` during `next build` (it checks `NEXT_PHASE`
 * before registering), so building the app never touches a database.
 *
 * Everything here shares one start-up budget (`STARTUP_BUDGET_MS`), measured
 * from the moment `register` starts: the desktop shell waits for the server
 * to answer, and an upgrade that runs out of time carries on at the next
 * start rather than holding this one up. The Chronicle's freeze pass comes
 * last and takes what the backfill leaves.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const startedAt = Date.now();

    // 0.3.1: the one-time season reset. A failure is logged — the desktop
    // shell captures the server's output into its log — and never stops the
    // server starting. An account it fails on is left unmarked, so the next
    // start tries it again.
    try {
      const { resetSeasonRewards } = await import('@/lib/server/upgrades/season-reset');
      await resetSeasonRewards();
    } catch (error) {
      console.error('[season-reset] could not run at start-up; it will be tried again on the next start', error);
    }

    // Everything below shares one start-up budget, measured from the moment
    // `register` began: the backfill works through it chunk by chunk, and
    // the Chronicle's freeze pass takes whatever is left.
    const { deadlineClock, STARTUP_BUDGET_MS } = await import('@/lib/server/upgrades/career-backfill');
    const clock = deadlineClock(startedAt + STARTUP_BUDGET_MS);

    // 0.4.0: the career backfill, as far as the start-up budget allows. It
    // records its progress as it goes, so an account it does not finish, or
    // fails on, carries on from where it stopped at the next start.
    try {
      const { runCareerBackfill } = await import('@/lib/server/upgrades/career-backfill');
      await runCareerBackfill({ now: new Date(), clock });
    } catch (error) {
      console.error('[career-backfill] could not run at start-up; it will be tried again on the next start', error);
    }

    // 0.4.0: the Chronicle's freeze pass, on every start. A finished year is
    // frozen once its grace period is over, for every account whose backfill
    // is complete; when nothing is due, which is almost always, it costs a
    // few small reads per account.
    try {
      const { freezeAllChronicles } = await import('@/lib/server/upgrades/chronicle-freeze');
      await freezeAllChronicles({ now: new Date(), shouldContinue: () => clock.shouldStartChunk(1_000) });
    } catch (error) {
      console.error('[chronicle] could not freeze finished years at start-up; the Chronicle will try again when opened', error);
    }
  }
}
