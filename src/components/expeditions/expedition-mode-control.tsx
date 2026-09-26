'use client';

/**
 * Expedition Mode, for one race.
 *
 * A switch showing whether the race is followed as an Expedition, whatever
 * decided it. While the race follows its length the caption says so; once the
 * user has chosen, "Reset to automatic" hands the decision back. (A three-way
 * Automatic · On · Off control read the same for a ten-hour race whichever of
 * the first two was chosen.) Switching off takes nothing back, and the
 * message after each switch says what it did.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { EXPEDITION_SHAPE } from '@/lib/config';
import { Toggle } from '@/components/ui/controls';
import { setExpeditionModeAction } from '@/lib/server/career-actions';
import { cn } from '@/lib/utils';

export type ExpeditionModeValue = 'auto' | 'on' | 'off';

export function ExpeditionModeControl({
  raceId, mode, isExpedition, label, className,
}: {
  raceId: string;
  mode: ExpeditionModeValue;
  /** Whether the race is an Expedition now. */
  isExpedition: boolean;
  /** The switch's words; "Expedition Mode: on" or "…: off" when not given. */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);

  function choose(next: ExpeditionModeValue) {
    startTransition(async () => {
      const result = await setExpeditionModeAction(raceId, next);
      setMessage(result.message ?? null);
      router.refresh();
    });
  }

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Toggle
          checked={isExpedition}
          disabled={pending}
          onChange={(on) => choose(on ? 'on' : 'off')}
          label={label ?? `Expedition Mode: ${isExpedition ? 'on' : 'off'}`}
        />
        {mode === 'auto' ? (
          <span className="text-xs text-ink-dim">
            Automatic for races of {EXPEDITION_SHAPE.autoThresholdHours} hours or more
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => choose('auto')}
            className="text-xs text-ink-dim underline-offset-2 hover:text-ink-muted hover:underline disabled:opacity-60"
          >
            Reset to automatic
          </button>
        )}
      </div>
      {message !== null ? (
        <p role="status" className="text-xs text-ink-muted">{message}</p>
      ) : null}
    </div>
  );
}
