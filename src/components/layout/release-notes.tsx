/**
 * One version's notes, as the update log and the "What's new" panel show them.
 */

import type { ChangeKind, ChangelogEntry } from '@/lib/changelog';
import { formatReleaseDate } from '@/lib/changelog';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const KIND_TONE: Record<ChangeKind, 'accent' | 'info' | 'positive'> = {
  New: 'accent',
  Changed: 'info',
  Fixed: 'positive',
};

export function ReleaseNotes({
  entry, showHeading = true, className,
}: {
  entry: ChangelogEntry;
  showHeading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {showHeading ? (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="timing text-sm font-semibold text-[var(--accent)]">{entry.version}</span>
            <h2 className="text-[1rem] font-semibold text-ink">{entry.title}</h2>
          </div>
          <div className="mt-0.5 text-xs text-ink-faint">{formatReleaseDate(entry.date)}</div>
        </div>
      ) : null}

      <p className="text-sm leading-relaxed text-ink-muted">{entry.summary}</p>

      {entry.note ? (
        <p className="rounded-md border border-hairline bg-panel-2 px-3 py-2 text-xs text-ink-dim">{entry.note}</p>
      ) : null}

      {entry.changes.map((group) => (
        <section key={group.kind}>
          <Badge tone={KIND_TONE[group.kind]}>{group.kind}</Badge>
          <ul className="mt-2 space-y-1.5">
            {group.items.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
                <span aria-hidden className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
