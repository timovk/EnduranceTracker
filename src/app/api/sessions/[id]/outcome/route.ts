/**
 * Rebuild a stint summary for a session that has already been committed.
 *
 * The summary screen is built from committed data rather than from the return
 * value of the action, so a refresh shows exactly the same figures and nothing
 * depends on transient client state.
 */

import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth/session';
import { buildOutcomeForSession } from '@/lib/server/session-summary';

export async function GET(_request: Request, context: RouteContext<'/api/sessions/[id]/outcome'>) {
  // This is fetched, not navigated to, so a missing session is answered with a
  // status the caller can read. Redirecting would hand it a sign-in page to
  // parse as JSON.
  const userId = await getSessionUserId();
  if (userId === null) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { id } = await context.params;
  const outcome = await buildOutcomeForSession(userId, id);
  if (!outcome) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(outcome);
}
