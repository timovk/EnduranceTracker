import { PageHeader } from '@/components/layout/page-header';
import { AnnualFuelTank, WeeklyFuelTank } from '@/components/dashboard/fuel-tanks';
import { BudgetWeekTable } from '@/components/dashboard/budget-week-table';
import { Panel, PanelBody, PanelHeader, Stat } from '@/components/ui/primitives';
import { getBudgetSnapshot } from '@/lib/engines/budget-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { requireUserId } from '@/lib/auth/session';
import { formatHours } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Viewing budget' };

export default async function BudgetPage() {
  const userId = await requireUserId();
  await ensureCareer(userId);
  const budget = await getBudgetSnapshot(userId);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="Planning"
        title="Viewing budget"
        description={`${formatHours(budget.annualBudgetHours, 0)} across the year, allocated adaptively rather than divided evenly. A planning framework, never a restriction — nothing here will ever tell you not to watch something.`}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr]">
        <WeeklyFuelTank budget={budget} />
        <AnnualFuelTank budget={budget} />
      </div>

      <Panel>
        <PanelHeader title="Pace" />
        <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Even split"
            value={formatHours(budget.basePaceHours)}
            sub="remaining ÷ weeks left"
            size="sm"
            tone="muted"
          />
          <Stat
            label="Adaptive pace"
            value={formatHours(budget.recommendedPaceHours)}
            sub="what the engine suggests"
            size="sm"
            tone="accent"
          />
          <Stat
            label="Versus plan"
            value={`${budget.hoursVersusTarget >= 0 ? '+' : ''}${formatHours(budget.hoursVersusTarget)}`}
            sub={budget.hoursVersusTarget >= 0 ? 'ahead of the adaptive target' : 'in hand against the target'}
            size="sm"
          />
          <Stat
            label="Weeks left"
            value={Math.ceil(budget.weeksRemaining).toString()}
            size="sm"
            tone="muted"
          />
        </PanelBody>
      </Panel>

      <BudgetWeekTable
        upcoming={budget.upcomingWeeks}
        past={budget.pastWeeks}
        weeklyTargetHours={budget.weekRecommendedHours}
      />
    </div>
  );
}
