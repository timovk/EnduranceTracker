'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { AXIS_PROPS, CHART_COLORS } from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

export interface WeekdayPoint {
  /** "Mon". */
  label: string;
  /** "Monday". */
  full: string;
  hours: number;
  /** "4 sessions". */
  note: string;
}

/**
 * Seven bars, one per day of the week, in the order the user's week runs:
 * which evenings are race evenings. It counts only the days with viewing on
 * them as points, so a career watched on one day of the week says so in a
 * sentence rather than drawing six empty bars.
 */
export function WeekdayBars({ data, sentence }: { data: WeekdayPoint[]; sentence: string }) {
  return (
    <ChartFrame points={data.filter((day) => day.hours > 0).length} sentence={sentence} height="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip unit="h" />} cursor={{ fill: CHART_COLORS.cursorFill }} />
          <Bar dataKey="hours" name="Hours" fill={CHART_COLORS.primary} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
