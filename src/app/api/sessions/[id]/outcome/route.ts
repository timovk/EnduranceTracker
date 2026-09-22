/**
 * Rebuild a stint summary for a session that has already been committed.
 *
 * The summary screen is built from committed data rather than from the return
 * value of the action, so a refresh shows exactly the same figures and nothing
 * depends on transient client state.
 */

import { NextResponse } from 'next/server';
import { USER_ID } from '@/lib/db/client';
import { buildOutcomeForSession } from '@/lib/server/session-summary';

export async function GET(_request: Request, context: RouteContext<'/api/sessions/[id]/outcome'>) {
  const { id } = await context.params;
  const outcome = await buildOutcomeForSession(USER_ID, id);
  if (!outcome) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(outcome);
}
