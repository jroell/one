import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import type { UsageProviderKind } from "@t3tools/contracts";
import { T, useGT, useLocale, useMessages } from "gt-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatTokens,
  formatUsd,
} from "@t3tools/shared/usageFormat";
import { formatRelativeHourShort } from "@t3tools/shared/usageFormatCopy";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";
import { observeResize } from "~/lib/observeResize";
import { formatAxisUsd } from "./usageAxis";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 260;
const TICK_COUNT = 4;
const PLOT_TOP = 8;
const NONE_LOADING: ReadonlySet<UsageProviderKind> = new Set();

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders?: ReadonlySet<UsageProviderKind>;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  readonly hour12: boolean;
}

export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return 0;
  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

function monotoneTangents(points: readonly Point[]): readonly number[] {
  const count = points.length;
  if (count < 2) return [0];

  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = (points[index + 1]?.x ?? 0) - (points[index]?.x ?? 0);
    const dy = (points[index + 1]?.y ?? 0) - (points[index]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }

  return tangents;
}

interface CurveSegment {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

function smoothCurve(points: readonly Point[]): readonly CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[index] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[index + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

function curvePath(segments: readonly CurveSegment[]): string {
  const first = segments[0];
  if (first === undefined) return "";
  let path = `M${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`;
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`;
  }
  return path;
}

const point = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/** The band between a stacked series' top curve and the curve of the series below it. */
function areaBetween(top: readonly CurveSegment[], lower: readonly CurveSegment[] | null): string {
  const first = top[0];
  const last = top[top.length - 1];
  if (first === undefined || last === undefined) return "";
  let path = `M${point(first.from)}`;
  for (const segment of top)
    path += ` C${point(segment.c1)} ${point(segment.c2)} ${point(segment.to)}`;
  const lowerLast = lower?.[lower.length - 1];
  if (lower === null || lowerLast === undefined) {
    return `${path} L${last.to.x.toFixed(2)},${VIEW_HEIGHT} L${first.from.x.toFixed(2)},${VIEW_HEIGHT} Z`;
  }
  path += ` L${point(lowerLast.to)}`;
  for (const segment of lower.toReversed()) {
    path += ` C${point(segment.c2)} ${point(segment.c1)} ${point(segment.from)}`;
  }
  return `${path} Z`;
}

function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

const PLACEHOLDER_TICKS = Array.from({ length: TICK_COUNT + 1 }, (_, index) => index);

function chartScale(
  columns: readonly DayColumn[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
) {
  // Series are stacked, so the tallest column is the sum of its bands.
  const peak = columns.reduce((max, column) => Math.max(max, column.total), 0);
  return peak === 0 && loadingProviders.size > 0
    ? { max: TICK_COUNT, ticks: PLACEHOLDER_TICKS, labeled: false }
    : { ...niceScale(peak, TICK_COUNT), labeled: true };
}

function valueToY(value: number, max: number) {
  return max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (value / max) * (VIEW_HEIGHT - PLOT_TOP);
}

/** Providers under this share of the window's total fold into one "Others" band. */
const MINOR_PROVIDER_SHARE = 0.01;
const OTHERS_COLOR = "color-mix(in oklab, var(--contrast-foreground) 45%, var(--background))";

export interface ChartSeries {
  readonly key: string;
  /** The provider this band is, or `null` for the folded "Others" band. */
  readonly provider: UsageProviderKind | null;
  readonly providers: readonly UsageProviderKind[];
  readonly color: string;
  readonly loading: boolean;
  readonly total: number;
}

function bandValue(column: DayColumn, provider: UsageProviderKind) {
  return column.bands[PROVIDER_ORDER.indexOf(provider)]?.value ?? 0;
}

/**
 * The bands of the stacked chart, biggest first. Providers with under 1% of the total fold into
 * one "Others" band on top, but only when at least two do: a lone minor provider keeps its name.
 */
export function chartSeries(
  providers: readonly UsageProviderKind[],
  columns: readonly DayColumn[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
): readonly ChartSeries[] {
  const totalOf = (provider: UsageProviderKind) =>
    columns.reduce((sum, column) => sum + bandValue(column, provider), 0);
  const entries = providers.map((provider) => ({ provider, total: totalOf(provider) }));
  const grand = entries.reduce((sum, entry) => sum + entry.total, 0);
  const minor = entries.filter(
    (entry) => entry.total > 0 && grand > 0 && entry.total / grand < MINOR_PROVIDER_SHARE,
  );
  const fold = minor.length >= 2;
  const single = (entry: (typeof entries)[number]): ChartSeries => ({
    key: entry.provider,
    provider: entry.provider,
    providers: [entry.provider],
    color: PROVIDER_PRESENTATION[entry.provider].color,
    loading: loadingProviders.has(entry.provider),
    total: entry.total,
  });
  const major = entries
    .filter((entry) => !fold || !minor.includes(entry))
    .toSorted((left, right) => right.total - left.total)
    .map(single);
  return fold
    ? [
        ...major,
        {
          key: "others",
          provider: null,
          providers: minor.map((entry) => entry.provider),
          color: OTHERS_COLOR,
          loading: minor.some((entry) => loadingProviders.has(entry.provider)),
          total: minor.reduce((sum, entry) => sum + entry.total, 0),
        },
      ]
    : major;
}

function seriesValue(series: ChartSeries, column: DayColumn | undefined) {
  return column === undefined
    ? 0
    : series.providers.reduce((sum, provider) => sum + bandValue(column, provider), 0);
}

export interface BarSegment {
  readonly key: string;
  readonly color: string;
  /** Percent of the plot's height. */
  readonly heightPercent: number;
  /** The highest segment of the day, which carries the rounded top. */
  readonly top: boolean;
}

/** The stacked segments of one day's bar, bottom first. Series with nothing that day are left out. */
export function barSegments(
  column: DayColumn,
  series: readonly ChartSeries[],
  max: number,
): readonly BarSegment[] {
  if (max <= 0) return [];
  const plotShare = (VIEW_HEIGHT - PLOT_TOP) / VIEW_HEIGHT;
  const present = series.flatMap((band) => {
    const value = seriesValue(band, column);
    return value > 0 ? [{ band, value }] : [];
  });
  return present.map(({ band, value }, index) => ({
    key: band.key,
    color: band.color,
    heightPercent: (value / max) * plotShare * 100,
    top: index === present.length - 1,
  }));
}

function buildChart(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
  providers: readonly UsageProviderKind[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
) {
  const columns = buildPeriodColumns(periods, byPeriod, metric);
  const scale = chartScale(columns, loadingProviders);
  const stepX = periods.length < 2 ? 0 : VIEW_WIDTH / (periods.length - 1);
  let lower: readonly CurveSegment[] | null = null;
  let stacked = columns.map(() => 0);
  const series = chartSeries(providers, columns, loadingProviders).map((band) => {
    stacked = stacked.map((height, index) => height + seriesValue(band, columns[index]));
    const top = smoothCurve(
      stacked.map((height, index) => ({
        x: index * stepX,
        y: valueToY(height, scale.max),
      })),
    );
    const drawn = { ...band, line: curvePath(top), area: areaBetween(top, lower) };
    lower = top;
    return drawn;
  });

  return { columns, scale, stepX, series };
}

function seriesName(band: ChartSeries, gt: ReturnType<typeof useGT>): string {
  return band.provider === null ? gt("Others") : PROVIDER_PRESENTATION[band.provider].label;
}

function UsageChartTooltip({
  tooltipRef,
  label,
  column,
  series,
  format,
}: {
  readonly tooltipRef: React.Ref<HTMLDivElement>;
  readonly label: string;
  readonly column: DayColumn | undefined;
  readonly series: readonly ChartSeries[];
  readonly format: (value: number) => string;
}) {
  const gt = useGT();
  return (
    <div
      ref={tooltipRef}
      className="usage-tooltip m-floating pointer-events-none absolute z-10 min-w-36 max-w-full text-xs"
      style={{
        left: "var(--usage-tooltip-left, 0px)",
        top: "var(--usage-tooltip-top, 0px)",
      }}
    >
      <div className="mb-1 text-muted-foreground">{label}</div>
      {series
        .filter((band) => seriesValue(band, column) > 0)
        .map((band) => {
          const presentation = band.provider === null ? null : PROVIDER_PRESENTATION[band.provider];
          const bandLabel = presentation === null ? gt("Others") : presentation.label;
          return (
            <div key={band.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden
                  className="usage-tooltip-swatch"
                  style={{ background: band.color }}
                />
                {presentation === null ? null : (
                  <ProviderInstanceIcon
                    driverKind={presentation.driverKind}
                    displayName={bandLabel}
                    iconClassName="size-3"
                  />
                )}
                {bandLabel}
              </span>
              <span className="text-foreground tabular-nums">
                {format(seriesValue(band, column))}
              </span>
            </div>
          );
        })}
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
        <span className="text-muted-foreground">
          <T>Total</T>
        </span>
        <span className="text-foreground tabular-nums">{format(column?.total ?? 0)}</span>
      </div>
    </div>
  );
}

function UsageChartPlot({
  periods,
  columns,
  stepX,
  series,
  format,
  formatTooltipPeriod,
  label,
  unit,
  bars,
  children,
}: {
  readonly periods: readonly string[];
  readonly columns: readonly DayColumn[];
  readonly stepX: number;
  readonly series: readonly ChartSeries[];
  readonly format: (value: number) => string;
  readonly formatTooltipPeriod: (period: string) => string;
  /** The chart's name for assistive tech; the plot takes the arrow keys. */
  readonly label: string;
  /** What one step of the arrow keys moves by. */
  readonly unit: "day" | "hour";
  /** Daily bars instead of an area plot: the bars' segments, one array per day. */
  readonly bars?:
    | {
        readonly segments: readonly (readonly BarSegment[])[];
        readonly gridlines: readonly number[];
      }
    | undefined;
  readonly children?: React.ReactNode;
}) {
  const gt = useGT();
  const locale = useLocale();
  // The selection is the period and where it came from. Pointer coordinates live in a ref, so moving
  // inside one period neither renders nor re-attaches observers; the keyboard's period has no
  // coordinates and is placed from the plot's current size each time. The keyboard's day is also
  // kept as an anchor: the pointer leaving the plot hands the tooltip back to it.
  const [selected, setSelected] = useState<{
    readonly index: number;
    readonly by: "pointer" | "key";
  } | null>(null);
  const [keyIndex, setKeyIndex] = useState<number | null>(null);
  const hoverIndex = selected?.index ?? null;
  const isOpen = selected !== null;
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectedRef = useRef(selected);
  const frameRef = useRef(0);

  const slotPosition = (index: number) => {
    const plot = plotRef.current;
    if (plot === null) return null;
    const last = periods.length - 1;
    const slot =
      bars === undefined ? (last === 0 ? 0 : index / last) : (index + 0.5) / periods.length;
    return { x: slot * plot.clientWidth, y: plot.clientHeight * 0.2 };
  };

  const positionTooltip = () => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const current = selectedRef.current;
    if (plot === null || tooltip === null || current === null) return;
    const anchor = current.by === "key" ? slotPosition(current.index) : pointerRef.current;
    if (anchor === null) return;

    const gap = 12;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const plotWidth = plot.clientWidth;
    const plotHeight = plot.clientHeight;
    const preferredLeft =
      anchor.x + gap + tooltipWidth <= plotWidth ? anchor.x + gap : anchor.x - gap - tooltipWidth;
    const preferredTop =
      anchor.y + gap + tooltipHeight <= plotHeight
        ? anchor.y + gap
        : anchor.y - gap - tooltipHeight;
    const left = Math.min(Math.max(0, preferredLeft), Math.max(0, plotWidth - tooltipWidth));
    const top = Math.min(Math.max(0, preferredTop), Math.max(0, plotHeight - tooltipHeight));
    plot.style.setProperty("--usage-tooltip-left", `${left}px`);
    plot.style.setProperty("--usage-tooltip-top", `${top}px`);
  };
  // Observers and frames call the latest closure, which sees the current periods and bars.
  const positionRef = useRef(positionTooltip);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- positions the hover tooltip through plot CSS variables before paint
  useLayoutEffect(() => {
    positionRef.current = positionTooltip;
    selectedRef.current = selected;
    if (selected !== null) positionTooltip();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-places the tooltip when the plot or the tooltip changes size
  useLayoutEffect(() => {
    if (!isOpen) return;
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    if (plot === null || tooltip === null) return;
    return observeResize([plot, tooltip], () => positionRef.current());
  }, [isOpen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancels a pending pointer frame when the chart unmounts
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const plot = plotRef.current;
    if (plot === null || periods.length === 0) return;
    const bounds = plot.getBoundingClientRect();
    if (bounds.width === 0) return;
    const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
    const localY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
    const fraction = localX / bounds.width;
    const index =
      bars === undefined
        ? Math.round(fraction * (periods.length - 1))
        : Math.floor(fraction * periods.length);
    pointerRef.current = { x: localX, y: localY };
    const period = Math.min(periods.length - 1, Math.max(0, index));
    setSelected((current) =>
      current?.index === period && current.by === "pointer"
        ? current
        : { index: period, by: "pointer" },
    );
    if (frameRef.current === 0) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        positionRef.current();
      });
    }
  };

  /**
   * Arrow keys walk the periods, Home and End jump to the ends. Escape dismisses the tooltip and the
   * keyboard's day together; a pointer parked over the plot brings nothing back until it moves.
   */
  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (periods.length === 0) return;
    if (event.key === "Escape") {
      // A press that closes the tooltip is spent; the next one reaches the dialog around the page.
      if (selected !== null || keyIndex !== null) event.stopPropagation();
      setSelected(null);
      setKeyIndex(null);
      return;
    }
    const last = periods.length - 1;
    const current = keyIndex ?? (event.key === "ArrowLeft" ? last + 1 : -1);
    const next =
      event.key === "ArrowRight"
        ? Math.min(last, current + 1)
        : event.key === "ArrowLeft"
          ? Math.max(0, current - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected({ index: next, by: "key" });
    setKeyIndex(next);
  };

  const listFormat = new Intl.ListFormat(locale, { style: "short", type: "unit" });
  const keyPeriod = keyIndex === null ? undefined : periods[keyIndex];
  const announcement =
    keyPeriod === undefined || keyIndex === null
      ? ""
      : gt("{period}: {values}. Total {total}", {
          period: formatTooltipPeriod(keyPeriod),
          values: listFormat.format(
            series
              .filter((band) => seriesValue(band, columns[keyIndex]) > 0)
              .map(
                (band) => `${seriesName(band, gt)} ${format(seriesValue(band, columns[keyIndex]))}`,
              ),
          ),
          total: format(columns[keyIndex]?.total ?? 0),
        });

  const hoveredPeriod = hoverIndex === null ? undefined : periods[hoverIndex];

  return (
    <div
      ref={plotRef}
      role="group"
      aria-label={label}
      aria-description={
        unit === "hour"
          ? gt("Use the left and right arrow keys to move between hours")
          : gt("Use the left and right arrow keys to move between days")
      }
      tabIndex={0}
      className="usage-plot relative min-h-56 flex-1"
      onMouseMove={handleMove}
      onMouseLeave={() => {
        setSelected((current) =>
          current?.by === "pointer"
            ? keyIndex === null
              ? null
              : { index: keyIndex, by: "key" as const }
            : current,
        );
      }}
      onKeyDown={handleKey}
      onBlur={() => {
        setKeyIndex(null);
        setSelected((current) => (current?.by === "key" ? null : current));
      }}
    >
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {bars === undefined ? (
        <svg
          className="h-full w-full"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {children}
          {hoverIndex === null ? null : (
            <line
              x1={hoverIndex * stepX}
              x2={hoverIndex * stepX}
              y1={PLOT_TOP}
              y2={VIEW_HEIGHT}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 3"
              className="text-muted-foreground"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      ) : (
        <div aria-hidden className="usage-bars">
          {bars.gridlines.map((top) => (
            <span
              key={top}
              className="usage-bars-gridline"
              data-base={top >= 100 ? "" : undefined}
              style={{ top: `${top}%` }}
            />
          ))}
          <div
            className="usage-bars-days"
            style={{ gridTemplateColumns: `repeat(${periods.length}, minmax(0, 1fr))` }}
          >
            {periods.map((period, index) => (
              <span
                key={period}
                className="usage-bars-day"
                data-hover={hoverIndex === index ? "" : undefined}
                style={
                  {
                    "--usage-stack": `${(bars.segments[index] ?? []).reduce((sum, segment) => sum + segment.heightPercent, 0)}%`,
                  } as React.CSSProperties
                }
              >
                {(bars.segments[index] ?? []).map((segment) => (
                  <span
                    key={segment.key}
                    className="usage-bars-segment"
                    data-top={segment.top ? "" : undefined}
                    style={{
                      height: `${segment.heightPercent}%`,
                      backgroundColor: segment.color,
                    }}
                  />
                ))}
              </span>
            ))}
          </div>
        </div>
      )}

      {hoverIndex === null || hoveredPeriod === undefined ? null : (
        <UsageChartTooltip
          tooltipRef={tooltipRef}
          label={formatTooltipPeriod(hoveredPeriod)}
          column={columns[hoverIndex]}
          series={series}
          format={format}
        />
      )}
    </div>
  );
}

export function UsageProviderChart({
  providers,
  loadingProviders = NONE_LOADING,
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
  hour12,
}: UsageProviderChartProps) {
  const gt = useGT();
  const locale = useLocale();
  const m = useMessages();
  const periods = resolution === "hour" ? hours : days;
  const totals: readonly (DailyTotals | HourlyTotals)[] = resolution === "hour" ? hourly : daily;
  const byPeriod = new Map(
    totals.map((entry) => ["hourStart" in entry ? entry.hourStart : entry.day, entry]),
  );
  const { columns, scale, series, stepX } = buildChart(
    periods,
    byPeriod,
    metric,
    providers,
    loadingProviders,
  );

  const toY = (value: number) => valueToY(value, scale.max);
  const format = metric === "tokens" ? formatTokens : (value: number) => formatUsd(value, locale);
  const axisFormat =
    metric === "tokens" ? formatTokens : (value: number) => formatAxisUsd(value, locale);
  const chartLabel =
    resolution === "hour"
      ? metric === "tokens"
        ? gt("Hourly processed tokens by provider")
        : gt("Hourly cost by provider")
      : metric === "tokens"
        ? gt("Daily processed tokens by provider")
        : gt("Daily cost by provider");
  // 30 discrete days read as stacked bars; only the 24 hours stay a continuous area.
  const bars =
    resolution === "day"
      ? {
          segments: columns.map((column) => barSegments(column, series, scale.max)),
          gridlines: scale.ticks.map((tick) => (toY(tick) / VIEW_HEIGHT) * 100),
        }
      : undefined;
  const formatPeriod = (period: string) =>
    resolution === "hour"
      ? formatHourShort(period, timeZone, hour12, locale)
      : formatDayShort(period, locale);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? formatRelativeHourShort(period, referenceTime, timeZone, hour12, m, locale)
      : formatPeriod(period);

  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex flex-1 gap-2">
        <div aria-hidden className="relative min-h-56 w-14 shrink-0">
          {scale.labeled
            ? scale.ticks.map((tick) => (
                <span
                  key={tick}
                  className="usage-axis-label absolute right-0 -translate-y-1/2 text-3xs tabular-nums"
                  style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
                >
                  {tick === 0 ? "0" : axisFormat(tick)}
                </span>
              ))
            : null}
        </div>

        <UsageChartPlot
          periods={periods}
          columns={columns}
          stepX={stepX}
          series={series}
          format={format}
          formatTooltipPeriod={formatTooltipPeriod}
          label={chartLabel}
          unit={resolution === "hour" ? "hour" : "day"}
          bars={bars}
        >
          {scale.ticks.map((tick) => {
            const y = toY(tick);
            return (
              <line
                key={tick}
                x1={0}
                x2={VIEW_WIDTH}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : "1 5"}
                strokeLinecap="round"
                className="usage-gridline"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {series.map(({ key, color, area }) => (
            <path key={key} d={area} fill={color} fillOpacity={0.5} />
          ))}
          {series.map(({ key, color, line }) => (
            <path
              key={key}
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </UsageChartPlot>
      </div>

      <div aria-hidden className="usage-axis-label flex justify-between pl-16 text-3xs uppercase">
        <span>{periods[0] === undefined ? "" : formatPeriod(periods[0])}</span>
        <span>
          {periods[Math.floor(periods.length / 2)] === undefined
            ? ""
            : formatPeriod(periods[Math.floor(periods.length / 2)] ?? "")}
        </span>
        <span>
          {periods[periods.length - 1] === undefined
            ? ""
            : formatPeriod(periods[periods.length - 1] ?? "")}
        </span>
      </div>

      {/* The plot and its axes are hover-only; this carries the same figures for screen readers.
          sr-only sits on a wrapper: Firefox does not clip a table's caption by the table's own box. */}
      <div className="sr-only">
        <table>
          <caption>{chartLabel}</caption>
          <thead>
            <tr>
              <th scope="col">{resolution === "hour" ? gt("Hour") : gt("Day")}</th>
              {providers.map((provider) => (
                <th key={provider} scope="col">
                  {PROVIDER_PRESENTATION[provider].label}
                </th>
              ))}
              {providers.length > 1 ? (
                <th scope="col">
                  <T>Total</T>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => {
              const column = columns[index];
              return (
                <tr key={period}>
                  <th scope="row">{formatTooltipPeriod(period)}</th>
                  {providers.map((provider) => (
                    <td key={provider}>
                      {format(column?.bands.find((band) => band.provider === provider)?.value ?? 0)}
                    </td>
                  ))}
                  {providers.length > 1 ? <td>{format(column?.total ?? 0)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
