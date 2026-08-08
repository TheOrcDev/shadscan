"use client";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import { XAxis } from "@/components/charts/x-axis";
import type { DownloadDay } from "@/lib/npm-stats";

/**
 * Both charts plot a single measure — downloads — so they use one hue rather
 * than a categorical palette. Colouring seven versions seven different ways
 * would encode nothing, since the bar height already carries the magnitude.
 *
 * Bklit defaults its series to `--chart-line-primary`, which this site maps to
 * `--chart-1` (`oklch(0.87 0 0)`) — near-white, and invisible on a light
 * surface. These steps were checked against both surfaces with the palette
 * validator and clear the 3:1 contrast floor in each.
 */
const SERIES_COLOR = "var(--stats-series)";

/**
 * The chart primitives default to a circular hover marker. This site's shadcn
 * preset (`radix-sera`) is squared everywhere, so the mark geometry is squared
 * here, at the call site, using the primitives' own props. The tooltip's own
 * chrome has no such props and is squared in `components/charts/tooltip`
 * instead.
 */
const SQUARE_TOOLTIP_MARKER = {
  dotRadiusFraction: 0,
  dotVariant: "ring",
} as const;

interface DailyDownloadsChartProps {
  data: DownloadDay[];
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const formatDay = (value: string): string =>
  DAY_LABEL_FORMAT.format(new Date(`${value}T00:00:00Z`));

function DailyDownloadsChart({ data }: DailyDownloadsChartProps) {
  const points = data.map((entry) => ({
    date: new Date(`${entry.day}T00:00:00Z`),
    downloads: entry.downloads,
  }));

  return (
    <AreaChart
      aspectRatio="3 / 1"
      data={points}
      margin={{ bottom: 32, left: 16, right: 16, top: 16 }}
      xDataKey="date"
    >
      <Grid />
      <XAxis />
      <Area dataKey="downloads" fill={SERIES_COLOR} stroke={SERIES_COLOR} />
      <ChartTooltip {...SQUARE_TOOLTIP_MARKER} />
    </AreaChart>
  );
}

export { DailyDownloadsChart, formatDay };
