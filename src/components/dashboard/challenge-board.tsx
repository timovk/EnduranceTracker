/**
 * The challenge board.
 *
 * Four windows — day, week, month, quarter — each closing on a real calendar
 * deadline. A closed window is stated plainly and neutrally; there is no
 * "missed", no red, no countdown framed as a loss.
 */

import type { ChallengeView } from '@/lib/engines/challenge-engine';
import type { SeasonPassClosure } from '@/lib/engines/season-pass-engine';
import type { ChallengeScope } from '@/lib/domain/types';
import { Check, Clock } from 'lucide-react';
import { EXPIRED_CHALLENGE_NOTE, seasonalChallengesClosedNote } from '@/lib/copy/tone';
import { Badge, EmptyState, Panel, PanelBody, PanelHeader, TimingBar } from '@/components/ui/primitives';
import { cn, formatDate, formatNumber } from '@/lib/utils';

/** What the seasonal slot needs to know while the season is closed (0.3.1). */
export type SeasonalClosure = Pick<SeasonPassClosure, 'label' | 'reopensAt'>;

const SCOPES: { scope: ChallengeScope; label: string; blurb: string }[] = [
  { scope: 'DAILY', label: 'Today', blurb: 'Small nudges. They reset at midnight.' },
  { scope: 'WEEKLY', label: 'This week', blurb: 'Built around the eight-hour week.' },
  { scope: 'MONTHLY', label: 'This month', blurb: 'Larger completion goals.' },
  { scope: 'SEASONAL', label: 'This quarter', blurb: 'The long view, closing with the season pass.' },
];

export function ChallengeBoard({
  challenges, seasonalClosure = null,
}: {
  challenges: ChallengeView[];
  /** Set while the season is closed; the seasonal slot then says when it returns. */
  seasonalClosure?: SeasonalClosure | null;
}) {
  if (challenges.length === 0) {
    return (
      <div className="space-y-4">
        <Panel>
          <EmptyState
            title="No challenges just now"
            body="Challenges are built from the races in your library, so a few races is all it takes for some to appear."
          />
        </Panel>
        {seasonalClosure ? <SeasonalClosedPanel closure={seasonalClosure} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {SCOPES.map(({ scope, label, blurb }) => {
        if (scope === 'SEASONAL' && seasonalClosure) {
          return <SeasonalClosedPanel key={scope} closure={seasonalClosure} />;
        }

        const items = challenges.filter((c) => c.scope === scope);
        if (items.length === 0) return null;

        const completed = items.filter((c) => c.state === 'COMPLETED').length;
        const open = items.find((c) => c.state === 'ACTIVE');

        return (
          <Panel key={scope}>
            <PanelHeader
              title={label}
              action={
                <span className="flex items-center gap-3 text-[0.6875rem] text-ink-faint">
                  {open ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={10} /> {open.remainingLabel}
                    </span>
                  ) : null}
                  <span className="timing">{completed}/{items.length}</span>
                </span>
              }
            />
            <PanelBody className="space-y-3">
              <p className="text-xs text-ink-dim">{blurb}</p>
              <ul className="space-y-3">
                {items.map((challenge) => <ChallengeItem key={challenge.id} challenge={challenge} />)}
              </ul>
            </PanelBody>
          </Panel>
        );
      })}

      <p className="px-1 text-xs leading-relaxed text-ink-faint">
        Nothing here is required and nothing is deducted. A challenge is an opportunity that happened
        to be available; if it closes untouched, your career is exactly as it was.
      </p>
    </div>
  );
}

/** The seasonal slot while the season is closed: when seasonal challenges return. */
function SeasonalClosedPanel({ closure }: { closure: SeasonalClosure }) {
  return (
    <Panel>
      <PanelHeader
        title="Seasonal"
        action={<span className="text-[0.6875rem] text-ink-faint">returns {formatDate(closure.reopensAt)}</span>}
      />
      <PanelBody>
        <p className="text-xs leading-relaxed text-ink-dim">
          {seasonalChallengesClosedNote(closure.label, formatDate(closure.reopensAt, 'long'))}
        </p>
      </PanelBody>
    </Panel>
  );
}

function ChallengeItem({ challenge }: { challenge: ChallengeView }) {
  const done = challenge.state === 'COMPLETED';
  const closed = challenge.state === 'EXPIRED';
  const decimals = challenge.target % 1 === 0 ? 0 : 1;

  return (
    <li
      className={cn(
        'rounded-md border px-3 py-2.5',
        done ? 'border-verde/35 bg-verde/8' : closed ? 'border-hairline bg-panel/50' : 'border-hairline-strong bg-panel-2',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {done ? <Check size={12} className="shrink-0 text-verde" /> : null}
            <span className={cn('truncate text-sm', closed ? 'text-ink-dim' : 'text-ink')}>
              {challenge.title}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{challenge.description}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {done ? <Badge tone="positive">Complete</Badge> : closed ? <Badge tone="outline">Closed</Badge> : null}
          <span className="timing text-[0.625rem] text-ink-faint">
            +{formatNumber(challenge.xpReward)} XP
          </span>
        </div>
      </div>

      <div className="mt-2.5">
        <TimingBar
          value={challenge.progress * 100}
          height="h-1.5"
          color={done ? 'var(--color-verde)' : undefined}
          track={closed ? 'bg-panel-2' : 'bg-panel-3'}
          label={challenge.title}
        />
        <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
          <span className="timing">
            {formatNumber(Math.min(challenge.value, challenge.target), decimals)} / {formatNumber(challenge.target, decimals)}
          </span>
          <span>{closed ? '' : challenge.remainingLabel}</span>
        </div>
      </div>

      {closed ? (
        <p className="mt-1.5 text-[0.625rem] leading-relaxed text-ink-faint">
          {challenge.note ?? EXPIRED_CHALLENGE_NOTE}
        </p>
      ) : null}
    </li>
  );
}
