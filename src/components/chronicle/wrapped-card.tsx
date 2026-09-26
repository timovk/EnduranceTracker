/**
 * One Endurance Wrapped card. Every card has the same anatomy: a small label,
 * one hero figure or name, and one sentence about it (`wrappedCardLine`) —
 * which is what makes Wrapped a celebration rather than a table. A card about
 * a championship takes on its colour. In a year-to-date preview every card
 * says so, so none can be mistaken for the finished year.
 */

import Link from 'next/link';
import type { WrappedCard as Card } from '@/lib/domain/chronicle';
import { differencePhrase } from '@/lib/copy/tone';
import { formatDuration } from '@/lib/domain/time';
import { accentVars } from '@/components/ui/accent';
import { formatDate, formatNumber } from '@/lib/utils';

/** Hours as a hero figure: "212", or "1.5" below ten. */
function heroHours(seconds: number): string {
  const hours = seconds / 3600;
  return (hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10).toLocaleString('en-GB');
}

/** What a card is called, and the one figure or name it leads with. */
function anatomy(card: Card): { label: string; hero: string; unit?: string } {
  switch (card.kind) {
    case 'opening':
      return { label: `Endurance Wrapped · Career Year ${card.careerYear}`, hero: `${card.year}` };
    case 'hours': {
      const hours = heroHours(card.creditedSeconds);
      return { label: 'At the track', hero: hours, unit: hours === '1' ? 'hour' : 'hours' };
    }
    case 'races':
      return { label: 'Races experienced', hero: formatNumber(card.racesExperienced) };
    case 'championship':
      return { label: 'Most-watched championship', hero: card.name };
    case 'event':
      return { label: 'Most-watched recurring event', hero: card.name };
    case 'longest-race':
      return { label: 'Longest race', hero: card.name };
    case 'longest-session':
      return { label: 'Longest session', hero: formatDuration(card.creditedSeconds) };
    case 'circuit':
      return { label: 'Favourite circuit', hero: card.name };
    case 'active':
      return card.month !== null
        ? { label: 'Most active month', hero: card.month.label }
        : { label: 'Most active week', hero: card.week?.label ?? '' };
    case 'xp':
      return { label: 'XP earned', hero: formatNumber(card.xpEarned), unit: 'XP' };
    case 'landmarks':
      return { label: 'Landmarks reached', hero: formatNumber(card.achievements + card.milestones + card.masterySteps) };
    case 'expeditions':
      return { label: 'Expeditions completed', hero: formatNumber(card.count) };
    case 'records':
      return { label: 'Personal records set', hero: formatNumber(card.records.length) };
    case 'compared':
      return { label: `Compared with ${card.previousYear}`, hero: `${card.previousYear} → ${card.year}` };
    case 'closing':
      return { label: 'The full chapter', hero: `${card.year}` };
  }
}

export function WrappedCard({ card, line, chapterHref }: { card: Card; line: string; chapterHref: string }) {
  const { label, hero, unit } = anatomy(card);
  const accent = card.kind === 'championship' && card.accent !== null ? accentVars(card.accent) : undefined;

  return (
    <article
      style={accent}
      className="panel-raised relative flex min-h-[26rem] flex-col justify-between gap-6 overflow-hidden border-[var(--accent)]/35 p-6 sm:min-h-[22rem] sm:p-10"
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label text-[var(--accent)]">{label}</span>
          {card.asOf !== null ? (
            <span className="rounded border border-[var(--accent)]/35 bg-[var(--accent-soft)] px-1.5 py-0.5 text-[0.6875rem] font-medium text-[var(--accent)]">
              Year to date · as of {formatDate(card.asOf, 'long')}
            </span>
          ) : null}
        </div>
        <p className="timing text-timing-lg line-clamp-2 break-words text-ink">
          {hero}
          {unit !== undefined ? <span className="ml-2 text-lg text-ink-dim">{unit}</span> : null}
        </p>
      </div>

      <div className="space-y-4">
        <p className="max-w-2xl text-[1rem] leading-relaxed text-ink-muted">{line}</p>
        {card.kind === 'compared' ? (
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {card.rows.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-3 rounded-md border border-hairline px-3 py-1.5">
                <span className="text-ink-dim">{row.label.charAt(0).toUpperCase()}{row.label.slice(1)}</span>
                <span className="text-ink">
                  {differencePhrase(row.difference, row.unit)}
                  {row.percentChange !== null ? (
                    <span className="timing ml-1.5 text-xs text-ink-dim">
                      ({row.percentChange >= 0 ? '+' : '−'}{Math.abs(Math.round(row.percentChange))}%)
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {card.kind === 'records' ? (
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {card.records.map((record) => (
              <li key={record.label} className="flex items-baseline justify-between gap-3 rounded-md border border-hairline px-3 py-1.5">
                <span className="text-ink-dim">{record.label}</span>
                <span className="timing text-ink">{record.valueText}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {card.kind === 'closing' ? (
          <Link href={chapterHref} className="inline-flex text-sm font-medium text-[var(--accent)] hover:underline">
            Read the full chapter
          </Link>
        ) : null}
      </div>
    </article>
  );
}
