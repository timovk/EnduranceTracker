import type * as React from 'react';
import { cn } from '@/lib/utils';
import { hasEnoughPoints } from './chart-theme';

/**
 * A chart, or the sentence that says its few points better than a chart
 * would (the decoration rule in `chart-theme.ts`): "One month so far:
 * 12h 40m."
 */
export function ChartFrame({
  points, sentence, height = 'h-64', children,
}: { points: number; sentence: string; height?: string; children: React.ReactNode }) {
  if (!hasEnoughPoints(points)) {
    return <p className="text-sm leading-relaxed text-ink-muted">{sentence}</p>;
  }
  return <div className={cn(height, 'w-full')}>{children}</div>;
}
