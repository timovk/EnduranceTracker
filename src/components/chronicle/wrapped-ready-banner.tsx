'use client';

/**
 * "Your 2026 Endurance Wrapped is ready": the one prompt a finished, frozen
 * year gets, on the dashboard and above the Chronicle. It opens nothing by
 * itself. Open goes to the cards; Hide marks the Wrapped seen, and it stays in
 * the Chronicle to be opened whenever the user likes.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/controls';
import { Panel } from '@/components/ui/primitives';
import { markWrappedSeenAction } from '@/lib/server/career-actions';

export function WrappedReadyBanner({ year }: { year: number }) {
  const router = useRouter();
  const [hidden, setHidden] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  if (hidden) return null;

  function hide() {
    setHidden(true);
    startTransition(async () => {
      await markWrappedSeenAction(year);
      router.refresh();
    });
  }

  return (
    <Panel raised className="border-[var(--accent)]/35">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Sparkles size={16} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Your {year} Endurance Wrapped is ready</p>
            <p className="text-xs text-ink-dim">A few cards about your year at the track, to click through whenever you like.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={`/chronicle/${year}/wrapped`}>
            <Button size="sm" variant="primary">Open</Button>
          </Link>
          <Button size="sm" variant="ghost" onClick={hide} disabled={pending}>Hide</Button>
        </div>
      </div>
    </Panel>
  );
}
