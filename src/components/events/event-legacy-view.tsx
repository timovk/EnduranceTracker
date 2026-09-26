'use client';

/**
 * One recurring event's legacy: its history in one line, the figures that
 * describe it, every edition in the library with the years between them it
 * does not hold, and the steps it has reached along the way.
 *
 * Runs of consecutive editions are shown as history — the longest there has
 * been, and when — and never as a streak that is running and could end.
 * Years not in the library are simply said to be not in it.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Circle, Compass, Repeat, Unlink } from 'lucide-react';
import type {
  EditionRow, EventLegacyView as View, EventStepView, LinkableRace, StepGroup,
} from '@/lib/engines/event-legacy-engine';
import type { Run } from '@/lib/domain/edition';
import { formatDuration } from '@/lib/domain/time';
import { precisionLabel } from '@/lib/copy/tone';
import { Button } from '@/components/ui/controls';
import { Badge, EmptyState, Panel, PanelBody, PanelHeader, Stat, TimingBar } from '@/components/ui/primitives';
import { setEventArchivedAction, unlinkRaceFromEventAction } from '@/lib/server/career-actions';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { AddRacesDialog, MergeEventDialog, RenameEventDialog } from './event-dialogs';
import { accentVars } from '@/components/ui/accent';

const GROUP_TITLES: Record<StepGroup, string> = {
  experienced: 'Editions experienced',
  complete: 'Complete editions',
  'in-a-row': 'Complete in a row',
  hours: 'Hours here',
};
const GROUP_ORDER: readonly StepGroup[] = ['experienced', 'complete', 'in-a-row', 'hours'];

export function EventLegacyView({
  view, mergeTargets, linkable,
}: {
  view: View;
  /** The other active events, for "Merge into…". */
  mergeTargets: { key: string; name: string }[];
  /** The first page of races the "Add races" dialog offers. */
  linkable: LinkableRace[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [dialog, setDialog] = React.useState<'rename' | 'merge' | 'add' | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const { event, stats } = view;
  const hasEditions = stats.editionsInLibrary > 0;
  const eyebrow = view.championships.length > 0
    ? view.championships.map((championship) => championship.name).join(' · ')
    : 'Recurring event';

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    startTransition(async () => {
      const result = await work();
      setNotice(result.message ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4" style={accentVars(event.accentColor)}>
      {/* ---- Header ------------------------------------------------------ */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label mb-1.5 flex flex-wrap items-center gap-2">
            <Repeat size={11} className="text-[var(--accent)]" />
            <span>{eyebrow}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{event.name}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{view.headline}</p>
          {event.mergedFrom.length > 0 ? (
            <p className="mt-1 text-xs text-ink-dim">
              Includes {event.mergedFrom.map((from) => from.name).join(', ')}, combined into it.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {event.archived ? (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setEventArchivedAction(event.key, false))}>
              Back to my events
            </Button>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={() => setDialog('add')}>Add races</Button>
              <Button size="sm" variant="subtle" onClick={() => setDialog('rename')}>Rename</Button>
              <Button size="sm" variant="subtle" onClick={() => setDialog('merge')}>Merge into…</Button>
              {!hasEditions ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setEventArchivedAction(event.key, true))}>
                  Archive
                </Button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {event.archived ? (
        <p className="rounded-md border border-hairline bg-panel-2 px-3 py-2 text-sm text-ink-muted">
          Archived: kept, with everything it reached, and left out of your list of events.
        </p>
      ) : null}
      {notice !== null ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">{notice}</p>
      ) : null}

      {/* ---- Figures ----------------------------------------------------- */}
      {hasEditions ? (
        <Panel>
          <PanelBody>
            <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
              {figures(view).map((figure) => (
                <Stat key={figure.label} label={figure.label} value={figure.value} sub={figure.sub} size="sm" />
              ))}
            </div>
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon={<Repeat size={22} />}
            title="No editions linked yet"
            body="Add the races that are editions of this event, and its history starts here."
            action={event.archived ? undefined : <Button size="sm" variant="primary" onClick={() => setDialog('add')}>Add races</Button>}
          />
        </Panel>
      )}

      {/* ---- Edition history --------------------------------------------- */}
      {view.editions.length > 0 ? (
        <Panel>
          <PanelHeader
            title={`Edition history · ${formatNumber(stats.editionsInLibrary)} ${stats.editionsInLibrary === 1 ? 'edition' : 'editions'}`}
          />
          <ul className="divide-y divide-hairline">
            {view.editions.map((row) => (
              <EditionHistoryRow
                key={row.kind === 'edition' ? row.raceId : `missing-${row.fromYear}`}
                row={row}
                pending={pending}
                onUnlink={(raceId) => run(() => unlinkRaceFromEventAction(raceId))}
              />
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ---- Legacy steps ------------------------------------------------ */}
      {view.steps.length > 0 ? (
        <Panel>
          <PanelHeader title="Legacy steps" />
          <PanelBody className="space-y-5">
            {GROUP_ORDER.map((group) => {
              const steps = view.steps.filter((step) => step.group === group);
              if (steps.length === 0) return null;
              return (
                <section key={group}>
                  <div className="mb-2">
                    <h3 className="label">{GROUP_TITLES[group]}</h3>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-faint">Steps added in 0.4.0 are smaller extras.</p>
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {steps.map((step) => <StepRow key={step.nodeKey} step={step} />)}
                  </ul>
                </section>
              );
            })}
            <div className="space-y-1.5 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-dim">
              <p>
                Each race can help pay each kind of step once, in any event. Moving an edition to another event never
                pays a step twice; a step it has not helped reach yet can still pay.
              </p>
              <p>
                The same steps appear with the rest of your trees on{' '}
                <Link href="/mastery" className="text-ink-muted underline-offset-2 hover:underline">Mastery</Link>.
              </p>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      <RenameEventDialog
        open={dialog === 'rename'}
        onClose={() => setDialog(null)}
        eventKey={event.key}
        currentName={event.name}
      />
      <MergeEventDialog
        open={dialog === 'merge'}
        onClose={() => setDialog(null)}
        from={{ key: event.key, name: event.name }}
        targets={mergeTargets}
      />
      <AddRacesDialog
        open={dialog === 'add'}
        onClose={() => setDialog(null)}
        eventKey={event.key}
        eventName={event.name}
        initial={linkable}
      />
    </div>
  );
}

/** "2024", or "2011–2015" for a run of years. */
function years(run: Run): string {
  return run.fromYear === run.toYear ? `${run.fromYear}` : `${run.fromYear}–${run.toYear}`;
}

/** Credited time, whole minutes; "0m" before the first minute. */
function time(seconds: number): string {
  return seconds < 60 ? '0m' : formatDuration(seconds);
}

/** The stat grid: only the figures the history holds. */
function figures(view: View): { label: string; value: string; sub?: string }[] {
  const { stats } = view;
  const list: { label: string; value: string; sub?: string }[] = [];
  const edition = (ref: { editionYear: number | null; name: string }) => (ref.editionYear === null ? ref.name : `${ref.editionYear}`);

  if (stats.firstEditionWatched) {
    list.push({ label: 'First edition watched', value: edition(stats.firstEditionWatched), sub: formatDate(stats.firstEditionWatched.at, 'long') });
  }
  if (stats.mostRecentEditionWatched) {
    list.push({
      label: 'Most recent edition watched',
      value: edition(stats.mostRecentEditionWatched),
      sub: formatDate(stats.mostRecentEditionWatched.at, 'long'),
    });
  }
  list.push({ label: 'Editions experienced', value: formatNumber(stats.editionsExperienced), sub: `of ${formatNumber(stats.editionsInLibrary)} in your library` });
  list.push({
    label: 'Editions Story Complete',
    value: formatNumber(stats.editionsStoryComplete),
    sub: `${formatNumber(stats.storyCompleteRaces)} complete race ${stats.storyCompleteRaces === 1 ? 'story' : 'stories'}`,
  });
  if (stats.creditedSeconds > 0) list.push({ label: 'Real viewing time', value: time(stats.creditedSeconds), sub: 'credited' });
  if (stats.uniqueCoverageSeconds > 0) list.push({ label: 'Unique race coverage', value: time(stats.uniqueCoverageSeconds) });
  if (stats.rewatchSeconds >= 60) list.push({ label: 'Re-watch time', value: time(stats.rewatchSeconds) });
  if (stats.longestCompleteRun || stats.longestExperiencedRun) {
    const complete = stats.longestCompleteRun;
    const experienced = stats.longestExperiencedRun;
    list.push({
      label: 'Consecutive complete editions',
      value: complete ? `${complete.length} · ${years(complete)}` : '0',
      sub: experienced ? `${experienced.length} experienced in a row · ${years(experienced)}` : undefined,
    });
  }
  if (stats.longestEdition) {
    list.push({ label: 'Longest edition', value: formatDuration(stats.longestEdition.runtimeSec), sub: stats.longestEdition.name });
  }
  if (stats.highestCompletion) {
    list.push({ label: 'Highest completion', value: stats.highestCompletion.percentText, sub: stats.highestCompletion.name });
  }
  if (stats.undatedEditions > 0) {
    list.push({ label: 'Without a year', value: formatNumber(stats.undatedEditions), sub: 'counted, but not in a run' });
  }
  return list;
}

function EditionHistoryRow({
  row, pending, onUnlink,
}: { row: EditionRow; pending: boolean; onUnlink: (raceId: string) => void }) {
  if (row.kind === 'missing') {
    return (
      <li className="px-4 py-2 text-xs text-ink-faint">
        <span className="timing">{row.fromYear === row.toYear ? row.fromYear : `${row.fromYear}–${row.toYear}`}</span>
        {' — not in your library'}
      </li>
    );
  }

  return (
    <li className="group flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="timing w-12 shrink-0 text-sm text-ink-muted">{row.editionYear ?? '—'}</span>
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/races/${row.raceId}`} className="truncate text-sm font-medium text-ink hover:text-[var(--accent)]">
            {row.name}
          </Link>
          {row.storyCompletedAt ? (
            <Badge tone="positive" title={`Story Complete on ${formatDate(row.storyCompletedAt, 'long')}`}>
              Story Complete · {formatDate(row.storyCompletedAt)}
            </Badge>
          ) : null}
          {row.isExpedition ? (
            <Link href={`/races/${row.raceId}/expedition`} title="Open the expedition">
              <Badge tone="outline" className="hover:text-ink-muted"><Compass size={10} /> Expedition</Badge>
            </Link>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.6875rem] text-ink-dim">
          {row.championshipName ? <span>{row.championshipName}</span> : null}
          <span>Runtime <span className="timing text-ink-muted">{formatDuration(row.runtimeSec)}</span></span>
          <span>Watched <span className="timing text-ink-muted">{time(row.creditedSeconds)}</span></span>
          <span>
            <span className="timing text-ink-muted">{formatNumber(row.sessions)}</span> {row.sessions === 1 ? 'stint' : 'stints'}
          </span>
        </div>
      </div>
      <div className="w-full sm:w-44">
        <TimingBar value={row.coverageSec} max={Math.max(1, row.runtimeSec)} height="h-1.5" label={`${row.name} completion`} />
        <div className="mt-1 text-right text-[0.6875rem] text-ink-dim">
          <span className="timing">{row.completionPercentText}</span> of the race
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        title="Take this race out of the event. Every step it reached stays."
        className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => onUnlink(row.raceId)}
      >
        <Unlink size={12} />
      </Button>
    </li>
  );
}

function StepRow({ step }: { step: EventStepView }) {
  const shown = (value: number) => formatNumber(value, step.group === 'hours' && value % 1 !== 0 ? 1 : 0);
  return (
    <li className={cn('rounded-md border px-3 py-2.5', step.unlocked ? 'border-hairline bg-panel-2' : 'border-hairline bg-panel/60')}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2">
          {step.unlocked
            ? <Check size={12} className="mt-0.5 shrink-0 text-verde" />
            : <Circle size={12} className="mt-0.5 shrink-0 text-ink-faint" />}
          <div className="min-w-0">
            <h4 className={cn('text-xs font-medium', step.unlocked ? 'text-ink' : 'text-ink-muted')}>{step.name}</h4>
            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-faint">{step.description}</p>
          </div>
        </div>
        {step.xp !== null && step.xp > 0 ? (
          <span className={cn('timing shrink-0 text-[0.6875rem]', step.unlocked ? 'text-ink-muted' : 'text-ink-faint')}>
            +{formatNumber(step.xp)} XP
          </span>
        ) : null}
      </div>
      {step.unlocked ? (
        <div className="mt-2 space-y-1 border-t border-hairline pt-2 text-[0.6875rem] leading-relaxed text-ink-dim">
          {step.date ? <p>{precisionLabel(step.precision, step.date)}</p> : null}
          {step.recordedOnly ? (
            <p>Recorded — these editions were already counted for this step in another event.</p>
          ) : step.xp === null ? (
            <p>Recorded without XP: this step is shown and dated, and pays nothing of its own.</p>
          ) : null}
        </div>
      ) : (
        <div className="mt-2">
          <TimingBar value={Math.min(step.value, step.threshold)} max={step.threshold} height="h-1" label={step.name} />
          <p className="timing mt-1 text-[0.625rem] text-ink-faint">{shown(Math.min(step.value, step.threshold))} / {shown(step.threshold)}</p>
        </div>
      )}
    </li>
  );
}
