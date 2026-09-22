import { Lock } from 'lucide-react';
import { AccountAvatar } from '@/components/accounts/avatar';
import { Badge, Stat } from '@/components/ui/primitives';
import { cn, formatHours, formatNumber } from '@/lib/utils';

/**
 * Everything a card shows, already resolved.
 *
 * The level title and the "last raced" phrase are worked out on the server and
 * travel as plain strings, so a card is pure presentation and the picker can
 * stay a thin client component.
 */
export interface AccountCardData {
  id: string;
  name: string;
  avatarKey: string;
  accentKey: string;
  hasPassword: boolean;
  level: number;
  title: string;
  hoursWatched: number;
  racesCompleted: number;
  lastRaced: string;
}

/**
 * The face of an account card, without a control around it.
 *
 * The picker makes the whole card the button; the sign-in screen shows the
 * same face with nothing to press, so that signing in plainly belongs to the
 * account you just chose.
 */
export function AccountCardFace({
  account, className,
}: { account: AccountCardData; className?: string }) {
  return (
    <div className={cn('p-4', className)}>
      <div className="flex items-start gap-3">
        <AccountAvatar avatarKey={account.avatarKey} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] font-semibold leading-tight text-ink">
            {account.name}
          </div>
          <div className="mt-1 truncate text-xs text-ink-dim">
            Level {formatNumber(account.level)} · {account.title}
          </div>
        </div>
        {account.hasPassword ? (
          <Badge tone="outline" className="shrink-0" title="This account asks for a password">
            <Lock size={11} />
            Protected
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3">
        <Stat label="Hours watched" value={formatHours(account.hoursWatched)} size="sm" />
        <Stat label="Races completed" value={formatNumber(account.racesCompleted)} size="sm" />
      </div>

      <p className="mt-3 text-xs text-ink-faint">{account.lastRaced}</p>
    </div>
  );
}
