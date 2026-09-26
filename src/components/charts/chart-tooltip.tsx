import { formatNumber } from '@/lib/utils';

/** What Recharts hands a custom tooltip for each series under the cursor. */
export interface TooltipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  /** The data row itself: `full` is its label in full, `note` one more line to show under the values. */
  payload?: { full?: string; note?: string };
}

/**
 * The tooltip every chart uses: the point's full label ("March 2026" where the
 * axis says "Mar"), each series with its value, and the row's note if it has
 * one — the Story Completes of a length band, the sessions of a weekday.
 * `format` replaces the plain number where a value reads better as a duration.
 */
export function ChartTooltip({
  active, payload, label, unit = '', format,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  unit?: string;
  format?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const note = payload[0]?.payload?.note;

  return (
    <div className="rounded-md border border-hairline-strong bg-panel-2 px-2.5 py-2 shadow-lg">
      <div className="label mb-1">{payload[0]?.payload?.full ?? String(label ?? '')}</div>
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-baseline gap-3 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: entry.color }} />
            <span className="text-ink-dim">{entry.name}</span>
            <span className="timing ml-auto text-ink">
              {typeof entry.value === 'number'
                ? format
                  ? format(entry.value)
                  : `${formatNumber(entry.value, entry.value % 1 === 0 ? 0 : 1)}${unit}`
                : entry.value}
            </span>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-1 text-[0.6875rem] text-ink-dim">{note}</p> : null}
    </div>
  );
}
