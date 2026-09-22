/**
 * The Hall of Fame.
 *
 * Presented as a museum rather than a feed: entries grouped by year, each one
 * a plaque with the career statistics frozen exactly as they stood at the
 * moment it happened. Years later that is what makes an entry worth reading —
 * not what you did, but where you were when you did it.
 */

import type { HallOfFameView } from '@/lib/engines/awards-engine';
import { EmptyState, Panel, PanelBody, PanelHeader, RarityBadge, rarityColor } from '@/components/ui/primitives';
import { formatDate, formatHours, formatNumber } from '@/lib/utils';

export function HallOfFameTimeline({ hall }: { hall: HallOfFameView }) {
  if (hall.entries.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="The hall is waiting"
          body="Your first completed race earns the first plaque. From then on it fills itself."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <div className="label mb-1">Entries</div>
            <div className="timing text-timing text-[var(--accent)]">{hall.entries.length}</div>
          </div>
          <div>
            <div className="label mb-1">Spanning</div>
            <div className="timing text-xl text-ink-muted">
              {hall.years.length} {hall.years.length === 1 ? 'year' : 'years'}
            </div>
          </div>
          <p className="min-w-[14rem] flex-1 text-sm leading-relaxed text-ink-muted">{hall.headline}</p>
        </PanelBody>
      </Panel>

      {hall.years.map((year) => (
        <Panel key={year.year}>
          <PanelHeader
            title={String(year.year)}
            action={<span className="timing text-[0.6875rem] text-ink-faint">{year.entries.length}</span>}
          />
          <ol className="divide-y divide-hairline">
            {year.entries.map((entry) => {
              const color = rarityColor(entry.rarity);
              return (
                <li key={entry.key} className="relative px-4 py-3.5">
                  <span
                    aria-hidden
                    className="absolute inset-y-3.5 left-0 w-0.5 rounded-full"
                    style={{ background: color }}
                  />
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 pl-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-ink">{entry.title}</h3>
                      {entry.subtitle ? (
                        <p className="mt-0.5 text-xs text-ink-muted">{entry.subtitle}</p>
                      ) : null}
                      <p className="mt-1 text-[0.6875rem] text-ink-faint">
                        {formatDate(entry.occurredAt, 'long')}
                        {entry.championshipName ? ` · ${entry.championshipName}` : ''}
                        {entry.seasonLabel ? ` · ${entry.seasonLabel}` : ''}
                      </p>
                    </div>
                    <RarityBadge rarity={entry.rarity} />
                  </div>

                  {/* The plaque: what the career looked like at that moment. */}
                  {entry.snapshot ? (
                    <dl className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-1.5 border-t border-hairline pl-3 pt-2.5 sm:grid-cols-4">
                      <Frozen label="Level" value={formatNumber(entry.snapshot.level)} />
                      <Frozen label="Real hours" value={formatHours(entry.snapshot.realHours)} />
                      <Frozen label="Stories" value={formatNumber(entry.snapshot.storyCompletes)} />
                      <Frozen label="Seasons" value={formatNumber(entry.snapshot.seasonsCompleted)} />
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Panel>
      ))}
    </div>
  );
}

function Frozen({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label mb-0.5 text-[0.5625rem]">{label}</dt>
      <dd className="timing text-xs text-ink-muted">{value}</dd>
    </div>
  );
}
