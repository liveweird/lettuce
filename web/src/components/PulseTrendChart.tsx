import "@mantine/charts/styles.css";
import { ChartTooltip, LineChart } from "@mantine/charts";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/datetime";

export interface PulseTrendSeriesDef {
  name: string;
  label: string;
  color: string;
}

/**
 * The trend line chart across closed cycles — single-series in the result cards' eNPS
 * mini-chart, multi-series on the Trend tab (v2.11.0). A lazy chunk (recharts must never
 * enter the main bundle — the TeamKpiChart rule; the styles.css import must ride this
 * chunk). Rows are keyed by `closedAt` with one column per series name plus `n_<name>`
 * count columns, which ride the tooltip so no number ever shows without its n; undefined
 * cells render as line gaps (withheld or not-responded cycles).
 */
export default function PulseTrendChart({
  data,
  series,
  yDomain = [-100, 100],
}: {
  data: Record<string, number | undefined>[];
  series: PulseTrendSeriesDef[];
  yDomain?: [number, number];
}) {
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const seriesNames = new Set(series.map((s) => s.name));
  return (
    <LineChart
      h={series.length > 1 ? 260 : 200}
      data={data}
      dataKey="closedAt"
      series={series}
      curveType="linear"
      connectNulls={false}
      withDots
      yAxisProps={{ domain: yDomain, allowDecimals: false }}
      xAxisProps={{
        type: "number",
        domain: ["dataMin", "dataMax"],
        tickFormatter: (ts: number) => formatDate(ts, locale),
      }}
      tooltipProps={{
        content: ({ label, payload }) => {
          // Numeric-x tooltips include ghost rows for the x dataKey and the n_* columns —
          // the series-name allowlist drops them all (the TeamKpiChart gotcha). Each
          // series' n is appended to its own label instead.
          const row = payload?.[0]?.payload as Record<string, number | undefined> | undefined;
          const heading = typeof label === "number" ? formatDate(label, locale) : label;
          const enriched = series.map((s) => ({
            ...s,
            label: `${s.label} (n=${row?.[`n_${s.name}`] ?? "?"})`,
          }));
          return (
            <ChartTooltip
              label={heading}
              payload={(payload ?? []).filter((item) => seriesNames.has(String(item.dataKey)))}
              series={enriched}
            />
          );
        },
      }}
    />
  );
}
