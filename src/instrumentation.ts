/**
 * Server start-up.
 *
 * Next calls `register` once per server start, and the server does not serve a
 * request until it has finished — which is what makes it the right place for
 * a one-time upgrade step: nobody can open a page, or log a stint, against a
 * career that is halfway through being upgraded.
 *
 * The work is Node-only (it needs Prisma and SQLite), so it sits behind the
 * `NEXT_RUNTIME` check with a dynamic import, as the Next docs require;
 * a static import would pull Prisma into the edge bundle.
 *
 * Next does not call `register` during `next build` (it checks `NEXT_PHASE`
 * before registering), so building the app never touches a database.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
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
  }
}
