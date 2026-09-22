/**
 * The current stint.
 *
 * Whatever is furthest along and most recently touched, with a resume point
 * that lands on the first *unwatched* gap rather than on the furthest
 * timestamp reached — so skipping a section quietly points you back at it.
 */

import Link from 'next/link';
import { Play } from 'lucide-react';
import { formatDuration, formatTimestamp } from '@/lib/domain/time';
import type { Interval } from '@/lib/domain/types';
import { Panel, PanelHeader, PanelBody, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { RaceTimeline } from '@/components/races/race-timeline';

export interface CurrentStintData {
  raceId: string;
  raceName: string;
  championshipName: string | null;
  championshipColor: string | null;
  runtimeSec: number;
  coverageSec: number;
  intervals: Interval[];
  resumeAtSec: number;
  completionPercent: number;
  realRemainingSec: number;
  playbackSpeed: number;
}

export function CurrentStint({ stint }: { stint: CurrentStintData | null }) {
  if (!stint) {
    return (
      <Panel>
        <PanelHeader title="Current stint" />
        <EmptyState
          title="Nothing in progress"
          body="When you start a race it appears here, with the exact point to pick it up from."
          action={<Link href="/races"><Button size="sm" variant="subtle">Browse the library</Button></Link>}
        />
      </Panel>
    );
  }

  const accent = stint.championshipColor ?? 'var(--accent)';

  return (
    <Panel accent={accent}>
      <PanelHeader title="Current stint" />
      <PanelBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium text-ink">{stint.raceName}</h3>
            {stint.championshipName ? (
              <p className="mt-0.5 truncate text-xs text-ink-dim">{stint.championshipName}</p>
            ) : null}
          </div>
          <Link href={`/races/${stint.raceId}`} className="shrink-0">
            <Button variant="primary" size="sm">
              <Play size={13} /> Resume
            </Button>
          </Link>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="label mb-1">Resume at</div>
            <div className="timing text-timing text-ink">{formatTimestamp(stint.resumeAtSec)}</div>
          </div>
          <div>
            <div className="label mb-1">Complete</div>
            <div className="timing text-xl text-ink-muted">{stint.completionPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="label mb-1">Left at {stint.playbackSpeed}×</div>
            <div className="timing text-xl text-ink-muted">{formatDuration(stint.realRemainingSec)}</div>
          </div>
        </div>

        <RaceTimeline intervals={stint.intervals} runtimeSec={stint.runtimeSec} accent={accent} />
      </PanelBody>
    </Panel>
  );
}
