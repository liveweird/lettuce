import { describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import PulseTrendChart from "./PulseTrendChart";
import { renderWithProviders } from "../test/render";

vi.mock("@mantine/charts", () => ({
  LineChart: (props: {
    data: unknown;
    series: unknown;
    yAxisProps: { domain: unknown };
    dataKey: string;
  }) => (
    <div
      data-testid="line-chart"
      data-points={JSON.stringify(props.data)}
      data-series={JSON.stringify(props.series)}
      data-domain={JSON.stringify(props.yAxisProps.domain)}
      data-key={props.dataKey}
    />
  ),
  ChartTooltip: () => null,
}));

const ENPS = [{ name: "enps", label: "eNPS", color: "lettuce.6" }];

describe("PulseTrendChart", () => {
  test("plots the series over closedAt with the full eNPS domain as the default", () => {
    renderWithProviders(
      <PulseTrendChart
        data={[
          { closedAt: 100, enps: 40, n_enps: 5 },
          { closedAt: 200, enps: -10, n_enps: 6 },
        ]}
        series={ENPS}
      />,
    );
    const chart = screen.getByTestId("line-chart");
    expect(chart.getAttribute("data-key")).toBe("closedAt");
    // The default y domain is the whole -100..+100 scale — a trend never zooms into noise.
    expect(JSON.parse(chart.getAttribute("data-domain")!)).toEqual([-100, 100]);
    expect(JSON.parse(chart.getAttribute("data-points")!)).toHaveLength(2);
  });

  test("multi-series rows pass through with gaps and an explicit domain (v2.11.0)", () => {
    renderWithProviders(
      <PulseTrendChart
        data={[
          { closedAt: 100, t1_direct: 80, n_t1_direct: 4, t2_subtree: 60, n_t2_subtree: 7 },
          // The second series has no value here — an undefined cell renders as a line gap.
          { closedAt: 200, t1_direct: 90, n_t1_direct: 5 },
        ]}
        series={[
          { name: "t1_direct", label: "Own members", color: "lettuce.6" },
          { name: "t2_subtree", label: "Sub-team", color: "indigo.6" },
        ]}
        yDomain={[0, 100]}
      />,
    );
    const chart = screen.getByTestId("line-chart");
    expect(JSON.parse(chart.getAttribute("data-domain")!)).toEqual([0, 100]);
    expect(JSON.parse(chart.getAttribute("data-series")!)).toHaveLength(2);
    const rows = JSON.parse(chart.getAttribute("data-points")!);
    expect(rows).toHaveLength(2);
    expect(rows[1].t2_subtree).toBeUndefined();
  });
});
