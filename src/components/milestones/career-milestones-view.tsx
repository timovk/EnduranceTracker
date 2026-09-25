'use client';

/**
 * The Career Milestones page body.
 *
 * Two ways to read the same record: by kind of moment — the firsts, the
 * complete stories, the hours, the races, the years, the recurring events —
 * or as one timeline, newest first. Nothing on either is ever taken away, and
 * nothing still ahead is framed as something owed.
 *
 * The years are listed only when they reached the plan's hours; the current
 * year is a plain fact with no bar, because a yearly target that resets every
 * January would be a quota.
 */

import * as React from 'react';
import type { CareerMilestonesView as View } from '@/lib/engines/career-milestone-engine';
import { yearToDateFact } from '@/lib/copy/tone';
import { EmptyState, Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/controls';
import { MilestoneCard } from './milestone-card';

export function CareerMilestonesView({ view }: { view: View }) {
  const [mode, setMode] = React.useState<'groups' | 'date'>('groups');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'groups', label: 'By kind' },
            { value: 'date', label: 'By date' },
          ]}
        />
        <span className="timing text-[0.6875rem] text-ink-faint">
          {view.timeline.length} reached
        </span>
      </div>

      {mode === 'groups' ? (
        view.groups.map((group) => {
          const reached = group.items.filter((item) => item.reached).length;
          const isYears = group.group === 'years';
          return (
            <Panel key={group.group}>
              <PanelHeader
                title={group.title}
                action={
                  <span className="timing text-[0.6875rem] text-ink-faint">
                    {isYears ? reached : `${reached}/${group.items.length}`}
                  </span>
                }
              />
              <PanelBody className="space-y-3">
                {isYears ? (
                  <p className="text-sm text-ink-muted">
                    {yearToDateFact(view.currentYear.year, view.currentYear.creditedSeconds)}
                  </p>
                ) : null}
                {group.items.length > 0 ? (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {group.items.map((item) => <MilestoneCard key={item.id} item={item} />)}
                  </ul>
                ) : null}
              </PanelBody>
            </Panel>
          );
        })
      ) : (
        <Panel>
          <PanelHeader title="Every milestone, newest first" />
          {view.timeline.length === 0 ? (
            <EmptyState
              title="The first milestone arrives with the first stint"
              body="From then on each one is kept here with the date it happened."
            />
          ) : (
            <PanelBody>
              <ol className="grid gap-3 sm:grid-cols-2">
                {view.timeline.map((item) => <MilestoneCard key={item.id} item={item} />)}
              </ol>
            </PanelBody>
          )}
        </Panel>
      )}
    </div>
  );
}
