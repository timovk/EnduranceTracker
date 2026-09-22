'use client';

/**
 * The race page.
 *
 * Everything about one race: precise resume position, interval coverage, the
 * gaps still to watch, the full session history, and the form for logging the
 * next stint. A long race additionally gets the 24-hour clock, because a
 * 24-hour race is an expedition and should look like one.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CalendarDays, ExternalLink, Flag, MapPin, Pencil, Play, Star, Trash2, Zap,
} from 'lucide-react';
import type { RaceDetail } from '@/lib/server/races';
import type { SessionOutcome } from '@/lib/engines/contracts';
import { formatDuration, formatTimestamp } from '@/lib/domain/time';
import { Badge, Panel, PanelBody, PanelHeader, Stat, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { GapList, RaceTimeline } from './race-timeline';
import { TwentyFourHourClock } from './twenty-four-hour-clock';
import { LogSessionForm } from './log-session-form';
import { StintSummary } from './stint-summary';
import { deleteRaceAction, deleteSessionAction, logSessionAction } from '@/lib/server/actions';
import { formatDate, formatNumber } from '@/lib/utils';

export function RaceDetailView({
  race, longHaulThresholdSec, outcome: initialOutcome,
}: {
  race: RaceDetail;
  longHaulThresholdSec: number;
  outcome?: SessionOutcome | null;
}) {
  const router = useRouter();
  const [logging, setLogging] = React.useState(false);
  const [outcome, setOutcome] = React.useState<SessionOutcome | null>(initialOutcome ?? null);
  const [pending, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<string | null>(null);

  const accent = race.championship?.accentColor ?? 'var(--accent)';
  const isLongHaul = race.runtimeSec >= longHaulThresholdSec;

  function onLogSession(formData: FormData) {
    startTransition(async () => {
      const result = await logSessionAction(formData);
      if (result.ok && result.data) {
        setLogging(false);
        // Re-read the page so the summary is built from committed data.
        const response = await fetch(`/api/sessions/${result.data.sessionId}/outcome`);
        setOutcome(response.ok ? ((await response.json()) as SessionOutcome) : null);
        router.refresh();
      } else {
        setNotice(result.message ?? 'That stint could not be read.');
      }
    });
  }

  return (
    <div
      className="space-y-4"
      style={{ ['--accent' as string]: accent } as React.CSSProperties}
    >
      {/* ---- Header ------------------------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="label mb-1.5 flex flex-wrap items-center gap-2">
            {race.championship ? (
              <Link href={`/races?championship=${race.championship.id}`} className="text-[var(--accent)]">
                {race.championship.name}
              </Link>
            ) : <span>Unassigned</span>}
            {race.season ? <span>· {race.season.year}</span> : null}
            {race.isMajorEvent ? (
              <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                <Star size={10} fill="currentColor" /> Major event
              </span>
            ) : null}
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{race.name}</h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-dim">
            {race.circuit ? <span className="inline-flex items-center gap-1"><MapPin size={11} />{race.circuit}</span> : null}
            {race.country ? <span>{race.country}</span> : null}
            {race.raceDate ? (
              <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{formatDate(race.raceDate, 'long')}</span>
            ) : null}
            <span className="inline-flex items-center gap-1"><Flag size={11} />{formatDuration(race.runtimeSec)}</span>
            {race.actualDurationSec && race.actualDurationSec !== race.scheduledDurationSec ? (
              <Badge tone="outline" title="This race did not run to its advertised length.">
                scheduled {formatDuration(race.scheduledDurationSec)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {race.replayUrl ? (
            <a href={race.replayUrl} target="_blank" rel="noreferrer noopener">
              <Button variant="subtle" size="sm">Replay <ExternalLink size={12} /></Button>
            </a>
          ) : null}
          <Link href={`/races/${race.id}/edit`}>
            <Button variant="subtle" size="sm"><Pencil size={12} /> Edit</Button>
          </Link>
          {!race.storyComplete ? (
            <Button variant="primary" size="sm" onClick={() => setLogging(true)}>
              <Play size={13} /> Log a stint
            </Button>
          ) : (
            <Button variant="subtle" size="sm" onClick={() => setLogging(true)}>
              Log a re-watch
            </Button>
          )}
        </div>
      </div>

      {notice ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">{notice}</p>
      ) : null}

      {outcome ? (
        <StintSummary outcome={outcome} onDismiss={() => setOutcome(null)} />
      ) : null}

      {/* ---- Progress ---------------------------------------------------- */}
      <Panel>
        <PanelHeader
          title={race.storyComplete ? 'Story Complete' : 'Progress'}
          action={
            race.storyComplete ? (
              <Badge tone="accent">Completed {formatDate(race.storyCompletedAt)}</Badge>
            ) : null
          }
        />
        <PanelBody className="space-y-5">
          <div className="flex flex-wrap items-start gap-6">
            {isLongHaul ? (
              <TwentyFourHourClock
                intervals={race.intervals}
                runtimeSec={race.runtimeSec}
                size={190}
                accent={accent}
              />
            ) : null}

            <div className="min-w-[16rem] flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
                <Stat
                  label="Resume at"
                  value={formatTimestamp(race.resumeAtSec)}
                  sub={`of ${formatTimestamp(race.runtimeSec)}`}
                  size="md"
                />
                <Stat label="Complete" value={`${race.coveragePercent.toFixed(1)}%`} size="md" tone="accent" />
                <Stat
                  label="Timeline left"
                  value={formatDuration(race.timelineRemainingSec)}
                  size="md"
                  tone="muted"
                />
                <Stat
                  label={`Real time left at ${race.avgPlaybackSpeed.toFixed(2)}×`}
                  value={formatDuration(race.realRemainingSec)}
                  size="md"
                  tone="muted"
                />
              </div>

              {!isLongHaul ? (
                <RaceTimeline intervals={race.intervals} runtimeSec={race.runtimeSec} accent={accent} />
              ) : null}

              <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-hairline pt-4 sm:grid-cols-4">
                <Stat label="Real viewing" value={formatDuration(race.realViewingSec)} size="sm" tone="muted" />
                <Stat label="Timeline played" value={formatDuration(race.timelineWatchedSec)} size="sm" tone="muted" />
                <Stat label="Sessions" value={formatNumber(race.sessionCount)} size="sm" tone="muted" />
                <Stat
                  label="Avg playback"
                  value={`${race.avgPlaybackSpeed.toFixed(2)}×`}
                  size="sm"
                  tone="muted"
                />
              </div>
            </div>
          </div>

          {isLongHaul ? (
            <RaceTimeline intervals={race.intervals} runtimeSec={race.runtimeSec} accent={accent} />
          ) : null}

          {race.gaps.length > 0 && race.coverageSec > 0 ? (
            <div className="border-t border-hairline pt-4">
              <GapList intervals={race.intervals} runtimeSec={race.runtimeSec} />
              <p className="mt-2 text-xs text-ink-dim">
                Story Complete needs the whole timeline. Anything skipped stays here until you come back to it —
                which is the entire point.
              </p>
            </div>
          ) : null}
        </PanelBody>
      </Panel>

      {/* ---- Session history --------------------------------------------- */}
      <Panel>
        <PanelHeader title={`Viewing history · ${race.sessionCount} session${race.sessionCount === 1 ? '' : 's'}`} />
        {race.sessions.length === 0 ? (
          <EmptyState
            title="No stints logged yet"
            body="Log one and this becomes a record of how you watched the race."
            action={<Button size="sm" variant="primary" onClick={() => setLogging(true)}>Log a stint</Button>}
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {race.sessions.map((session) => (
              <li key={session.id} className="group flex items-start gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-xs text-ink-muted">{formatDate(session.watchedAt, 'long')}</span>
                    <span className="timing text-xs text-ink">
                      {formatTimestamp(session.startTimestampSec)} → {formatTimestamp(session.endTimestampSec)}
                    </span>
                    <Badge tone="outline">{session.playbackSpeed}×</Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-ink-dim">
                    <span>Real viewing <span className="timing text-ink-muted">{formatDuration(session.realSeconds, { seconds: true })}</span></span>
                    <span>Timeline <span className="timing text-ink-muted">{formatDuration(session.timelineSeconds, { seconds: true })}</span></span>
                    {session.newCoverageSeconds < session.timelineSeconds ? (
                      <span title="Re-watched sections count towards your viewing time, but the race is only ever counted as watched once.">
                        New coverage <span className="timing text-ink-muted">{formatDuration(session.newCoverageSeconds)}</span>
                      </span>
                    ) : null}
                    {session.careerXpAwarded > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Zap size={10} className="text-[var(--accent)]" />
                        <span className="timing text-ink-muted">+{formatNumber(session.careerXpAwarded)}</span>
                      </span>
                    ) : null}
                  </div>
                  {session.note ? <p className="mt-1.5 text-xs text-ink-dim">{session.note}</p> : null}
                </div>

                <form
                  action={async () => {
                    const result = await deleteSessionAction(session.id);
                    setNotice(result.message ?? null);
                    router.refresh();
                  }}
                >
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    title="Remove this session"
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 size={12} />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {race.notes ? (
        <Panel>
          <PanelHeader title="Notes" />
          <PanelBody>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{race.notes}</p>
          </PanelBody>
        </Panel>
      ) : null}

      <div className="flex justify-end">
        <form
          action={async () => {
            if (!confirm(`Remove ${race.name} from the library? Its viewing history goes with it.`)) return;
            await deleteRaceAction(race.id);
            router.push('/races');
          }}
        >
          <Button type="submit" variant="ghost" size="sm" className="text-ink-faint">
            <Trash2 size={12} /> Remove this race
          </Button>
        </form>
      </div>

      <Dialog open={logging} onClose={() => setLogging(false)} title="Log a stint" size="lg">
        <LogSessionForm
          raceId={race.id}
          raceName={race.name}
          runtimeSec={race.runtimeSec}
          intervals={race.intervals}
          resumeAtSec={race.resumeAtSec}
          defaultSpeed={race.avgPlaybackSpeed > 0 ? roundSpeed(race.avgPlaybackSpeed) : 1}
          action={onLogSession}
          onCancel={() => setLogging(false)}
          pending={pending}
        />
      </Dialog>
    </div>
  );
}

/** Snap an averaged speed to the nearest offered option, for the form default. */
function roundSpeed(speed: number): number {
  const options = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  return options.reduce((best, option) =>
    Math.abs(option - speed) < Math.abs(best - speed) ? option : best, 1);
}
