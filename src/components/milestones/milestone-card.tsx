/**
 * One Career Milestone.
 *
 * A reached milestone is a permanent record: when it happened, how exactly
 * that is known, the race or event it happened in, and what it paid — or,
 * when another system already pays that moment, who does. A major one is
 * drawn highlighted, like the "Season Complete" block of a stint summary.
 *
 * A milestone still ahead shows where the career stands on the way to it,
 * never how far is left to go by any date.
 */

import Link from 'next/link';
import { Landmark } from 'lucide-react';
import type { CareerMilestoneItem } from '@/lib/engines/career-milestone-engine';
import { celebratedBy, precisionLabel, stillAheadNote } from '@/lib/copy/tone';
import { TimingBar } from '@/components/ui/primitives';
import { cn, formatNumber } from '@/lib/utils';

export function MilestoneCard({ item }: { item: CareerMilestoneItem }) {
  const major = item.reached && item.celebration !== 'none';

  return (
    <li
      className={cn(
        'rounded-md border px-3 py-2.5',
        major
          ? 'border-[var(--accent)]/35 bg-[var(--accent-soft)]'
          : item.reached ? 'border-hairline bg-panel-2' : 'border-hairline bg-panel/60',
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className={cn('text-xs font-medium', item.reached ? 'text-ink' : 'text-ink-muted')}>{item.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-[0.6875rem] leading-relaxed text-ink-faint">{item.description}</p>
        </div>
        {item.xp > 0 ? (
          <span className={cn('timing shrink-0 text-[0.6875rem]', item.reached ? 'text-ink-muted' : 'text-ink-faint')}>
            +{formatNumber(item.xp)} XP
          </span>
        ) : null}
      </div>

      {item.reached && item.date !== null ? (
        <div className="mt-2 space-y-1 border-t border-hairline pt-2 text-[0.6875rem] leading-relaxed text-ink-dim">
          <p className={cn(major && 'text-ink-muted')}>{precisionLabel(item.precision, item.date)}</p>
          {item.subject ? (
            <p>
              {item.subject.kind === 'event' ? 'Event' : 'Race'}:{' '}
              {item.subject.href ? (
                <Link href={item.subject.href} className="text-ink-muted underline-offset-2 hover:underline">
                  {item.subject.name}
                </Link>
              ) : (
                <span className="text-ink-muted">{item.subject.name}</span>
              )}
            </p>
          ) : null}
          {item.xp === 0 && item.alsoPaidBy.length > 0 ? <p>{celebratedBy(item.alsoPaidBy)}</p> : null}
          {item.hallOfFame ? (
            <p>
              <Link
                href={item.hallOfFame.href}
                className="inline-flex items-center gap-1 text-ink-muted underline-offset-2 hover:underline"
              >
                <Landmark size={11} /> {item.hallOfFame.title}
              </Link>
            </p>
          ) : null}
        </div>
      ) : item.progress ? (
        <div className="mt-2">
          <TimingBar
            value={item.progress.target > 0 ? (item.progress.value / item.progress.target) * 100 : 0}
            height="h-1"
            label={item.title}
          />
          <p className="mt-1 text-[0.625rem] text-ink-faint">
            {stillAheadNote(item.progress.value, item.progress.target, item.progress.unit)}
          </p>
        </div>
      ) : null}
    </li>
  );
}
