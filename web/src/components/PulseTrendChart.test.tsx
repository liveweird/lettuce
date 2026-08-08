import { describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import PulseTrendChart from "./PulseTrendChart";
import { renderWithProviders } from "../test/render";

vi.mock("@mantine/charts", () => ({
  LineChart: (props: { data: unknown; yAxisProps: { domain: unknown }; dataKey: string }) => (
    <div
      data-testid="line-chart"
      data-points={JSON.stringify(props.data)}
      data-domain={JSON.stringify(props.yAxisProps.domain)}
      data-key={props.dataKey}
    />
  ),
  ChartTooltip: () => null,
}));

describe("PulseTrendChart", () => {
  test("plots the series over closedAt with the full eNPS domain pinned", () => {
    renderWithProviders(
      <PulseTrendChart
        points={[
          { closedAt: 100, enps: 40, n: 5 },
          { closedAt: 200, enps: -10, n: 6 },
        ]}
      />,
    );
    const chart = screen.getByTestId("line-chart");
    expect(chart.getAttribute("data-key")).toBe("closedAt");
    // The y domain is the whole -100..+100 scale — a trend never zooms into noise.
    expect(JSON.parse(chart.getAttribute("data-domain")!)).toEqual([-100, 100]);
    expect(JSON.parse(chart.getAttribute("data-points")!)).toHaveLength(2);
  });
});
