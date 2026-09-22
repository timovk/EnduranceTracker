'use client';

/**
 * Library filters.
 *
 * Kept in the URL so a filtered view can be linked and the back button works.
 * The views are framed as ways of looking at the library, not as a to-do list:
 * there is an "In progress" view but no "overdue" one.
 */

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input, Segmented, Select } from '@/components/ui/controls';

const VIEWS = [
  { value: '', label: 'Everything' },
  { value: 'unfinished', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'major', label: 'Major events' },
] as const;

const SORTS = [
  { value: 'recent', label: 'Recently watched' },
  { value: 'date', label: 'Race date' },
  { value: 'name', label: 'Name' },
  { value: 'progress', label: 'Progress' },
  { value: 'duration', label: 'Length' },
  { value: 'priority', label: 'Priority' },
] as const;

export function RaceFilterBar({
  championships,
}: { championships: { id: string; name: string; count: number }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = React.useState(params.get('q') ?? '');

  const update = React.useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Debounced so typing does not fire a navigation per keystroke.
  React.useEffect(() => {
    const current = params.get('q') ?? '';
    if (search === current) return;
    const timer = setTimeout(() => update('q', search), 250);
    return () => clearTimeout(timer);
  }, [search, params, update]);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search races, circuits, countries"
          className="pl-8"
          aria-label="Search the library"
        />
      </div>

      <Segmented
        size="sm"
        value={params.get('view') ?? ''}
        onChange={(value) => update('view', value)}
        options={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
      />

      <Select
        className="w-auto"
        value={params.get('championship') ?? ''}
        onChange={(e) => update('championship', e.target.value)}
        aria-label="Filter by championship"
      >
        <option value="">All championships</option>
        {championships.map((c) => (
          <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
        ))}
      </Select>

      <Select
        className="w-auto"
        value={params.get('sort') ?? 'recent'}
        onChange={(e) => update('sort', e.target.value)}
        aria-label="Sort"
      >
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </Select>
    </div>
  );
}
