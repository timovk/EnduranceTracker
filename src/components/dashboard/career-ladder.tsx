/**
 * The level ladder.
 *
 * A window on an unbounded curve: a couple of levels behind for context and a
 * stretch ahead to aim at. There is no maximum career level, so this is never
 * a completion bar.
 */

import { Panel, PanelHeader } from '@/components/ui/primitives';
import { cn, formatNumber } from '@/lib/utils';

export interface LadderRung {
  level: number;
  totalXp: number;
  costFromPrevious: number;
  title: string;
  isTitleThreshold: boolean;
  prestige: number;
  isPrestigeThreshold: boolean;
  isCurrent: boolean;
}

export function CareerLadder({ rungs }: { rungs: LadderRung[] }) {
  return (
    <Panel>
      <PanelHeader title="The road ahead" />
      <ul className="divide-y divide-hairline">
        {rungs.map((rung) => (
          <li
            key={rung.level}
            className={cn(
              'flex items-center gap-4 px-4 py-2.5',
              rung.isCurrent && 'bg-[var(--accent-soft)]',
            )}
          >
            <span
              className={cn(
                'timing w-10 shrink-0 text-right text-sm',
                rung.isCurrent ? 'text-[var(--accent)]' : 'text-ink-dim',
              )}
            >
              {rung.level}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('truncate text-xs', rung.isTitleThreshold ? 'text-ink' : 'text-ink-faint')}>
                  {rung.isTitleThreshold ? rung.title : '—'}
                </span>
                {rung.isPrestigeThreshold ? (
                  <span className="text-[0.625rem] uppercase tracking-[0.1em] text-[var(--accent)]">
                    prestige
                  </span>
                ) : null}
              </div>
            </div>

            <span className="timing shrink-0 text-[0.6875rem] text-ink-faint">
              {formatNumber(rung.totalXp)}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-hairline px-4 py-2.5 text-[0.6875rem] text-ink-faint">
        The curve keeps going. There is no maximum career level.
      </p>
    </Panel>
  );
}
