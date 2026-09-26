'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { AXIS_PROPS, CHART_COLORS } from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

export interface ComparePoint {
  /** "Mar". */
  label: string;
  /** "March". */
  full: string;
  a: number;
  b: number;
}

/**
 * Two years' months side by side, January to December: the base year in the
 * second colour, the year compared with it in the accent.
 */
export function CompareBars({
  data, aLabel, bLabel, unit = '', sentence,
}: { data: ComparePoint[]; aLabel: string; bLabel: string; unit?: string; sentence: string }) {
  return (
    <ChartFrame points={data.filter((month) => month.a > 0 || month.b > 0).length} sentence={sentence}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: CHART_COLORS.cursorFill }} />
          <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: CHART_COLORS.axis }} />
          <Bar dataKey="a" name={aLabel} fill={CHART_COLORS.secondary} radius={[2, 2, 0, 0]} />
          <Bar dataKey="b" name={bLabel} fill={CHART_COLORS.primary} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
