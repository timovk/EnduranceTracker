/**
 * The race library's page links (0.4.0).
 *
 * A library of thousands of races is shown a page at a time, so the page never
 * carries every card. The links keep the filters, sort and search of the view
 * they are on; nothing is shown when everything fits on one page.
 */

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

export function LibraryPager({
  page, pageCount, pageSize, total, hrefFor,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** The address of a page of this view, with a `#` to the top of the list (a link to the same page otherwise keeps the scroll position). */
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const link = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-ink-muted hover:bg-panel-2 hover:text-ink';

  // On a phone the count takes its own line above the two links; from `sm`
  // up the three sit on one line.
  return (
    <nav
      aria-label="Library pages"
      className="mt-4 grid grid-cols-2 items-center gap-x-3 gap-y-2 text-sm sm:grid-cols-[1fr_auto_1fr]"
    >
      <span className="col-span-2 text-center text-ink-dim sm:order-2 sm:col-span-1">
        Races {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)} · page {formatNumber(page)} of {formatNumber(pageCount)}
      </span>
      <div className="sm:order-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={link}>
            <ChevronLeft size={14} /> Previous
          </Link>
        ) : null}
      </div>
      <div className="justify-self-end sm:order-3">
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={link}>
            Next <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
