'use client';

/**
 * Primary navigation.
 *
 * A persistent rail on desktop (the primary experience) that collapses to a
 * scrollable top bar on tablets and phones.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Award, BarChart3, BookOpen, CalendarClock, Gauge, Landmark, Layers,
  ListChecks, Settings, Ticket, Trophy, Waypoints, Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Dashboard', icon: Gauge },
  { href: '/races', label: 'Race Library', icon: BookOpen },
  { href: '/planner', label: 'Race Strategist', icon: Waypoints },
  { href: '/budget', label: 'Viewing Budget', icon: CalendarClock },
  { href: '/challenges', label: 'Challenges', icon: ListChecks },
  { href: '/season-pass', label: 'Season Pass', icon: Ticket },
  { href: '/career', label: 'Career', icon: Target },
  { href: '/mastery', label: 'Mastery', icon: Layers },
  { href: '/collections', label: 'Collections', icon: Layers },
  { href: '/achievements', label: 'Achievements', icon: Award },
  { href: '/trophies', label: 'Trophy Cabinet', icon: Trophy },
  { href: '/hall-of-fame', label: 'Hall of Fame', icon: Landmark },
  { href: '/stats', label: 'Statistics', icon: BarChart3 },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="hidden w-[15.5rem] shrink-0 flex-col border-r border-hairline bg-void/40 lg:flex"
    >
      <Link href="/" className="flex items-center gap-2.5 border-b border-hairline px-5 py-4">
        <Wordmark />
      </Link>

      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[0.8125rem] font-medium transition-colors',
                    active
                      ? 'bg-panel-2 text-ink'
                      : 'text-ink-dim hover:bg-panel/70 hover:text-ink-muted',
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--accent)]" />
                  ) : null}
                  <Icon size={15} className={cn('shrink-0', active && 'text-[var(--accent)]')} />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="border-t border-hairline px-5 py-3 text-[0.6875rem] leading-relaxed text-ink-faint">
        Experience the complete story.
      </p>
    </nav>
  );
}

export function TopNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-30 border-b border-hairline bg-base/92 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Link href="/"><Wordmark compact /></Link>
      </div>
      <nav aria-label="Main" className="-mb-px flex gap-1 overflow-x-auto px-3 pb-2">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                active ? 'bg-panel-2 text-ink' : 'text-ink-dim hover:text-ink-muted',
              )}
            >
              <Icon size={13} className={cn(active && 'text-[var(--accent)]')} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[var(--accent)]/40 bg-[var(--accent-soft)]"
      >
        <span className="timing text-[0.6875rem] font-bold text-[var(--accent)]">24</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-semibold leading-tight tracking-tight text-ink">
          Endurance Career
        </span>
        {!compact ? (
          <span className="block truncate text-[0.625rem] uppercase tracking-[0.16em] text-ink-faint">
            Career Mode
          </span>
        ) : null}
      </span>
    </span>
  );
}
