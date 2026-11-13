import { useRef, useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { haptic } from '@/platform/haptics';

import { useTheme } from './theme';

export interface Series {
  values: readonly number[];
  color: string;
  dashed?: boolean;
  /** Shade the area under the line. */
  fill?: boolean;
  /** Draw only the first N points, e.g. up to today. */
  upTo?: number;
}

function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))];
}

/**
 * Line chart for a handful of series that share one scale. `label` is read out
 * by screen readers in place of the picture.
 *
 * With `onScrub`, dragging a finger sideways across the chart picks a point:
 * the chart marks it and reports its index, and reports null when the finger
 * lifts. A drag that starts up or down is left to the page, so the chart never
 * gets in the way of scrolling.
 */
export function LineChart({
  series,
  height = 140,
  label,
  zeroLine = false,
  marker,
  onScrub,
}: {
  series: Series[];
  height?: number;
  label: string;
  zeroLine?: boolean;
  /** Highlight one point: the index along the x axis and the series to sit on. */
  marker?: { index: number; series: number };
  onScrub?: (index: number | null) => void;
}) {
  const { c } = useTheme();
  const [width, onLayout] = useWidth();
  const [scrub, setScrub] = useState<number | null>(null);
  const touch = useRef({ x: 0, y: 0 });
  const pad = 6;
  const all = series.flatMap((item) => item.values.slice(0, item.upTo ?? item.values.length));
  const length = Math.max(1, ...series.map((item) => item.values.length));
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (!zeroLine && all.length > 0) {
    min = Math.min(...all);
    max = Math.max(...all);
  }
  if (max === min) max = min + 1;
  const x = (index: number) => pad + (length <= 1 ? 0 : (index / (length - 1)) * (width - pad * 2));
  const y = (value: number) => pad + (1 - (value - min) / (max - min)) * (height - pad * 2);

  const pathFor = (values: readonly number[], upTo: number) =>
    values
      .slice(0, upTo)
      .map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`)
      .join(' ');

  const pick = (event: GestureResponderEvent) => {
    if (width <= pad * 2 || length <= 1) return;
    const along = (event.nativeEvent.locationX - pad) / (width - pad * 2);
    const next = Math.max(0, Math.min(length - 1, Math.round(along * (length - 1))));
    if (next === scrub) return;
    haptic.select();
    setScrub(next);
    onScrub?.(next);
  };
  const release = () => {
    setScrub(null);
    onScrub?.(null);
  };
  const scrubbing = onScrub
    ? {
        // Remember where the finger went down, but do not claim it yet: it may be the start of a scroll.
        onStartShouldSetResponder: (event: GestureResponderEvent) => {
          touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
          return false;
        },
        onMoveShouldSetResponder: (event: GestureResponderEvent) => {
          const dx = Math.abs(event.nativeEvent.pageX - touch.current.x);
          const dy = Math.abs(event.nativeEvent.pageY - touch.current.y);
          return dx > 4 && dx > dy;
        },
        onResponderGrant: pick,
        onResponderMove: pick,
        onResponderRelease: release,
        onResponderTerminate: release,
        onResponderTerminationRequest: () => false,
      }
    : {};

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={onLayout} style={{ height }} {...scrubbing}>
      {width > 0 ? (
        // Touches go to the view around the picture, so positions are always measured from the chart's edge.
        <Svg width={width} height={height} pointerEvents="none">
          <Defs>
            {series.map((item, index) => (
              <LinearGradient key={index} id={`fill${index}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={item.color} stopOpacity={0.28} />
                <Stop offset="1" stopColor={item.color} stopOpacity={0} />
              </LinearGradient>
            ))}
          </Defs>
          {zeroLine && min < 0 ? <Line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke={c.negative} strokeWidth={1} strokeDasharray="3 4" /> : null}
          {series.map((item, index) => {
            const upTo = item.upTo ?? item.values.length;
            if (upTo < 1) return null;
            const line = pathFor(item.values, upTo);
            const base = y(Math.max(min, Math.min(max, 0)));
            return (
              <G key={index}>
                {item.fill && upTo > 1 ? (
                  <Path d={`${line} L${x(upTo - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`} fill={`url(#fill${index})`} />
                ) : null}
                <Path
                  d={line}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.dashed ? 1.5 : 2.5}
                  strokeDasharray={item.dashed ? '4 5' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </G>
            );
          })}
          {scrub !== null ? (
            <G>
              <Line x1={x(scrub)} x2={x(scrub)} y1={0} y2={height} stroke={c.textFaint} strokeWidth={1} />
              {series.map((item, index) =>
                !item.dashed && scrub < (item.upTo ?? item.values.length) && item.values[scrub] !== undefined ? (
                  <Circle key={index} cx={x(scrub)} cy={y(item.values[scrub])} r={5} fill={item.color} stroke={c.surface} strokeWidth={2} />
                ) : null,
              )}
            </G>
          ) : null}
          {scrub === null && marker && series[marker.series]?.values[marker.index] !== undefined ? (
            <Circle
              cx={x(marker.index)}
              cy={y(series[marker.series].values[marker.index])}
              r={5}
              fill={series[marker.series].color}
              stroke={c.surface}
              strokeWidth={2}
            />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

export interface BarGroup {
  label: string;
  values: { value: number; color: string }[];
}

/** Grouped vertical bars, e.g. income next to spending for each month. */
export function BarChart({ groups, height = 150, label }: { groups: BarGroup[]; height?: number; label: string }) {
  const { c } = useTheme();
  const [width, onLayout] = useWidth();
  const max = Math.max(1, ...groups.flatMap((group) => group.values.map((item) => item.value)));
  const slot = groups.length > 0 ? width / groups.length : 0;
  const perGroup = Math.max(1, ...groups.map((group) => group.values.length));
  const barWidth = Math.max(4, Math.min(18, (slot * 0.62) / perGroup));
  const gap = 3;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={onLayout} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={c.border} strokeWidth={1} />
          {groups.map((group, groupIndex) => {
            const total = group.values.length * barWidth + (group.values.length - 1) * gap;
            const start = groupIndex * slot + (slot - total) / 2;
            return group.values.map((item, index) => {
              const barHeight = Math.max(item.value > 0 ? 2 : 0, (Math.max(0, item.value) / max) * (height - 8));
              return (
                <Rect
                  key={`${groupIndex}-${index}`}
                  x={start + index * (barWidth + gap)}
                  y={height - barHeight}
                  width={barWidth}
                  height={barHeight}
                  rx={3}
                  fill={item.color}
                />
              );
            });
          })}
        </Svg>
      ) : null}
    </View>
  );
}

/** Circular progress, 0..1. */
export function Ring({ fraction, size = 56, stroke = 6, color }: { fraction: number; size?: number; stroke?: number; color: string }) {
  const { c } = useTheme();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surfaceAlt} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
