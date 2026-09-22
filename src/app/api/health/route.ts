import { NextResponse } from 'next/server';

/**
 * Readiness probe.
 *
 * The desktop supervisor polls this to decide when the server is up, so it
 * deliberately touches nothing: no database, no session, no configuration. A
 * probe that can fail for a second reason is a splash screen that can hang
 * forever, and the one thing this must never do is stay silent while the
 * application behind it is perfectly healthy.
 */

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true });
}
