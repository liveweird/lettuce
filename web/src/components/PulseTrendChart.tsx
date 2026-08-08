import "@mantine/charts/styles.css";
import { ChartTooltip, LineChart } from "@mantine/charts";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/datetime";

export interface PulseTrendChartPoint {
  closedAt: number;
  enps: number;
  n: number;
}

/**
 * The per-team eNPS trend across closed cycles. A lazy chunk (recharts must never enter the
 * main bundle — the TeamKpiChart rule; the styles.css import must ride this chunk). The
 * response count rides the tooltip so no number ever shows without its n.
 */
export default function PulseTrendChart({ points }: { points: PulseTrendChartPoint[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const series = [{ name: "enps", label: t("pulse.results.enps"), color: "lettuce.6" }];
  return (
    <LineChart
      h={200}
      data={points}
      dataKey="closedAt"
      series={series}
      curveType="linear"
      withDots
      yAxisProps={{ domain: [-100, 100], allowDecimals: false }}
      xAxisProps={{
        type: "number",
        domain: ["dataMin", "dataMax"],
        tickFormatter: (ts: number) => formatDate(ts, locale),
      }}
      tooltipProps={{
        content: ({ label, payload }) => {
          // Numeric-x tooltips include a ghost row for the x dataKey — filter it out (the
          // TeamKpiChart gotcha) and append the point's n to the label.
          const point = payload?.[0]?.payload as PulseTrendChartPoint | undefined;
          const heading =
            typeof label === "number"
              ? `${formatDate(label, locale)} (n=${point?.n ?? "?"})`
              : label;
          return (
            <ChartTooltip
              label={heading}
              payload={(payload ?? []).filter((item) => item.dataKey !== "closedAt" && item.dataKey !== "n")}
              series={series}
            />
          );
        },
      }}
    />
  );
}
