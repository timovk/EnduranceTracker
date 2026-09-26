'use client';

/**
 * Two calendar years side by side.
 *
 * Two years are two chapters of one career, not a race between them: every
 * difference is an amount (`differencePhrase`), and a percentage appears only
 * where its base is big enough to mean something. A year the career began in
 * says so first, and a year in progress is compared, by default, with the
 * same stretch of the other year.
 */

import type { CompareGroupRow, CompareRow, YearComparisonView } from '@/lib/engines/stats-engine';
import type { ParamChanges } from '@/components/dashboard/statistics-view';
import { CompareBars } from '@/components/charts/compare-bars';
import { Panel, PanelBody, PanelHeader, EmptyState } from '@/components/ui/primitives';
import { Button, Select, Toggle } from '@/components/ui/controls';
import { CAREER_STATS_SHAPE } from '@/lib/config';
import { differencePhrase } from '@/lib/copy/tone';
import { formatDuration } from '@/lib/domain/time';
import { formatNumber } from '@/lib/utils';
import * as React from 'react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function valueText(value: number | null, unit: CompareRow['unit']): string {
  if (value === null) return '—';
  if (unit === 'seconds') return formatDuration(value);
  if (unit === 'xp') return `${formatNumber(value)} XP`;
  if (unit === 'percent-points') return `${formatNumber(value, 1)}%`;
  return formatNumber(value);
}

/** "+12%" or "−8%": a change measured against the base year. */
function changeText(row: Pick<CompareRow, 'percentChange' | 'note'>): string {
  if (row.percentChange === null) return row.note ?? '—';
  const rounded = Math.round(row.percentChange);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '−'}${formatNumber(Math.abs(rounded))}%`;
}

export function CompareTab({ view, onChange }: { view: YearComparisonView; onChange: (changes: ParamChanges) => void }) {
  if (view.a === null || view.b === null) {
    return (
      <Panel>
        <EmptyState title="Two years to compare" body={view.emptyNote ?? undefined} />
      </Panel>
    );
  }
  const a = view.a;
  const b = view.b;

  // Picking the other side's year swaps the two, so a year is never set
  // beside itself.
  const pickA = (year: number) => onChange(year === b ? { a: `${year}`, b: `${a}` } : { a: `${year}` });
  const pickB = (year: number) => onChange(year === a ? { a: `${b}`, b: `${year}` } : { b: `${year}` });

  const months = view.months.map((month) => ({
    label: MONTHS[month.month - 1]?.slice(0, 3) ?? '',
    full: MONTHS[month.month - 1] ?? '',
    a: Math.round((month.a / 3600) * 10) / 10,
    b: Math.round((month.b / 3600) * 10) / 10,
    seconds: month,
  }));
  const active = months.filter((month) => month.seconds.a > 0 || month.seconds.b > 0);
  const monthSentence = active.length === 0
    ? `Nothing recorded in ${a} or ${b}${view.samePeriod ? ' over this stretch' : ''}.`
    : `${active.map((month) =>
      `${month.full}: ${formatDuration(month.seconds.a)} in ${a}, ${formatDuration(month.seconds.b)} in ${b}`).join('; ')}.`;

  return (
    <div className="space-y-4">
      {view.partialNote ? (
        <p className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-2.5 text-sm text-ink">
          {view.partialNote}.
        </p>
      ) : null}

      <Panel>
        <PanelHeader title="Compare two years" />
        <PanelBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Select className="w-auto" value={a} onChange={(e) => pickA(Number(e.target.value))} aria-label="First year">
              {view.years.map((year) => <option key={year} value={year}>{year}</option>)}
            </Select>
            <span className="text-xs text-ink-dim">and</span>
            <Select className="w-auto" value={b} onChange={(e) => pickB(Number(e.target.value))} aria-label="Second year">
              {view.years.map((year) => <option key={year} value={year}>{year}</option>)}
            </Select>
            {view.samePeriodOffered ? (
              <Toggle
                className="ml-1"
                checked={view.samePeriod}
                onChange={(on) => onChange({ same: on ? null : '0' })}
                label="Same stretch of the year"
              />
            ) : null}
          </div>
          <div className="space-y-1 text-[0.6875rem] leading-relaxed text-ink-faint">
            {view.stretchLabel ? <p>Both years run from {view.stretchLabel}.</p> : null}
            {view.narrowed ? <p>Within: {view.scopeLabel}.</p> : null}
            {view.careerWideNote ? <p>{view.careerWideNote}</p> : null}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="label px-4 py-2 font-semibold">Figure</th>
                <th className="label px-4 py-2 text-right font-semibold">{a}</th>
                <th className="label px-4 py-2 text-right font-semibold">{b}</th>
                <th className="label px-4 py-2 text-right font-semibold">Difference</th>
                <th className="label px-4 py-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {view.rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2 text-xs text-ink">{row.label}</td>
                  <td className="timing whitespace-nowrap px-4 py-2 text-right text-xs text-ink-muted">{valueText(row.a, row.unit)}</td>
                  <td className="timing whitespace-nowrap px-4 py-2 text-right text-xs text-ink-muted">{valueText(row.b, row.unit)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-ink-dim">
                    {row.difference === null ? '—' : differencePhrase(row.difference, row.unit)}
                  </td>
                  <td className="max-w-[16rem] px-4 py-2 text-right text-[0.6875rem] text-ink-faint">{changeText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Month by month" />
        <PanelBody>
          <CompareBars data={months} aLabel={`${a}`} bLabel={`${b}`} unit="h" sentence={monthSentence} />
        </PanelBody>
      </Panel>

      <ShareTable title="Championships" rows={view.championships} a={a} b={b} />
      <ShareTable title="Events" rows={view.events} a={a} b={b} />
    </div>
  );
}

/**
 * Each year's hours by championship or event: as shares of the year in
 * percentage points once both years are big enough for a share to say
 * something, and as plain hours before that.
 */
function ShareTable({ title, rows, a, b }: { title: string; rows: CompareGroupRow[]; a: number; b: number }) {
  const [all, setAll] = React.useState(false);
  const top = CAREER_STATS_SHAPE.topListSize;
  const shown = all ? rows : rows.slice(0, top);
  const inShares = rows[0]?.unit === 'percent-points';

  return (
    <Panel>
      <PanelHeader title={title} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing to compare yet" />
      ) : (
        <>
          <p className="border-b border-hairline px-4 py-2 text-[0.6875rem] text-ink-faint">
            {inShares
              ? 'Each year’s share of its hours, in percentage points.'
              : `Hours, since ${a} or ${b} has too few for shares to say much.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="label px-4 py-2 font-semibold">{title === 'Events' ? 'Event' : 'Championship'}</th>
                  <th className="label px-4 py-2 text-right font-semibold">{a}</th>
                  <th className="label px-4 py-2 text-right font-semibold">{b}</th>
                  <th className="label px-4 py-2 text-right font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {shown.map((row) => (
                  <tr key={row.id ?? row.label}>
                    <td className="truncate px-4 py-2 text-xs text-ink">{row.label}</td>
                    <td className="timing whitespace-nowrap px-4 py-2 text-right text-xs text-ink-muted">{valueText(row.a, row.unit)}</td>
                    <td className="timing whitespace-nowrap px-4 py-2 text-right text-xs text-ink-muted">{valueText(row.b, row.unit)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-ink-dim">
                      {row.difference === null ? '—' : differencePhrase(row.difference, row.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!all && rows.length > top ? (
            <div className="border-t border-hairline px-4 py-2">
              <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
                Show all {formatNumber(rows.length)}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
