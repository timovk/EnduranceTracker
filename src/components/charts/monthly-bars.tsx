'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { AXIS_PROPS, CHART_COLORS } from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

export interface BarSeries<T> {
  key: keyof T & string;
  name: string;
  color: string;
}

/**
 * Bars over time — months, or years — one or more series side by side. Quiet
 * periods stay in the series as empty slots, so a gap reads as a quiet month,
 * not as a missing one.
 */
export function PeriodBars<T extends { label: string; full: string }>({
  data, series, unit = '', sentence, points = data.length, format, allowDecimals = true,
}: {
  data: T[];
  series: BarSeries<T>[];
  unit?: string;
  /** Said instead of the chart below the minimum number of points. */
  sentence: string;
  points?: number;
  format?: (value: number) => string;
  allowDecimals?: boolean;
}) {
  return (
    <ChartFrame points={points} sentence={sentence}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} allowDecimals={allowDecimals} />
          <Tooltip content={<ChartTooltip unit={unit} format={format} />} cursor={{ fill: CHART_COLORS.cursorFill }} />
          {series.map((entry) => (
            <Bar key={entry.key} dataKey={String(entry.key)} name={entry.name} fill={entry.color} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
