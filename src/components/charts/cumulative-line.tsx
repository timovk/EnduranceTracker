'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { AXIS_PROPS, CHART_COLORS } from './chart-theme';
import { ChartTooltip } from './chart-tooltip';
import type { BarSeries } from './monthly-bars';

/**
 * Running totals over time: one line or a few. `step` draws each total as
 * the level it held until the next change — races completed arrive one at a
 * time, and a slope between two months would invent the ones in between.
 * A running total only ever rises, so the chart shows a career accumulating,
 * never a streak to keep up.
 */
export function CumulativeLine<T extends { label: string; full: string }>({
  data, series, sentence, points = data.length, step = false,
}: {
  data: T[];
  series: BarSeries<T>[];
  sentence: string;
  points?: number;
  step?: boolean;
}) {
  return (
    <ChartFrame points={points} sentence={sentence}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={16} />
          <YAxis {...AXIS_PROPS} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: CHART_COLORS.cursorStroke }} />
          {series.length > 1 ? <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: CHART_COLORS.axis }} /> : null}
          {series.map((entry) => (
            <Line
              key={entry.key}
              type={step ? 'stepAfter' : 'monotone'}
              dataKey={String(entry.key)}
              name={entry.name}
              stroke={entry.color}
              strokeWidth={1.5}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
