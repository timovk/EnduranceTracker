/**
 * The XP ledger.
 *
 * Career XP is never a bare number — every award is a row, which is what makes
 * progression auditable and a re-balance replayable. Showing the ledger is the
 * honest thing to do, and it reads like a results sheet.
 */

import type { XpLedgerRow } from '@/lib/server/career';
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives';
import { formatDate, formatNumber } from '@/lib/utils';

export function XpLedgerTable({ rows }: { rows: XpLedgerRow[] }) {
  return (
    <Panel>
      <PanelHeader title="XP ledger" />
      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded yet" body="Every XP award lands here, so progression can always be traced back." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="label px-4 py-2 font-semibold">When</th>
                <th className="label px-4 py-2 font-semibold">Award</th>
                <th className="label px-4 py-2 text-right font-semibold">XP</th>
                <th className="label px-4 py-2 text-right font-semibold">Total after</th>
                <th className="label px-4 py-2 text-right font-semibold">Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2 text-xs text-ink-faint">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-2 text-xs text-ink-muted">{row.description}</td>
                  <td className="timing px-4 py-2 text-right text-xs text-[var(--accent)]">
                    +{formatNumber(row.amount)}
                  </td>
                  <td className="timing px-4 py-2 text-right text-xs text-ink-dim">
                    {formatNumber(row.careerXpAfter)}
                  </td>
                  <td className="timing px-4 py-2 text-right text-xs text-ink-dim">{row.levelAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
