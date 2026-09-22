'use client';

/**
 * The week-by-week allocation.
 *
 * Shows what the engine suggested, why, and what actually happened. A week can
 * be marked as a rest week, which drops its recommendation to zero and spreads
 * those hours across the weeks around it — deliberate rest is part of the plan,
 * not a gap in it.
 */

import * as React from 'react';
import { Moon } from 'lucide-react';
import type { WeekAllocation } from '@/lib/engines/contracts';
import { Panel, PanelHeader, TimingBar } from '@/components/ui/primitives';
import { Button, Segmented } from '@/components/ui/controls';
import { setRestWeekAction } from '@/lib/server/actions';
import { cn, formatDate, formatHours } from '@/lib/utils';

export function BudgetWeekTable({
  upcoming, past, weeklyTargetHours,
}: { upcoming: WeekAllocation[]; past: WeekAllocation[]; weeklyTargetHours: number }) {
  const [view, setView] = React.useState<'upcoming' | 'past'>('upcoming');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const weeks = view === 'upcoming' ? upcoming : past;
  const scale = Math.max(
    weeklyTargetHours,
    ...weeks.map((w) => Math.max(w.recommendedHours, w.actualHours)),
    1,
  );

  function toggleRest(week: WeekAllocation) {
    const form = new FormData();
    form.set('isoYear', String(week.isoYear));
    form.set('isoWeek', String(week.isoWeek));
    form.set('isRestWeek', week.isRestWeek ? 'false' : 'true');
    startTransition(async () => {
      const result = await setRestWeekAction(form);
      setNotice(result.message ?? null);
    });
  }

  return (
    <Panel>
      <PanelHeader
        title="Week by week"
        action={
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[{ value: 'upcoming', label: 'Ahead' }, { value: 'past', label: 'Behind us' }]}
          />
        }
      />

      {weeks.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink-dim">
          {view === 'upcoming' ? 'Nothing planned beyond this week yet.' : 'No weeks recorded yet this year.'}
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {weeks.map((week) => (
            <li
              key={`${week.isoYear}-${week.isoWeek}`}
              className={cn('px-4 py-3', week.isCurrent && 'bg-panel-2/50')}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex items-baseline gap-2.5">
                  <span className="timing text-xs text-ink">W{week.isoWeek}</span>
                  <span className="text-[0.6875rem] text-ink-faint">
                    {formatDate(week.weekStart)}
                  </span>
                  {week.isCurrent ? (
                    <span className="text-[0.625rem] uppercase tracking-[0.12em] text-[var(--accent)]">this week</span>
                  ) : null}
                  {week.isRestWeek ? (
                    <span className="inline-flex items-center gap-1 text-[0.625rem] uppercase tracking-[0.12em] text-azure">
                      <Moon size={9} /> rest
                    </span>
                  ) : null}
                </div>

                <div className="flex items-baseline gap-3">
                  {week.actualHours > 0 ? (
                    <span className="timing text-xs text-ink">{formatHours(week.actualHours)}</span>
                  ) : null}
                  <span className="timing text-xs text-ink-dim">
                    {week.isRestWeek ? '—' : formatHours(week.recommendedHours)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleRest(week)}
                    title={week.isRestWeek ? 'Put this week back in the plan' : 'Mark as a rest week'}
                    className="text-[0.625rem]"
                  >
                    {week.isRestWeek ? 'Unrest' : 'Rest'}
                  </Button>
                </div>
              </div>

              {/* Recommendation behind, actual in front. */}
              <div className="relative mt-2">
                <TimingBar
                  value={(week.recommendedHours / scale) * 100}
                  height="h-1.5"
                  color="color-mix(in oklab, var(--accent) 30%, transparent)"
                  label={`Recommended for week ${week.isoWeek}`}
                />
                {week.actualHours > 0 ? (
                  <div className="pointer-events-none absolute inset-0">
                    <TimingBar
                      value={(week.actualHours / scale) * 100}
                      height="h-1.5"
                      track="bg-transparent"
                      label={`Watched in week ${week.isoWeek}`}
                    />
                  </div>
                ) : null}
              </div>

              {week.rationale.length > 0 ? (
                <p className="mt-1.5 text-[0.6875rem] text-ink-faint">{week.rationale.join(' · ')}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {notice ? (
        <p className="border-t border-hairline px-4 py-2.5 text-xs text-ink-muted">{notice}</p>
      ) : null}
    </Panel>
  );
}
