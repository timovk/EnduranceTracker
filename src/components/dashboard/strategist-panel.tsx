/**
 * The Race Strategist panel.
 *
 * Three suggestions, each with its reasoning. The footnote is not decoration:
 * these are suggestions, and the application says so out loud so that opening
 * the dashboard never feels like being handed a task list.
 */

import Link from 'next/link';
import { ArrowRight, Compass, PlayCircle, Shuffle } from 'lucide-react';
import type { Recommendation, RecommendationKind } from '@/lib/engines/contracts';
import { formatDuration } from '@/lib/domain/time';
import { RECOMMENDATION_FOOTNOTE } from '@/lib/copy/tone';
import { Badge, EmptyState, Panel, PanelHeader, TimingBar } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';

const KIND_META: Record<RecommendationKind, { label: string; icon: typeof PlayCircle }> = {
  CONTINUE: { label: 'Continue the story', icon: PlayCircle },
  BEST_FIT: { label: 'Fits your window', icon: Compass },
  WILDCARD: { label: 'Something different', icon: Shuffle },
};

export function StrategistPanel({
  recommendations, windowMinutes,
}: { recommendations: Recommendation[]; windowMinutes?: number }) {
  return (
    <Panel>
      <PanelHeader
        title="Race Strategist"
        action={
          <Link href="/planner" className="text-[0.6875rem] text-ink-dim transition-colors hover:text-ink-muted">
            Open planner
          </Link>
        }
      />

      {recommendations.length === 0 ? (
        <EmptyState
          title="Nothing to suggest just yet"
          body="Add a race to your library and the strategist will start making suggestions."
          action={<Link href="/races/new"><Button size="sm" variant="primary">Add a race</Button></Link>}
        />
      ) : (
        <div className="divide-y divide-hairline">
          {recommendations.map((rec) => (
            <RecommendationRow key={`${rec.kind}-${rec.raceId}`} rec={rec} />
          ))}
        </div>
      )}

      <p className="border-t border-hairline px-4 py-2.5 text-[0.6875rem] text-ink-faint">
        {RECOMMENDATION_FOOTNOTE}
        {windowMinutes ? ` Sized for about ${formatDuration(windowMinutes * 60)}.` : null}
      </p>
    </Panel>
  );
}

function RecommendationRow({ rec }: { rec: Recommendation }) {
  const meta = KIND_META[rec.kind];
  const Icon = meta.icon;
  const accent = rec.championshipColor ?? 'var(--accent)';

  return (
    <div
      className="group px-4 py-3.5 transition-colors hover:bg-panel-2/60"
      style={{ ['--accent' as string]: accent } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="label mb-1.5 flex items-center gap-1.5 text-ink-muted">
            {/* The icon carries the championship colour; the label stays
                neutral, so a red championship never reads as an alarm. */}
            <Icon size={11} className="text-[var(--accent)]" />
            {meta.label}
          </div>

          <p className="text-sm leading-relaxed text-ink">{rec.headline}</p>

          {rec.reasons.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {rec.reasons.slice(0, 4).map((reason, i) => (
                <Badge key={i} tone="outline">{reason}</Badge>
              ))}
            </div>
          ) : null}

          {rec.coverageSec > 0 ? (
            <TimingBar
              value={rec.completionPercent}
              className="mt-2.5 max-w-sm"
              height="h-1"
              color={accent}
              label={`${rec.raceName} completion`}
            />
          ) : null}
        </div>

        <Link href={`/races/${rec.raceId}`} className="shrink-0">
          <Button size="sm" variant="subtle" className="opacity-80 group-hover:opacity-100">
            Open <ArrowRight size={12} />
          </Button>
        </Link>
      </div>
    </div>
  );
}
