import { Stack, Text } from "@mantine/core";
import { LineChart } from "@mantine/charts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listTeamKpiEvents, type TeamKpiResponse } from "../api/client";
import { formatDate } from "../utils/datetime";
import { formatGoalValue } from "../utils/goalValues";
import { buildTeamKpiSeries } from "../utils/teamKpiChart";

/**
 * The Graph tab: the KPI's current value over time, derived from its PROGRESS_UPDATED audit
 * events (see buildTeamKpiSeries), with the target as a dashed reference line. One series, one
 * axis, the brand hue — the title names the single series, so no legend. This is the only file
 * importing `@mantine/charts`; ViewTeamKpi lazy-loads it so recharts stays out of the main
 * bundle (the org-chart precedent).
 */
export default function TeamKpiChart({ kpi }: { kpi: TeamKpiResponse }) {
  const { t, i18n } = useTranslation();
  const { data: events } = useQuery({
    queryKey: ["teamKpiEvents", kpi.id],
    queryFn: () => listTeamKpiEvents(kpi.id),
  });

  if (!events) return null;
  const points = buildTeamKpiSeries(kpi, events);
  const locale = i18n.language;
  const formatValue = (value: number) => formatGoalValue(kpi.type, value, locale);

  // A single synthesized origin means no progress was ever recorded — a line needs two points.
  if (points.length < 2) {
    return (
      <Text c="dimmed" size="sm">
        {t("teamKpi.graphEmpty")}
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {t("teamKpi.graphHint", { target: formatValue(kpi.targetValue) })}
      </Text>
      <LineChart
        h={280}
        data={points}
        dataKey="ts"
        series={[{ name: "value", label: t("teamKpi.current"), color: "lettuce.6" }]}
        curveType="linear"
        withDots
        valueFormatter={formatValue}
        xAxisProps={{
          // Timestamps, not categories: scale the axis by time so uneven update gaps read true.
          type: "number",
          domain: ["dataMin", "dataMax"],
          tickFormatter: (ts: number) => formatDate(ts, locale),
        }}
        referenceLines={[
          {
            y: kpi.targetValue,
            label: t("teamKpi.targetLine", { target: formatValue(kpi.targetValue) }),
            color: "gray.6",
          },
        ]}
      />
    </Stack>
  );
}
