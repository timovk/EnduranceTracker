/**
 * An Expedition Summary: the permanent record of a completed Expedition.
 *
 * Drawn entirely from its snapshot, which was frozen when the story was
 * completed, so the card reads the same after the race's stints are edited,
 * after Expedition Mode is switched off, and after the race itself is deleted
 * (it then has no link). A summary written after the fact says so, and one
 * whose unlocks were rebuilt from their dates says that too; a figure the
 * summary could not know at the time — the championship's mastery then — is
 * said to be unrecorded rather than guessed.
 */

import Link from 'next/link';
import { Mountain } from 'lucide-react';
import type { ExpeditionSummarySnapshotV1 } from '@/lib/domain/expedition';
import { formatDuration, formatElapsed } from '@/lib/domain/time';
import { precisionLabel } from '@/lib/copy/tone';
import { accentVars } from '@/components/ui/accent';
import { Panel, PanelBody, PanelHeader, RarityBadge, Stat } from '@/components/ui/primitives';
import { formatDate, formatNumber } from '@/lib/utils';

export function ExpeditionSummaryCard({
  snapshot, retrospective, accent, raceHref = null,
}: {
  snapshot: ExpeditionSummarySnapshotV1;
  retrospective: boolean;
  /** The championship's colour, when the race had one. */
  accent?: string | null;
  /** The race page, while the race is still in the library. */
  raceHref?: string | null;
}) {
  const { race, xp, mastery } = snapshot;
  const days = snapshot.calendarDays;

  return (
    <Panel raised style={accent ? accentVars(accent) : undefined} className="border-[var(--accent)]/35">
      <PanelHeader
        icon={<Mountain size={13} className="text-[var(--accent)]" />}
        title="Expedition Summary"
        action={<span className="timing text-xs text-[var(--accent)]">+{formatNumber(xp.total)} XP</span>}
      />
      <PanelBody className="space-y-5">
        <div>
          <div className="label mb-1 flex flex-wrap items-center gap-2">
            {race.championshipName ? <span>{race.championshipName}</span> : null}
            {race.eventName && race.editionYear !== null ? <span>· Edition {race.editionYear} of {race.eventName}</span> : null}
          </div>
          <h3 className="text-lg font-semibold tracking-tight text-ink">
            {raceHref ? <Link href={raceHref} className="hover:text-[var(--accent)]">{race.name}</Link> : race.name}
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDate(snapshot.startedAt, 'long')} to {formatDate(snapshot.completedAt, 'long')} ·{' '}
            {days === 1 ? 'one day' : `${formatNumber(days)} calendar days`} · {formatNumber(snapshot.sessions)}{' '}
            {snapshot.sessions === 1 ? 'session' : 'sessions'}
          </p>
          {retrospective ? (
            <p className="mt-1 text-xs text-ink-dim">Written after the story was complete, from the viewing history.</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          <Stat label="Race duration" value={formatDuration(race.runtimeSec)} size="sm" />
          <Stat label="Real viewing" value={formatDuration(snapshot.creditedSeconds)} size="sm" />
          <Stat label="Unique coverage" value={formatDuration(snapshot.uniqueCoverageSeconds)} sub={snapshot.finalCompletionText} size="sm" />
          <Stat label="Re-watched" value={formatDuration(snapshot.rewatchSeconds)} size="sm" tone="muted" />
          <Stat
            label="Start to finish"
            value={formatElapsed(snapshot.elapsedSeconds)}
            sub="based on when stints were logged"
            size="sm"
            tone="muted"
          />
          <Stat label="Average session" value={formatDuration(snapshot.averageSessionSeconds)} size="sm" tone="muted" />
          <Stat label="Longest session" value={formatDuration(snapshot.longestSessionSeconds)} size="sm" tone="muted" />
          <Stat label="Final completion" value={snapshot.finalCompletionText} size="sm" tone="accent" />
        </div>

        <div className="grid gap-4 border-t border-hairline pt-4 sm:grid-cols-2">
          <section>
            <h4 className="label mb-2">XP from the expedition</h4>
            <ul className="space-y-1 text-xs">
              <XpLine label="Viewing" xp={xp.viewing} />
              {xp.rewatch > 0 ? <XpLine label="Re-watching" xp={xp.rewatch} /> : null}
              <XpLine label="Story Complete bonus" xp={xp.storyComplete} />
              <XpLine label="Checkpoints" xp={xp.checkpoints} />
              <li className="flex items-baseline justify-between gap-3 border-t border-hairline pt-1 text-ink">
                <span>In all</span>
                <span className="timing">+{formatNumber(xp.total)}</span>
              </li>
            </ul>
          </section>

          <section>
            <h4 className="label mb-2">Checkpoints</h4>
            {snapshot.checkpoints.length === 0 ? (
              <p className="text-xs text-ink-dim">No checkpoints were recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {snapshot.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.percent} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-ink-muted">
                      <span className="timing text-ink">{checkpoint.percent}%</span>{' '}
                      <span className="text-ink-dim">{precisionLabel('STINT', new Date(checkpoint.reachedAt))}</span>
                    </span>
                    {checkpoint.xp > 0 ? <span className="timing shrink-0 text-ink-dim">+{formatNumber(checkpoint.xp)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid gap-4 border-t border-hairline pt-4 sm:grid-cols-2">
          <section>
            <h4 className="label mb-2">Mastery</h4>
            <ul className="space-y-1 text-xs text-ink-muted">
              <li>
                {mastery.championship
                  ? <>{mastery.championship.name} mastery <span className="timing text-ink">{Math.round(mastery.championship.percent)}%</span></>
                  : 'Mastery at the time was not recorded.'}
              </li>
              {mastery.event ? (
                <li>
                  {mastery.event.name}: <span className="timing text-ink">{formatNumber(mastery.event.editionsExperienced)}</span>{' '}
                  {mastery.event.editionsExperienced === 1 ? 'edition' : 'editions'} experienced,{' '}
                  <span className="timing text-ink">{formatNumber(mastery.event.editionsStoryComplete)}</span> complete
                </li>
              ) : null}
              {mastery.nodes.map((node) => (
                <li key={`${node.treeName}:${node.nodeName}`} className="flex items-baseline justify-between gap-3">
                  <span>{node.treeName} — {node.nodeName}</span>
                  {node.xp > 0 ? <span className="timing shrink-0 text-ink-dim">+{formatNumber(node.xp)}</span> : null}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="label mb-2">Milestones, achievements and records</h4>
            {snapshot.milestones.length + snapshot.achievements.length + snapshot.records.length === 0 ? (
              <p className="text-xs text-ink-dim">The completing stint reached no milestone, achievement or record of its own.</p>
            ) : (
              <ul className="space-y-1 text-xs text-ink-muted">
                {snapshot.milestones.map((milestone) => (
                  <li key={`milestone:${milestone.title}`} className="flex items-baseline justify-between gap-3">
                    <span>{milestone.title}</span>
                    {milestone.xp > 0 ? <span className="timing shrink-0 text-ink-dim">+{formatNumber(milestone.xp)}</span> : null}
                  </li>
                ))}
                {snapshot.achievements.map((achievement) => (
                  <li key={`achievement:${achievement.name}`} className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2">{achievement.name} <RarityBadge rarity={achievement.rarity} /></span>
                    {achievement.xp > 0 ? <span className="timing shrink-0 text-ink-dim">+{formatNumber(achievement.xp)}</span> : null}
                  </li>
                ))}
                {snapshot.records.map((record) => (
                  <li key={`record:${record.kind}`} className="flex items-baseline justify-between gap-3">
                    <span>Record: {record.label}</span>
                    <span className="timing shrink-0 text-ink">{record.valueText}</span>
                  </li>
                ))}
              </ul>
            )}
            {snapshot.unlocks === 'reconstructed' ? (
              <p className="mt-2 text-[0.6875rem] text-ink-faint">
                Unlocks are those recorded around the stint that completed the story.
              </p>
            ) : null}
          </section>
        </div>
      </PanelBody>
    </Panel>
  );
}

function XpLine({ label, xp }: { label: string; xp: number }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-ink-muted">
      <span>{label}</span>
      <span className="timing text-ink-dim">+{formatNumber(xp)}</span>
    </li>
  );
}
