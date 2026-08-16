// The charts stylesheet must ride every lazy @mantine/charts chunk (the TeamKpiChart rule) —
// without it the tooltip renders unstyled and explodes into scattered fragments.
import { dynamicKey } from "../utils/i18nKey";
import "@mantine/charts/styles.css";
import { Select, Stack, Text } from "@mantine/core";
import { BarChart } from "@mantine/charts";
import { useTranslation } from "react-i18next";
import { isOneOf, useStoredState } from "../hooks/useStoredState";
import {
  CHART_METRICS,
  NOT_SET,
  buildCareerDistribution,
  type CareerChartMetric,
  type CareerPyramidRow,
} from "../utils/careerPyramid";

/**
 * The Team pyramid's distribution view (v2.16.0): a vertical bar chart of how many people
 * in the CURRENT filter selection hold each value of ONE chosen variable — career path,
 * specialization, seniority, or a tenure bucket — the manager's composition-balance check.
 * Lazy-loaded by CareerPyramid (the ReviewRatingDistribution precedent) so recharts stays
 * out of the main bundle.
 */
export default function CareerPyramidChart({ rows }: { rows: CareerPyramidRow[] }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useStoredState<CareerChartMetric>(
    "career.pyramid.chartMetric",
    "seniorityLevel",
    isOneOf(CHART_METRICS),
  );

  const series = [{ name: "count", label: t("career.pyramid.chartCount"), color: "lettuce.6" }];
  const isTenure = metric === "tenureAtLevel" || metric === "tenureInOrganization";
  const bars = buildCareerDistribution(rows, metric).map(({ key, count }) => ({
    value:
      key === NOT_SET
        ? t("career.pyramid.notSet")
        : isTenure
          ? t(dynamicKey(`career.pyramid.bucket.${key}`))
          : key,
    count,
  }));

  return (
    <Stack gap="xs">
      <Select
        label={t("career.pyramid.metricLabel")}
        data={CHART_METRICS.map((m) => ({ value: m, label: t(`career.pyramid.metric.${m}`) }))}
        value={metric}
        onChange={(v) => {
          if (v != null && isOneOf(CHART_METRICS)(v)) setMetric(v);
        }}
        allowDeselect={false}
        w={260}
      />
      {rows.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("career.pyramid.noMatches")}
        </Text>
      ) : (
        <BarChart
          h={300}
          data={bars}
          dataKey="value"
          series={series}
          withBarValueLabel
          yAxisProps={{ allowDecimals: false }}
        />
      )}
    </Stack>
  );
}
