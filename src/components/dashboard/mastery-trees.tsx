'use client';

/**
 * Mastery trees.
 *
 * Drawn as rows of nodes rather than as a list, so the shape of a long-term
 * progression is visible at a glance. Every node shows its progress whether it
 * is unlocked or not, because seeing that you are 38 of 50 hours into a tier is
 * most of the pleasure of a tree like this.
 */

import * as React from 'react';
import { Check, Globe, Layers, Repeat } from 'lucide-react';
import type { MasteryTreeView } from '@/lib/engines/mastery-engine';
import type { MasteryKind } from '@/lib/domain/types';
import { Panel, PanelBody, PanelHeader, RarityBadge, rarityColor, TimingBar } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/controls';
import { cn, formatDate, formatNumber } from '@/lib/utils';

const KIND_ICON: Record<MasteryKind, typeof Layers> = {
  CHAMPIONSHIP: Layers,
  RACE_EVENT: Repeat,
  GLOBAL: Globe,
};

const KIND_LABEL: Record<MasteryKind, string> = {
  CHAMPIONSHIP: 'Championships',
  RACE_EVENT: 'Recurring events',
  GLOBAL: 'Career',
};

export function MasteryTrees({ trees }: { trees: MasteryTreeView[] }) {
  const kinds = (['GLOBAL', 'CHAMPIONSHIP', 'RACE_EVENT'] as const).filter((kind) =>
    trees.some((tree) => tree.kind === kind));
  const [kind, setKind] = React.useState<MasteryKind>(kinds[0] ?? 'CHAMPIONSHIP');

  const visible = trees.filter((tree) => tree.kind === kind);

  return (
    <div className="space-y-4">
      {kinds.length > 1 ? (
        <Segmented
          value={kind}
          onChange={setKind}
          options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
      ) : null}

      {visible.map((tree) => <Tree key={tree.key} tree={tree} />)}
    </div>
  );
}

function Tree({ tree }: { tree: MasteryTreeView }) {
  const Icon = KIND_ICON[tree.kind];

  return (
    <Panel
      accent={tree.accentColor}
      className={cn(tree.completed && 'border-[color-mix(in_oklab,var(--accent)_50%,transparent)]')}
    >
      <PanelHeader
        title={tree.name}
        icon={<Icon size={12} />}
        action={
          <span className="flex items-center gap-2.5 text-[0.6875rem]">
            {tree.completed ? (
              <span className="uppercase tracking-[0.1em] text-[var(--accent)]">complete</span>
            ) : null}
            <span className="timing text-ink-faint">{tree.unlockedCount}/{tree.nodeCount}</span>
          </span>
        }
      />
      <PanelBody className="space-y-4">
        <div>
          <TimingBar
            value={tree.completionPercent}
            height="h-1.5"
            color={tree.accentColor}
            label={`${tree.name} mastery`}
          />
          <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[0.6875rem] text-ink-faint">
            <span>{tree.headline}</span>
            <span className="timing">{tree.completionPercent.toFixed(1)}%</span>
          </div>
        </div>

        <div className="space-y-3">
          {tree.tiers.map((group) => (
            <div key={group.tier}>
              <div className="label mb-1.5 flex items-center gap-2">
                <span>Tier {group.tier}</span>
                <span className="timing text-ink-faint">{group.unlocked}/{group.total}</span>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.nodes.map((node) => {
                  const color = rarityColor(node.rarity);
                  return (
                    <li
                      key={node.key}
                      className={cn(
                        'rounded-md border px-2.5 py-2',
                        node.unlocked ? 'bg-panel-2' : 'bg-panel/60',
                      )}
                      style={{
                        borderColor: node.unlocked
                          ? `color-mix(in oklab, ${color} 45%, transparent)`
                          : 'var(--color-hairline)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {node.unlocked ? <Check size={11} className="shrink-0 text-verde" /> : null}
                            <span className={cn('truncate text-xs font-medium', node.unlocked ? 'text-ink' : 'text-ink-muted')}>
                              {node.name}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[0.625rem] leading-relaxed text-ink-faint">
                            {node.description}
                          </p>
                        </div>
                        <RarityBadge rarity={node.rarity} />
                      </div>

                      <TimingBar
                        value={node.progress * 100}
                        height="h-1"
                        className="mt-2"
                        color={node.unlocked ? color : undefined}
                        label={node.name}
                      />
                      <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
                        <span className="timing">
                          {formatNumber(Math.min(node.value, node.target), node.target % 1 === 0 ? 0 : 1)}
                          {' / '}
                          {formatNumber(node.target, node.target % 1 === 0 ? 0 : 1)}
                        </span>
                        <span>
                          {node.unlocked ? formatDate(node.unlockedAt) : `+${formatNumber(node.xpReward)} XP`}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}
