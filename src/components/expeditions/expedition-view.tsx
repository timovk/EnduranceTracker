'use client';

/**
 * The Expedition page: one long race followed as a journey.
 *
 * In order: the race and its mode, the instruments, the timeline of what has
 * been watched and what is still ahead, the checkpoints, what the rest of the
 * race asks of the viewing plan, where it stands in its championship and its
 * event, every stint, and — once the story is complete — its summary. A stint
 * can be logged from here, so following an Expedition never means leaving it.
 *
 * Nothing here is a demand. Checkpoints still ahead are simply ahead, the plan
 * is information, and a race that is not an Expedition is one switch away.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Circle, Flag, Mountain, Play, Repeat } from 'lucide-react';
import { EXPEDITION_SHAPE } from '@/lib/config';
import type { ExpeditionView as View } from '@/lib/engines/expedition-engine';
import type { SessionOutcome } from '@/lib/engines/contracts';
import type { StintEntryMode } from '@/lib/domain/race-clock';
import { formatDuration, formatElapsed, formatTimestamp } from '@/lib/domain/time';
import { precisionLabel } from '@/lib/copy/tone';
import { accentVars } from '@/components/ui/accent';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Panel, PanelBody, PanelHeader, Stat } from '@/components/ui/primitives';
import { ExpeditionTimeline, RaceTimeline } from '@/components/races/race-timeline';
import { LogSessionForm } from '@/components/races/log-session-form';
import { StintSummary } from '@/components/races/stint-summary';
import { roundSpeed } from '@/components/races/race-detail-view';
import { logSessionAction } from '@/lib/server/actions';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { CoverageMeter } from './coverage-meter';
import { ExpeditionModeControl } from './expedition-mode-control';
import { ExpeditionSummaryCard } from './expedition-summary-card';

export function ExpeditionView({ view, defaultEntryMode = 'RANGE' }: { view: View; defaultEntryMode?: StintEntryMode }) {
  const router = useRouter();
  const [logging, setLogging] = React.useState(false);
  const [outcome, setOutcome] = React.useState<SessionOutcome | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [notice, setNotice] = React.useState<string | null>(null);

  const { race, figures } = view;
  const accent = race.championship?.accentColor ?? null;
  const started = figures.sessions > 0;

  function onLogSession(formData: FormData) {
    startTransition(async () => {
      const result = await logSessionAction(formData);
      if (result.ok && result.data) {
        setLogging(false);
        // Re-read so the summary is built from committed data.
        const response = await fetch(`/api/sessions/${result.data.sessionId}/outcome`);
        setOutcome(response.ok ? ((await response.json()) as SessionOutcome) : null);
        router.refresh();
      } else {
        setNotice(result.message ?? 'That stint could not be read.');
      }
    });
  }

  return (
    <div className="space-y-4" style={accent ? accentVars(accent) : undefined}>
      {/* ---- Header ------------------------------------------------------ */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="label mb-1.5 flex flex-wrap items-center gap-2">
            <Mountain size={11} className="text-[var(--accent)]" />
            <span>Race Expedition</span>
            {race.championship ? (
              <Link href={`/races?championship=${race.championship.id}`} className="text-[var(--accent)]">
                · {race.championship.name}
              </Link>
            ) : null}
            {race.event ? (
              <Link href={race.event.href} className="inline-flex items-center gap-1 hover:text-ink-muted">
                · <Repeat size={10} />
                {race.event.editionYear !== null ? `Edition ${race.event.editionYear} of ${race.event.name}` : race.event.name}
              </Link>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{race.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-dim">
            {race.circuit ? <span>{race.circuit}</span> : null}
            {race.raceDate ? <span>{formatDate(race.raceDate, 'long')}</span> : null}
            <span className="inline-flex items-center gap-1"><Flag size={11} />{formatDuration(race.runtimeSec)}</span>
          </div>
          <ExpeditionModeControl className="mt-3" raceId={race.id} mode={view.mode} isExpedition={view.isExpedition} />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={`/races/${race.id}`}>
            <Button variant="subtle" size="sm"><ArrowLeft size={12} /> Race page</Button>
          </Link>
          <Button variant={figures.storyCompletedAt === null ? 'primary' : 'subtle'} size="sm" onClick={() => setLogging(true)}>
            <Play size={13} /> {figures.storyCompletedAt === null ? 'Log a stint' : 'Log a re-watch'}
          </Button>
        </div>
      </header>

      {notice ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">{notice}</p>
      ) : null}

      {outcome ? <StintSummary outcome={outcome} onDismiss={() => setOutcome(null)} /> : null}

      {!view.isExpedition ? (
        <>
          <NotAnExpedition view={view} accent={accent} />
          {started ? <Checkpoints view={view} accent={accent} /> : null}
        </>
      ) : (
        <>
          <Instruments view={view} />

          {/* ---- Timeline ------------------------------------------------ */}
          <Panel>
            <PanelHeader title="Expedition timeline" />
            <PanelBody>
              {started ? (
                <ExpeditionTimeline
                  runtimeSec={race.runtimeSec}
                  intervals={figures.fragments.watched}
                  stints={view.stints}
                  resumeAtSec={figures.resumeAtSec}
                  furthestSec={figures.fragments.furthestSec}
                  accent={accent}
                />
              ) : (
                <EmptyState
                  icon={<Mountain size={22} />}
                  title="Your expedition starts with the first stint"
                  body="Every stint you log is drawn here, with the parts still to watch between them."
                  action={<Button size="sm" variant="primary" onClick={() => setLogging(true)}>Log a stint</Button>}
                />
              )}
            </PanelBody>
          </Panel>

          <Checkpoints view={view} accent={accent} />
          <BudgetPanel view={view} />
          <Standing view={view} />
          {started ? <StintTable view={view} /> : null}
        </>
      )}

      {view.summary ? (
        <ExpeditionSummaryCard
          snapshot={view.summary.snapshot}
          retrospective={view.summary.retrospective}
          accent={accent}
        />
      ) : null}

      <Dialog open={logging} onClose={() => setLogging(false)} title="Log a stint" size="lg">
        <LogSessionForm
          raceId={race.id}
          raceName={race.name}
          runtimeSec={race.runtimeSec}
          scheduledSec={race.scheduledDurationSec}
          intervals={figures.fragments.watched}
          resumeAtSec={figures.resumeAtSec}
          defaultMode={defaultEntryMode}
          defaultSpeed={roundSpeed(race.speed)}
          action={onLogSession}
          onCancel={() => setLogging(false)}
          pending={pending}
        />
      </Dialog>
    </div>
  );
}

/** A race that is not an Expedition: one sentence, the switch above, and its timeline. */
function NotAnExpedition({ view, accent }: { view: View; accent: string | null }) {
  return (
    <Panel>
      <PanelBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          This race is not an Expedition. Switch it on to follow it as one.
          {!view.checkpointsPayXp
            ? ` Its checkpoints would be shown and dated; they earn XP on races of ${EXPEDITION_SHAPE.checkpointXpMinimumHours} hours or more.`
            : ''}
        </p>
        <RaceTimeline intervals={view.figures.fragments.watched} runtimeSec={view.race.runtimeSec} accent={accent} />
      </PanelBody>
    </Panel>
  );
}

/** The instruments: every figure of the journey so far, and only those that exist before the first stint. */
function Instruments({ view }: { view: View }) {
  const { figures } = view;
  const started = figures.sessions > 0;
  return (
    <Panel>
      <PanelBody>
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-4">
          <Stat label="Race duration" value={formatDuration(figures.runtimeSec)} size="sm" />
          {started ? <Stat label="Unique coverage" value={formatDuration(figures.coverageSec)} size="sm" /> : null}
          {started ? <Stat label="Real viewing" value={formatDuration(figures.creditedSeconds)} size="sm" /> : null}
          <Stat
            label="Still to watch"
            value={formatDuration(figures.remainingTimelineSec)}
            sub={figures.remainingTimelineSec > 0
              ? `about ${formatDuration(figures.remainingRealSec)} at ${Math.round(view.race.speed * 100) / 100}×`
              : undefined}
            size="sm"
            tone="muted"
          />
          {started ? <Stat label="Complete" value={figures.completionPercentText} size="sm" tone="accent" /> : null}
          {started ? <Stat label="Resume at" value={formatTimestamp(figures.resumeAtSec)} size="sm" /> : null}
          {started ? <Stat label="Sessions" value={formatNumber(figures.sessions)} size="sm" tone="muted" /> : null}
          {figures.startedAt ? <Stat label="Expedition start" value={formatDate(figures.startedAt, 'long')} size="sm" tone="muted" mono={false} /> : null}
          {figures.elapsedSeconds !== null ? (
            <Stat
              label={figures.storyCompletedAt ? 'Start to finish' : 'Since the start'}
              value={formatElapsed(figures.elapsedSeconds)}
              sub="based on when stints were logged"
              size="sm"
              tone="muted"
            />
          ) : null}
          <Stat
            label="Story Complete"
            value={figures.storyCompletedAt ? formatDate(figures.storyCompletedAt, 'long') : 'Still ahead'}
            size="sm"
            tone={figures.storyCompletedAt ? 'accent' : 'muted'}
            mono={false}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}

/** The checkpoints: the meter, then each with its XP and when it was reached, and Story Complete last. */
function Checkpoints({ view, accent }: { view: View; accent: string | null }) {
  const { figures } = view;
  const started = figures.sessions > 0;
  return (
    <Panel>
      <PanelHeader title="Checkpoints" />
      <PanelBody className="space-y-4">
        <CoverageMeter
          coverageSec={figures.coverageSec}
          runtimeSec={figures.runtimeSec}
          ticks={figures.checkpoints.map((checkpoint) => ({ percent: checkpoint.percent, reached: checkpoint.reachedAt !== null }))}
          accent={accent}
        />
        <ul className="divide-y divide-hairline rounded-md border border-hairline">
          {figures.checkpoints.map((checkpoint) => {
            const reached = checkpoint.reachedAt !== null;
            return (
              <li key={checkpoint.percent} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                {reached ? <Check size={13} className="shrink-0 text-verde" /> : <Circle size={13} className="shrink-0 text-ink-faint" />}
                <span className="timing w-10 shrink-0 text-sm text-ink">{checkpoint.percent}%</span>
                <span className="min-w-0 flex-1 text-xs text-ink-dim">
                  {!started
                    ? 'Dated from the first stint that reaches it'
                    : !reached
                      ? 'Still ahead'
                      : !checkpoint.held && !view.isExpedition && view.checkpointsPayXp
                        ? 'Reached — switch Expedition Mode on to count it'
                        : precisionLabel('STINT', new Date(checkpoint.reachedAt ?? 0))}
                </span>
                <span className={cn('timing shrink-0 text-xs', checkpoint.held ? 'text-[var(--accent)]' : 'text-ink-dim')}>
                  {checkpoint.held || view.checkpointsPayXp
                    ? `+${formatNumber(checkpoint.xp)} XP`
                    : `no XP under ${EXPEDITION_SHAPE.checkpointXpMinimumHours} hours`}
                </span>
              </li>
            );
          })}
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            {figures.storyCompletedAt ? <Check size={13} className="shrink-0 text-verde" /> : <Circle size={13} className="shrink-0 text-ink-faint" />}
            <span className="w-10 shrink-0 text-sm text-ink">All</span>
            <span className="min-w-0 flex-1 text-xs text-ink-dim">
              Story Complete — the whole story (the Story Complete bonus)
              {figures.storyCompletedAt ? ` · ${precisionLabel('STINT', figures.storyCompletedAt)}` : ''}
            </span>
            <span className="timing shrink-0 text-xs text-ink-dim">+{formatNumber(view.storyBonus.careerXp)} XP</span>
          </li>
        </ul>
        <p className="text-xs leading-relaxed text-ink-dim">
          Checkpoints count unique coverage: re-watching a part already seen never reaches one, and reaching the end
          of the race is not the same as watching all of it. Switching Expedition Mode off keeps what they earned.
        </p>
      </PanelBody>
    </Panel>
  );
}

/** What the rest of the race asks of the viewing plan, as information. */
function BudgetPanel({ view }: { view: View }) {
  if (view.budget === null) return null;
  const { budget } = view;
  return (
    <Panel>
      <PanelHeader title="Viewing budget" />
      <PanelBody className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">{budget.note}</p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          <Stat label="Real time left" value={formatDuration(budget.realRemainingSec)} size="sm" tone="muted" />
          <Stat label="Left in this year’s plan" value={`${formatNumber(budget.yearRemainingHours, 1)}h`} size="sm" tone="muted" />
          <Stat label="Left in this week’s plan" value={`${formatNumber(budget.weekRemainingHours, 1)}h`} size="sm" tone="muted" />
          <Stat label="Recommended pace" value={`${formatNumber(budget.recommendedPaceHours, 1)}h a week`} size="sm" tone="muted" />
        </div>
      </PanelBody>
    </Panel>
  );
}

/** The race's place in its championship and its event, and the bonus its story pays. */
function Standing({ view }: { view: View }) {
  return (
    <Panel>
      <PanelHeader title="Championship, event and mastery" />
      <PanelBody>
        <ul className="space-y-2 text-sm text-ink-muted">
          {view.championship ? (
            <li>
              <Link href="/mastery" className="hover:text-ink">{view.championship.name} mastery</Link>{' '}
              <span className="timing text-ink">{Math.round(view.championship.percent)}%</span>
            </li>
          ) : (
            <li>This race is in no championship.</li>
          )}
          {view.event ? (
            <li>
              <Link href={view.event.href} className="hover:text-ink">
                {view.event.editionYear !== null ? `Edition ${view.event.editionYear} of ${view.event.name}` : view.event.name}
              </Link>
              {' · '}
              <span className="timing text-ink">{formatNumber(view.event.editionsExperienced)}</span>{' '}
              {view.event.editionsExperienced === 1 ? 'edition' : 'editions'} experienced
              {view.event.nextStep ? (
                <span className="mt-0.5 block text-xs text-ink-dim">
                  Next step: {view.event.nextStep.name} — {view.event.nextStep.description}
                </span>
              ) : (
                <span className="mt-0.5 block text-xs text-ink-dim">Every step of the event is reached.</span>
              )}
            </li>
          ) : (
            <li>This race is an edition of no recurring event.</li>
          )}
          <li>
            Story Complete bonus <span className="timing text-ink">+{formatNumber(view.storyBonus.careerXp)} XP</span>{' '}
            <span className="text-xs text-ink-dim">({view.storyBonus.label} band)</span>
          </li>
        </ul>
      </PanelBody>
    </Panel>
  );
}

/** Every stint, in the order they were logged, with what each added from the replay. */
function StintTable({ view }: { view: View }) {
  return (
    <Panel>
      <PanelHeader title={`Stints · ${formatNumber(view.stints.length)}`} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="label">
            <tr className="border-b border-hairline">
              <th scope="col" className="px-4 py-2 font-normal">Logged</th>
              <th scope="col" className="px-3 py-2 font-normal">Timeline</th>
              <th scope="col" className="px-3 py-2 font-normal">Speed</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Real viewing</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">New coverage</th>
              <th scope="col" className="px-4 py-2 text-right font-normal">Re-watch</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {view.stints.map((stint) => (
              <tr key={stint.sessionId}>
                <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                  {formatDate(stint.watchedAt, 'long')}{' '}
                  {new Date(stint.watchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </td>
                <td className="timing whitespace-nowrap px-3 py-2 text-ink">
                  {formatTimestamp(stint.startTimestampSec)} → {formatTimestamp(stint.endTimestampSec)}
                </td>
                <td className="timing px-3 py-2 text-ink-dim">{stint.playbackSpeed}×</td>
                <td className="timing px-3 py-2 text-right text-ink-muted">{formatDuration(stint.creditedSeconds, { seconds: true })}</td>
                <td className="timing px-3 py-2 text-right text-ink-muted">{formatDuration(stint.addedCoverageSeconds)}</td>
                <td className="timing px-4 py-2 text-right text-ink-dim">
                  {stint.rewatchCreditedSeconds >= 1 ? formatDuration(stint.rewatchCreditedSeconds) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
