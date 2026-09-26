'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './chart-frame';
import { AXIS_PROPS, CHART_COLORS } from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

export interface SharePoint {
  label: string;
  full: string;
  value: number;
  /** One more line in the tooltip: "3 Story Completes". */
  note?: string;
}

/**
 * Horizontal bars, one per category, in the order given — race-length bands
 * read shortest to longest, as a scale. Tall enough for every row, however
 * many there are.
 */
export function ShareBars({
  data, name, unit = '', sentence,
}: { data: SharePoint[]; name: string; unit?: string; sentence: string }) {
  const height = Math.max(160, data.length * 34 + 24);
  return (
    <ChartFrame points={data.length} sentence={sentence} height="">
      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={CHART_COLORS.grid} horizontal={false} />
            <XAxis type="number" {...AXIS_PROPS} />
            <YAxis type="category" dataKey="label" {...AXIS_PROPS} width={96} />
            <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: CHART_COLORS.cursorFill }} />
            <Bar dataKey="value" name={name} fill={CHART_COLORS.primary} radius={[0, 2, 2, 0]} barSize={16} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
