'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Text, Tooltip, XAxis, YAxis } from 'recharts';
import type { XAxisTickContentProps } from 'recharts';
import { ChartFrame } from './chart-frame';
import { AXIS_PROPS, CHART_COLORS } from './chart-theme';
import { ChartTooltip } from './chart-tooltip';

export interface BarSeries<T> {
  key: keyof T & string;
  name: string;
  color: string;
}

/**
 * Small dots under a period's label, one for each of something that happened
 * in it (the Chronicle's Story Completes by month). They are drawn by the
 * axis itself, so each sits exactly under its own period's bars whatever the
 * chart's width or the Y axis's.
 */
export interface BarMarks<T> {
  count: (datum: T) => number;
  /** The period's marks in words, shown on hover: "March 2026: 2 complete". */
  title: (datum: T, count: number) => string;
}

/** Marks drawn under one label at most, in rows of `MARKS_PER_ROW`. */
export const MAX_MARKS = 6;
const MARKS_PER_ROW = 3;
const MARK_RADIUS = 2.5;
const MARK_PITCH = 6.5;
/** From the top of the label to the first row of marks, and between rows. */
const MARK_OFFSET = 16;
const MARK_ROW_GAP = 6.5;
/** The axis is taller with marks, so the second row never meets the chart's edge. */
const MARKED_AXIS_HEIGHT = 40;

/**
 * One X-axis tick: the label as the axis draws it, and the period's marks
 * centred under it. Exported for its test.
 */
export function MarkedTick<T extends { label: string }>({
  x, y, fill, payload, data, marks,
}: Pick<XAxisTickContentProps, 'x' | 'y' | 'fill' | 'payload'> & { data: readonly T[]; marks: BarMarks<T> }) {
  const label = String(payload.value);
  const datum = data.find((row) => row.label === label);
  const count = datum === undefined ? 0 : Math.max(0, Math.floor(marks.count(datum)));
  const shown = Math.min(count, MAX_MARKS);
  const cx = Number(x);
  const top = Number(y);

  return (
    <g>
      <Text
        x={x}
        y={y}
        textAnchor="middle"
        verticalAnchor="start"
        fill={fill}
        fontSize={AXIS_PROPS.fontSize}
        className="recharts-cartesian-axis-tick-value"
      >
        {label}
      </Text>
      {datum !== undefined && shown > 0 ? (
        <g className="chart-marks">
          <title>{marks.title(datum, count)}</title>
          {Array.from({ length: shown }, (_, index) => {
            const row = Math.floor(index / MARKS_PER_ROW);
            const inRow = Math.min(MARKS_PER_ROW, shown - row * MARKS_PER_ROW);
            const column = index % MARKS_PER_ROW;
            return (
              <circle
                key={index}
                cx={cx + (column - (inRow - 1) / 2) * MARK_PITCH}
                cy={top + MARK_OFFSET + row * MARK_ROW_GAP}
                r={MARK_RADIUS}
                fill={CHART_COLORS.primary}
              />
            );
          })}
        </g>
      ) : null}
    </g>
  );
}

/**
 * Bars over time — months, or years — one or more series side by side. Quiet
 * periods stay in the series as empty slots, so a gap reads as a quiet month,
 * not as a missing one. With `marks`, every period keeps its label (none is
 * skipped for room) and carries its dots under it.
 */
export function PeriodBars<T extends { label: string; full: string }>({
  data, series, unit = '', sentence, points = data.length, format, allowDecimals = true, marks,
}: {
  data: T[];
  series: BarSeries<T>[];
  unit?: string;
  /** Said instead of the chart below the minimum number of points. */
  sentence: string;
  points?: number;
  format?: (value: number) => string;
  allowDecimals?: boolean;
  marks?: BarMarks<T>;
}) {
  return (
    <ChartFrame points={points} sentence={sentence}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          {marks ? (
            <XAxis
              dataKey="label"
              {...AXIS_PROPS}
              interval={0}
              height={MARKED_AXIS_HEIGHT}
              tick={(props: XAxisTickContentProps) => <MarkedTick {...props} data={data} marks={marks} />}
            />
          ) : (
            <XAxis dataKey="label" {...AXIS_PROPS} />
          )}
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
