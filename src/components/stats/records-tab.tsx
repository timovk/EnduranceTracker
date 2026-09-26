'use client';

/**
 * Personal Records: the best a career has done at each thing, and how each
 * best got there.
 *
 * Only records that are set get a card; the rest are named once, in a line
 * under the grid, so a new career sees what it has done rather than a wall of
 * empty boxes. A record that rests on when stints were logged carries a mark,
 * explained once in a footnote rather than on every card.
 */

import * as React from 'react';
import Link from 'next/link';
import type { RecordCard, RecordEntry, RecordsView } from '@/lib/engines/stats-engine';
import { Panel, PanelBody, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';

export function RecordsTab({ view, onCareerRecords }: { view: RecordsView; onCareerRecords: () => void }) {
  const heading = view.withinYear !== null ? `Your best in ${view.withinYear}` : 'Personal records';
  const within = view.withinYear !== null || view.narrowed ? `Records within: ${view.scopeLabel}` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="text-[1rem] font-semibold tracking-tight text-ink">{heading}</h2>
          {within ? <p className="mt-0.5 text-xs text-ink-dim">{within}</p> : null}
        </div>
        {view.withinYear !== null ? (
          <Button variant="ghost" size="sm" onClick={onCareerRecords}>
            See your career records
          </Button>
        ) : null}
      </div>

      {view.records.length === 0 ? (
        <Panel>
          <EmptyState
            title="No records set yet"
            body="Records are set as you watch: the longest session, the biggest day, the longest race completed."
          />
        </Panel>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {view.records.map((record) => <RecordCardView key={record.kind} record={record} />)}
        </div>
      )}

      {view.stillToBeSet.length > 0 ? (
        <p className="px-1 text-xs leading-relaxed text-ink-dim">
          Still to be set: {view.stillToBeSet.join(', ')}.
        </p>
      ) : null}
      {view.loggedTimeNote ? (
        <p className="px-1 text-[0.6875rem] leading-relaxed text-ink-faint">{view.loggedTimeNote}</p>
      ) : null}
    </div>
  );
}

function Subject({ subject }: { subject: RecordEntry['subject'] }) {
  if (subject === null) return null;
  if (subject.href === null) return <span className="text-ink-muted">{subject.name}</span>;
  return (
    <Link href={subject.href} className="text-ink-muted underline-offset-2 hover:text-ink hover:underline">
      {subject.name}
    </Link>
  );
}

function RecordCardView({ record }: { record: RecordCard }) {
  const [open, setOpen] = React.useState(false);
  const historyId = React.useId();

  return (
    <Panel>
      <PanelBody className="space-y-2">
        <div className="label">
          {record.label}
          {record.loggedTime ? <span title="Depends on when stints were logged"> *</span> : null}
        </div>
        <div className="timing tnum text-2xl text-ink">{record.valueText}</div>
        <div className="space-y-0.5 text-xs">
          <div className="truncate"><Subject subject={record.subject} /></div>
          <div className="text-ink-dim">{record.when}</div>
        </div>

        {record.history.length > 1 ? (
          <div className="border-t border-hairline pt-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={historyId}
              onClick={() => setOpen((current) => !current)}
              className="text-[0.6875rem] text-ink-dim transition-colors hover:text-ink-muted"
            >
              History · set {record.history.length} times
            </button>
            {open ? (
              <ol id={historyId} className="mt-2 space-y-1.5">
                {record.history.map((entry, index) => (
                  <li key={`${entry.at.getTime()}-${index}`} className="flex items-baseline justify-between gap-3 text-[0.6875rem]">
                    <span className="min-w-0 truncate text-ink-dim">
                      {entry.when}
                      {entry.subject !== null && entry.when !== entry.subject.name ? (
                        <> · <Subject subject={entry.subject} /></>
                      ) : null}
                    </span>
                    <span className="timing shrink-0 text-ink-muted">{entry.valueText}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
