"use client";

import { Area, AreaChart } from "@/components/charts/area-chart";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip } from "@/components/charts/tooltip";
import { XAxis } from "@/components/charts/x-axis";
import type { DownloadDay, VersionDownloads } from "@/lib/npm-stats";

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

interface DailyDownloadsChartProps {
  data: DownloadDay[];
}

interface VersionDownloadsChartProps {
  data: VersionDownloads[];
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
      <ChartTooltip />
    </AreaChart>
  );
}

function VersionDownloadsChart({ data }: VersionDownloadsChartProps) {
  const points = data.map((entry) => ({
    downloads: entry.downloads,
    name: entry.version,
  }));

  return (
    <BarChart
      aspectRatio="3 / 1"
      data={points}
      margin={{ bottom: 32, left: 16, right: 16, top: 16 }}
      xDataKey="name"
    >
      <Grid />
      <BarXAxis />
      <Bar dataKey="downloads" fill={SERIES_COLOR} />
      <ChartTooltip />
    </BarChart>
  );
}

export { DailyDownloadsChart, formatDay, VersionDownloadsChart };
