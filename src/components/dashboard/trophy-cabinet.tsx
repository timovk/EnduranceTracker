'use client';

/**
 * The trophy cabinet.
 *
 * A shelf, grouped by what the trophies are for. Opening one shows what it was
 * made of — the races, the hours, the dates — because a trophy that cannot tell
 * you its own story is only a badge.
 */

import * as React from 'react';
import { Trophy as TrophyIcon } from 'lucide-react';
import type { TrophyCabinetView, TrophyCabinetEntry } from '@/lib/engines/awards-engine';
import { EmptyState, Panel, PanelBody, PanelHeader, RarityBadge, rarityColor } from '@/components/ui/primitives';
import { Dialog } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';

export function TrophyCabinet({ cabinet }: { cabinet: TrophyCabinetView }) {
  const [open, setOpen] = React.useState<TrophyCabinetEntry | null>(null);

  if (cabinet.total === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<TrophyIcon size={24} />}
          title="The cabinet is empty for now"
          body="Completing a season, finishing a mastery tree or reaching a rare achievement puts something on the shelf."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <div>
            <div className="label mb-1">Trophies</div>
            <div className="timing text-timing text-[var(--accent)]">{cabinet.total}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {cabinet.byRarity.map((tally) => (
              <div
                key={tally.rarity}
                className="rounded-md border px-2.5 py-1.5"
                style={{
                  borderColor: `color-mix(in oklab, ${rarityColor(tally.rarity)} 30%, transparent)`,
                  background: `color-mix(in oklab, ${rarityColor(tally.rarity)} 8%, transparent)`,
                }}
              >
                <div
                  className="text-[0.625rem] font-semibold uppercase tracking-[0.1em]"
                  style={{ color: rarityColor(tally.rarity) }}
                >
                  {tally.rarity.toLowerCase()}
                </div>
                <div className="timing mt-0.5 text-xs text-ink-muted">{tally.count}</div>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      {cabinet.categories.map((group) => (
        <Panel key={group.category}>
          <PanelHeader
            title={group.label}
            action={<span className="timing text-[0.6875rem] text-ink-faint">{group.trophies.length}</span>}
          />
          <PanelBody>
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.trophies.map((trophy) => {
                const color = trophy.accentColor || rarityColor(trophy.rarity);
                return (
                  <li key={trophy.key}>
                    <button
                      type="button"
                      onClick={() => setOpen(trophy)}
                      className="flex h-full w-full flex-col items-start gap-2 rounded-md border bg-panel-2 px-3 py-3 text-left transition-colors hover:bg-panel-3"
                      style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}
                    >
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded"
                        style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
                      >
                        <TrophyIcon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-ink">{trophy.name}</span>
                        <span className="mt-0.5 block line-clamp-2 text-[0.6875rem] leading-relaxed text-ink-faint">
                          {trophy.description}
                        </span>
                      </span>
                      <span className="flex w-full items-center justify-between gap-2">
                        <RarityBadge rarity={trophy.rarity} />
                        <span className="text-[0.625rem] text-ink-faint">{formatDate(trophy.awardedAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </PanelBody>
        </Panel>
      ))}

      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.name ?? ''}
        size="md"
      >
        {open ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded"
                style={{
                  background: `color-mix(in oklab, ${open.accentColor || rarityColor(open.rarity)} 14%, transparent)`,
                  color: open.accentColor || rarityColor(open.rarity),
                }}
              >
                <TrophyIcon size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-ink-muted">{open.description}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  Unlocked {formatDate(open.awardedAt, 'long')}
                </p>
              </div>
            </div>

            {open.details.length > 0 ? (
              <dl className="grid gap-x-6 gap-y-2.5 border-t border-hairline pt-3 sm:grid-cols-2">
                {open.details.map((detail) => (
                  <div key={detail.label}>
                    <dt className="label mb-0.5">{detail.label}</dt>
                    <dd className="timing text-sm text-ink-muted">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <p className="border-t border-hairline pt-3 text-[0.6875rem] text-ink-faint">
              Nothing in the cabinet can ever be taken back.
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
