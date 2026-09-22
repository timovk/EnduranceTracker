/**
 * The fuel tanks — weekly and annual viewing budget.
 *
 * Presented as instrumentation, never as a limit. The annual figure is a
 * planning framework: nothing here ever says the user cannot watch something,
 * and exceeding the plan is stated as a neutral fact.
 */

import { ProgressRing, Panel, PanelHeader, PanelBody, Stat, TimingBar } from '@/components/ui/primitives';
import type { BudgetSnapshot } from '@/lib/engines/contracts';
import { formatHours } from '@/lib/utils';

export function WeeklyFuelTank({ budget }: { budget: BudgetSnapshot }) {
  const used = budget.weekRecommendedHours > 0
    ? Math.min(1, budget.weekActualHours / budget.weekRecommendedHours)
    : 0;

  return (
    <Panel>
      <PanelHeader title="This week" />
      <PanelBody className="flex items-center gap-5">
        <ProgressRing progress={used} size={84} stroke={6} ariaLabel="Weekly viewing progress">
          <div>
            <div className="timing text-lg leading-none text-ink">{formatHours(budget.weekActualHours)}</div>
            <div className="label mt-0.5 text-[0.5rem]">watched</div>
          </div>
        </ProgressRing>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-ink-dim">Recommended</span>
            <span className="timing text-sm text-ink">{formatHours(budget.weekRecommendedHours)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-ink-dim">Remaining</span>
            <span className="timing text-sm text-ink-muted">
              {formatHours(Math.max(0, budget.weekRemainingHours))}
            </span>
          </div>
          {budget.weekRationale.length > 0 ? (
            <ul className="space-y-0.5 border-t border-hairline pt-2">
              {budget.weekRationale.slice(0, 3).map((reason, i) => (
                <li key={i} className="truncate text-[0.6875rem] text-ink-faint">{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </PanelBody>
    </Panel>
  );
}

export function AnnualFuelTank({ budget }: { budget: BudgetSnapshot }) {
  const aheadOrBehind = budget.hoursVersusTarget;

  return (
    <Panel>
      <PanelHeader title={`${budget.year} viewing budget`} />
      <PanelBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Used" value={formatHours(budget.usedHours)} size="sm" />
          <Stat label="Remaining" value={formatHours(budget.remainingHours)} size="sm" tone="muted" />
          <Stat label="Consumed" value={`${Math.round(budget.percentConsumed)}%`} size="sm" />
          <Stat
            label="Projected"
            value={formatHours(budget.projectedYearEndHours)}
            size="sm"
            tone={budget.projectedYearEndHours > budget.annualBudgetHours ? 'accent' : 'default'}
          />
        </div>

        <div>
          <TimingBar value={budget.percentConsumed} height="h-2" label="Annual budget consumed" />
          <div className="mt-1.5 flex justify-between text-[0.6875rem] text-ink-faint">
            <span>0h</span>
            <span className="timing">{formatHours(budget.annualBudgetHours, 0)} plan</span>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-muted">{budget.projectionNote}</p>

        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-3 text-[0.6875rem] text-ink-dim">
          <span>
            Recommended pace <span className="timing text-ink-muted">{formatHours(budget.recommendedPaceHours)}/week</span>
          </span>
          <span>
            {aheadOrBehind >= 0 ? 'Ahead of plan by' : 'Plan has'}{' '}
            <span className="timing text-ink-muted">{formatHours(Math.abs(aheadOrBehind))}</span>
            {aheadOrBehind >= 0 ? '' : ' in hand'}
          </span>
          <span>
            <span className="timing text-ink-muted">{Math.ceil(budget.weeksRemaining)}</span> weeks left
          </span>
        </div>
      </PanelBody>
    </Panel>
  );
}
