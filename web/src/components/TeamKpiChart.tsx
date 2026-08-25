// The charts stylesheet rides every lazy @mantine/charts chunk (this one,
// ReviewRatingDistribution, and PulseTrendChart), so it stays out of the main bundle. Without it the tooltip
// renders unstyled — the color-swatch <svg> falls back to the 300x150 default and the card
// explodes into scattered fragments.
import "@mantine/charts/styles.css";
import { Alert, Stack, Text } from "@mantine/core";
import { ChartTooltip, LineChart } from "@mantine/charts";
// The repo's first direct recharts import (a declared peer of @mantine/charts, so it adds no
// dependency): Mantine's LineChart exposes reference LINES as a prop but reference AREAS only
// as recharts children.
import { ReferenceArea } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTeamKpiValues, type TeamKpiResponse } from "../api/teamkpis";
import { formatDate } from "../utils/datetime";
import { formatGoalValue, formatTargetValue } from "../utils/goalValues";
import { buildTeamKpiSeries, goodZoneBounds } from "../utils/teamKpiChart";
import { loadErrorMessage } from "../utils/saveError";

/**
 * The Graph tab: the KPI's collected data points over time (see buildTeamKpiSeries), with the
 * target as a dashed reference line. One series, one axis, the brand hue — the title names the
 * single series, so no legend. `@mantine/charts` is imported only from the lazy chart chunks
 * (this file, ReviewRatingDistribution, and PulseTrendChart); ViewTeamKpi lazy-loads it so recharts stays out of
 * the main bundle (the org-chart precedent).
 */
export default function TeamKpiChart({ kpi }: { kpi: TeamKpiResponse }) {
  const { t, i18n } = useTranslation();
  const { data: values, isError, error } = useQuery({
    queryKey: ["teamKpiValues", kpi.id],
    queryFn: () => listTeamKpiValues(kpi.id),
  });

  if (isError) {
    // A failed load must not masquerade as “no data yet” (v2.24.0).
    return (
      <Alert color="red" variant="light">
        {loadErrorMessage(error, t)}
      </Alert>
    );
  }

  if (!values) return null;
  const locale = i18n.language;
  const formatValue = (value: number) => formatGoalValue(kpi.type, value, locale);

  if (values.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        {t("teamKpi.graphEmpty")}
      </Text>
    );
  }

  const points = buildTeamKpiSeries(values);
  const series = [{ name: "value", label: t("teamKpi.current"), color: "lettuce.6" }];
  const formattedTarget = formatTargetValue(kpi.type, kpi.targetValue, kpi.targetDirection, locale);

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {t("teamKpi.graphHint", { target: formattedTarget })}
      </Text>
      <LineChart
        h={280}
        data={points}
        dataKey="ts"
        series={series}
        curveType="linear"
        withDots
        valueFormatter={formatValue}
        xAxisProps={{
          // Timestamps, not categories: scale the axis by time so uneven measurement gaps read
          // true.
          type: "number",
          domain: ["dataMin", "dataMax"],
          tickFormatter: (ts: number) => formatDate(ts, locale),
        }}
        tooltipProps={{
          // Recharts' numeric-x tooltip payload includes a row for the x dataKey itself ("ts"),
          // which Mantine's default tooltip renders as a ghost second series labeled with epoch
          // millis — filter it out and format the numeric label as a date instead.
          content: ({ label, payload }) => (
            <ChartTooltip
              label={typeof label === "number" ? formatDate(label, locale) : label}
              payload={(payload ?? []).filter((item) => item.dataKey !== "ts")}
              series={series}
              valueFormatter={formatValue}
            />
          ),
        }}
        referenceLines={[
          {
            y: kpi.targetValue,
            label: t("teamKpi.targetLine", { target: formattedTarget }),
            color: "gray.6",
            // Recharts drops a reference line outside the data-derived y-domain by default
            // ("discard") — extend the domain instead, so the target is always visible even when
            // every recorded value is far below/above it.
            ifOverflow: "extendDomain",
          },
        ]}
      >
        {/* The good-zone tint (v2.41.0): a transparent teal wash on the target's good side —
            above the line for AT_LEAST, below it for AT_MOST. The far bound sits well outside
            the domain and ifOverflow="hidden" clips it to the plot area, so the tint bleeds
            to the chart edge. Semantic success is teal (never brand green), theme-aware via
            the Mantine CSS var. */}
        <ReferenceArea
          {...goodZoneBounds(kpi.targetDirection, kpi.targetValue)}
          fill="var(--mantine-color-teal-6)"
          fillOpacity={0.08}
          stroke="none"
          ifOverflow="hidden"
        />
      </LineChart>
    </Stack>
  );
}
