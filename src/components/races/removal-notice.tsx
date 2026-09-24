'use client';

/**
 * The library's one-line notice after a race was removed (0.4.0).
 *
 * The race page sends the library `?removed=<name>&xp=<n>`, and the page turns
 * the two into a sentence. It is said once: the parameters come off the
 * address as soon as the notice is on screen, so a refresh, a filter or a
 * copied link does not repeat it. Taking them off with the history API does
 * not re-render the page, so the notice stays until the next navigation.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export function RemovalNotice({ message, className }: { message: string; className?: string }) {
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('removed') && !url.searchParams.has('xp')) return;
    url.searchParams.delete('removed');
    url.searchParams.delete('xp');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return (
    <p
      role="status"
      className={cn('rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted', className)}
    >
      {message}
    </p>
  );
}
