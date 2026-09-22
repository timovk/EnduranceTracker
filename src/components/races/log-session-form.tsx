'use client';

/**
 * Log a stint.
 *
 * The form computes everything live as you type, because the whole point is to
 * see immediately what "02:47:31 / 06:00:00" means: 46.5% complete, 3h 12m of
 * race left, and what that will cost in real time at your playback speed.
 *
 * Notes are optional and always will be. The application never asks the user
 * to write down what happened in the race.
 */

import * as React from 'react';
import { CheckCircle2, Clock3, Gauge } from 'lucide-react';
import { Button, Field, Input, Segmented, Textarea } from '@/components/ui/controls';
import { Badge } from '@/components/ui/primitives';
import { formatDuration, formatTimestamp, tryParseTimestamp } from '@/lib/domain/time';
import { PLAYBACK_SPEEDS, realSecondsFor, timelineSecondsFor } from '@/lib/domain/playback';
import { addInterval, coverageSeconds } from '@/lib/domain/intervals';
import type { Interval } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export interface LogSessionFormProps {
  raceId: string;
  raceName: string;
  runtimeSec: number;
  intervals: Interval[];
  /** Where the engine thinks you should pick up: the start of the first gap. */
  resumeAtSec: number;
  defaultSpeed: number;
  action: (formData: FormData) => void | Promise<void>;
  onCancel?: () => void;
  pending?: boolean;
}

type Mode = 'RANGE' | 'DURATION';

/** What the live preview works out from the current form state. */
interface StintPreview {
  startSec: number;
  endSec: number;
  /** Timeline seconds this stint covers. */
  timeline: number;
  /** Wall-clock seconds it costs at the chosen speed. */
  real: number;
  /** Of `timeline`, how much has never been watched before. */
  addedSeconds: number;
  rewatchSeconds: number;
  beforePercent: number;
  afterPercent: number;
  remainingTimeline: number;
  remainingReal: number;
  completesStory: boolean;
}

export function LogSessionForm({
  raceId, raceName, runtimeSec, intervals, resumeAtSec, defaultSpeed, action, onCancel, pending,
}: LogSessionFormProps) {
  const [mode, setMode] = React.useState<Mode>('RANGE');
  const [start, setStart] = React.useState(formatTimestamp(resumeAtSec));
  const [end, setEnd] = React.useState('');
  const [minutes, setMinutes] = React.useState('');
  const [speed, setSpeed] = React.useState(defaultSpeed);
  const [note, setNote] = React.useState('');

  const startSec = tryParseTimestamp(start);
  const endSec = mode === 'RANGE' ? tryParseTimestamp(end) : null;
  const realMinutes = mode === 'DURATION' ? Number.parseFloat(minutes) : Number.NaN;

  const preview = React.useMemo<StintPreview | null>(() => {
    if (startSec === null) return null;
    const clampedStart = Math.min(Math.max(0, startSec), runtimeSec);

    let resolvedEnd: number;
    if (mode === 'DURATION') {
      if (!Number.isFinite(realMinutes) || realMinutes <= 0) return null;
      resolvedEnd = Math.min(runtimeSec, clampedStart + timelineSecondsFor(realMinutes * 60, speed));
    } else {
      if (endSec === null || endSec <= clampedStart) return null;
      resolvedEnd = Math.min(runtimeSec, endSec);
    }

    const timeline = resolvedEnd - clampedStart;
    if (timeline <= 0) return null;

    const before = coverageSeconds(intervals);
    const { intervals: after, addedSeconds } = addInterval(
      intervals, { start: clampedStart, end: resolvedEnd }, { limit: runtimeSec },
    );
    const afterCoverage = coverageSeconds(after);

    return {
      startSec: clampedStart,
      endSec: resolvedEnd,
      timeline,
      real: realSecondsFor(timeline, speed),
      addedSeconds,
      rewatchSeconds: timeline - addedSeconds,
      beforePercent: (before / runtimeSec) * 100,
      afterPercent: (afterCoverage / runtimeSec) * 100,
      remainingTimeline: Math.max(0, runtimeSec - afterCoverage),
      remainingReal: realSecondsFor(Math.max(0, runtimeSec - afterCoverage), speed),
      completesStory: runtimeSec - afterCoverage <= 120,
    };
  }, [startSec, endSec, realMinutes, mode, speed, intervals, runtimeSec]);

  const startError = start.trim() !== '' && startSec === null ? 'Use HH:MM:SS, for example 02:47:31.' : null;
  const endError =
    mode === 'RANGE' && end.trim() !== '' && (endSec === null || (startSec !== null && endSec <= startSec))
      ? endSec === null ? 'Use HH:MM:SS.' : 'The stint has to end after it starts.'
      : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="raceId" value={raceId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="playbackSpeed" value={speed} />
      <input type="hidden" name="startTimestamp" value={start} />
      {mode === 'RANGE' ? <input type="hidden" name="endTimestamp" value={end} /> : null}
      {mode === 'DURATION' ? <input type="hidden" name="realMinutes" value={minutes} /> : null}
      <input type="hidden" name="note" value={note} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="label">Logging a stint</div>
          <div className="truncate text-sm text-ink">{raceName}</div>
        </div>
        <Segmented
          size="sm"
          value={mode}
          onChange={(value) => setMode(value)}
          options={[
            { value: 'RANGE', label: 'Timestamps', title: 'I know where I stopped' },
            { value: 'DURATION', label: 'Duration', title: 'I know how long I watched' },
          ]}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Started at" error={startError} hint="Race timeline position">
          <Input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="01:35:20"
            inputMode="numeric"
            className="timing"
            autoFocus
          />
        </Field>

        {mode === 'RANGE' ? (
          <Field label="Stopped at" error={endError} hint={`Race runtime ${formatTimestamp(runtimeSec)}`}>
            <Input
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="02:47:31"
              inputMode="numeric"
              className="timing"
            />
          </Field>
        ) : (
          <Field label="Real time watched" hint="Minutes actually spent in front of the screen">
            <Input
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="57"
              inputMode="decimal"
              type="number"
              min={1}
              step="any"
              className="timing"
            />
          </Field>
        )}
      </div>

      <div>
        <div className="label mb-1.5 flex items-center gap-1.5">
          <Gauge size={12} /> Playback speed
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PLAYBACK_SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              className={cn(
                'timing rounded-md border px-2.5 py-1 text-xs transition-colors',
                option === speed
                  ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-hairline-strong bg-panel-2 text-ink-dim hover:text-ink-muted',
              )}
            >
              {option}×
            </button>
          ))}
        </div>
      </div>

      {preview ? <SessionPreview preview={preview} /> : (
        <p className="rounded-md border border-hairline bg-panel-2 px-3 py-2.5 text-xs text-ink-dim">
          Enter where the stint started and stopped to see what it adds up to.
        </p>
      )}

      <Field label="Note" hint="Entirely optional. You never have to write down what happened.">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder=""
        />
      </Field>

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending || preview === null}>
          {pending ? 'Saving…' : 'Log stint'}
        </Button>
      </div>
    </form>
  );
}

function SessionPreview({ preview }: { preview: StintPreview }) {
  return (
    <div className="rounded-md border border-hairline-strong bg-panel-2 p-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <PreviewStat label="Race progress" value={formatDuration(preview.timeline)} />
        <PreviewStat
          label="Real time"
          value={formatDuration(preview.real)}
          icon={<Clock3 size={11} />}
        />
        <PreviewStat
          label="Completion"
          value={`${preview.beforePercent.toFixed(1)}% → ${preview.afterPercent.toFixed(1)}%`}
        />
        <PreviewStat label="Left to watch" value={formatDuration(preview.remainingTimeline)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {preview.completesStory ? (
          <Badge tone="accent">
            <CheckCircle2 size={10} /> Completes the story
          </Badge>
        ) : (
          <Badge tone="outline">
            {formatDuration(preview.remainingReal)} of real viewing left at this speed
          </Badge>
        )}
        {preview.rewatchSeconds > 0 ? (
          <Badge tone="neutral" title="Re-watching counts towards your viewing time, but the race is only ever counted as watched once.">
            {formatDuration(preview.rewatchSeconds)} re-watched
          </Badge>
        ) : null}
        {preview.addedSeconds > 0 && preview.rewatchSeconds > 0 ? (
          <Badge tone="positive">{formatDuration(preview.addedSeconds)} new</Badge>
        ) : null}
      </div>
    </div>
  );
}

function PreviewStat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label mb-1 flex items-center gap-1">{icon}{label}</div>
      <div className="timing truncate text-sm text-ink">{value}</div>
    </div>
  );
}
