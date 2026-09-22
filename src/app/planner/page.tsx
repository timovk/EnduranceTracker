import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { StrategistPanel } from '@/components/dashboard/strategist-panel';
import { WindowPicker } from '@/components/dashboard/window-picker';
import { Panel, PanelBody, PanelHeader, Stat } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { getRecommendations } from '@/lib/engines/strategist-engine';
import { getBudgetSnapshot } from '@/lib/engines/budget-engine';
import { ensureCareer } from '@/lib/server/bootstrap';
import { USER_ID } from '@/lib/db/client';
import { STRATEGIST_CONFIG } from '@/lib/config';
import { formatDuration } from '@/lib/domain/time';
import { formatHours } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Race Strategist' };

export default async function PlannerPage(props: PageProps<'/planner'>) {
  await ensureCareer();
  const params = await props.searchParams;
  const raw = Array.isArray(params.window) ? params.window[0] : params.window;
  const windowMinutes = clampWindow(raw ? Number.parseInt(raw, 10) : undefined);

  const [recommendations, budget] = await Promise.all([
    getRecommendations(USER_ID, { windowMinutes }),
    getBudgetSnapshot(USER_ID).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        eyebrow="Planner"
        title="Race Strategist"
        description="Suggestions built around finishing stories, not around earning XP. What you actually watch is entirely up to you."
        actions={<Link href="/races"><Button variant="subtle" size="sm">Race library</Button></Link>}
      />

      <Panel>
        <PanelHeader title="How long have you got?" />
        <PanelBody className="space-y-3">
          <WindowPicker value={windowMinutes} />
          <p className="text-xs text-ink-dim">
            The strategist sizes its Best Fit suggestion to this window
            {budget ? `, and you have about ${formatHours(Math.max(0, budget.weekRemainingHours))} left in this week's recommendation` : ''}.
            {' '}A long race is divided into stints rather than presented as one sitting.
          </p>
        </PanelBody>
      </Panel>

      <StrategistPanel recommendations={recommendations} windowMinutes={windowMinutes} />

      {recommendations.length > 0 ? (
        <Panel>
          <PanelHeader title="What each suggestion would take" />
          <PanelBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left">
                    <th className="label pb-2 font-semibold">Race</th>
                    <th className="label pb-2 text-right font-semibold">Complete</th>
                    <th className="label pb-2 text-right font-semibold">To finish</th>
                    <th className="label pb-2 text-right font-semibold">Next stint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {recommendations.map((rec) => (
                    <tr key={`${rec.kind}-${rec.raceId}`}>
                      <td className="py-2.5 pr-3">
                        <Link href={`/races/${rec.raceId}`} className="text-ink transition-colors hover:text-[var(--accent)]">
                          {rec.raceName}
                        </Link>
                        {rec.championshipName ? (
                          <div className="text-[0.6875rem] text-ink-faint">{rec.championshipName}</div>
                        ) : null}
                      </td>
                      <td className="timing py-2.5 text-right text-ink-muted">{rec.completionPercent.toFixed(0)}%</td>
                      <td className="timing py-2.5 text-right text-ink-muted">{formatDuration(rec.realSecondsToFinish)}</td>
                      <td className="timing py-2.5 text-right text-ink-muted">
                        {rec.suggestedStintSeconds > 0 ? formatDuration(rec.suggestedStintSeconds) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PanelBody>
        </Panel>
      ) : null}

      {budget ? (
        <Panel>
          <PanelHeader title="Where this sits in the year" />
          <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="This week" value={formatHours(budget.weekActualHours)} sub={`of ${formatHours(budget.weekRecommendedHours)}`} size="sm" />
            <Stat label="Used this year" value={formatHours(budget.usedHours)} size="sm" tone="muted" />
            <Stat label="Remaining" value={formatHours(budget.remainingHours)} size="sm" tone="muted" />
            <Stat label="Projected" value={formatHours(budget.projectedYearEndHours)} size="sm" tone="accent" />
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}

function clampWindow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return STRATEGIST_CONFIG.defaultWindowMinutes;
  return Math.min(1440, Math.max(15, Math.round(value)));
}
