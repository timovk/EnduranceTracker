'use client';

/**
 * How much time the user has right now.
 *
 * A row of plausible viewing windows. The point is to make "I have 45 minutes"
 * a first-class question, because that is how endurance viewing actually gets
 * planned around a life.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Segmented } from '@/components/ui/controls';

const WINDOWS = [30, 45, 60, 90, 120, 180, 240, 360] as const;

export function WindowPicker({ value }: { value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setWindow(minutes: number) {
    const next = new URLSearchParams(params.toString());
    next.set('window', String(minutes));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <Segmented
      value={nearest(value)}
      onChange={setWindow}
      options={WINDOWS.map((minutes) => ({
        value: minutes,
        label: minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`,
      }))}
    />
  );
}

function nearest(value: number): number {
  return WINDOWS.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best, WINDOWS[0]);
}
