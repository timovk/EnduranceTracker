import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route guard.
 *
 * This runs on the edge runtime, where Prisma cannot go, so it does exactly
 * one cheap thing: send a request carrying no session cookie to the account
 * picker. It proves nothing — a cookie for a session that has already been
 * deleted still gets past it — and it is not meant to. Every page and every
 * action resolves the session properly server-side through `requireUserId`;
 * this only saves the user from watching a page render and then bounce.
 */

/**
 * Kept in step with `SESSION_COOKIE` in src/lib/auth/session.ts by hand.
 * That module is server-only and reaches the database, so importing the
 * constant from it would drag the whole data layer into the edge bundle.
 */
const SESSION_COOKIE = 'endurance_session';

/** The paths that exist precisely because nobody is signed in yet. */
const PUBLIC_PREFIXES = ['/accounts', '/welcome'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  return NextResponse.redirect(new URL('/accounts', request.url));
}

/** Prefix matching, the same shape the navigation uses to decide an active link. */
function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export const config = {
  /*
   * Everything but the framework's own assets, anything with a file extension
   * and the API. A redirect that swallowed /_next/*.js would leave the account
   * screens unstyled, and a route handler is a fetch target: it answers for
   * itself with a status code rather than being bounced to a screen. That
   * covers /api/health, which must stay reachable before anyone signs in.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
