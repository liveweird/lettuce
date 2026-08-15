import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PulseTrend from "./PulseTrend";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

// happy-dom cannot measure the recharts canvas — the chart mock exposes its inputs.
vi.mock("@mantine/charts", () => ({
  LineChart: (props: { data: unknown; series: unknown; yAxisProps: { domain: unknown } }) => (
    <div
      data-testid="trend-chart"
      data-points={JSON.stringify(props.data)}
      data-series={JSON.stringify(props.series)}
      data-domain={JSON.stringify(props.yAxisProps.domain)}
    />
  ),
  ChartTooltip: () => null,
}));

type FetchMock = ReturnType<typeof vi.fn>;

function point(
  cycleId: number,
  closedAt: number,
  availability: "OK" | "NOT_ENOUGH_RESPONSES" | "NOT_A_RESPONDENT",
  enps?: number,
  favorableQ2?: number | null,
  responseCount?: number,
) {
  return {
    cycleId,
    closedAt,
    availability,
    enps: enps ?? null,
    responseCount: responseCount ?? (availability === "NOT_A_RESPONDENT" ? null : 3),
    responseRate: availability === "NOT_A_RESPONDENT" ? null : 100.0,
    favorableQ2: favorableQ2 ?? null,
    favorableQ3: null,
    favorableQ4: null,
    favorableQ5: null,
  };
}

// Per-(teamId, mode) single-team /trend fixtures — one series per toggled-on team pill.
const TRENDS: Record<string, unknown> = {
  "11:direct": {
    teamId: 11,
    teamName: "CCC",
    mode: "direct",
    points: [point(1, 1000, "OK", 40, 75.0, 4), point(2, 2000, "OK", 50, 80.0, 5)],
  },
  "11:subtree": {
    teamId: 11,
    teamName: "CCC",
    mode: "subtree",
    points: [point(1, 1000, "OK", 20, 60.0, 9), point(2, 2000, "OK", 30, 65.0, 10)],
  },
  "21:direct": {
    teamId: 21,
    teamName: "AAA",
    mode: "direct",
    // The second cycle is withheld — its cell must become a gap, not a zero.
    points: [point(1, 1000, "OK", -10, 33.3, 3), point(2, 2000, "NOT_ENOUGH_RESPONSES", undefined, null, 2)],
  },
  "21:subtree": {
    teamId: 21,
    teamName: "AAA",
    mode: "subtree",
    points: [point(1, 1000, "OK", -20, 30.0, 4), point(2, 2000, "OK", -30, 25.0, 4)],
  },
  "22:direct": {
    teamId: 22,
    teamName: "BBB",
    mode: "direct",
    points: [
      point(1, 1000, "NOT_ENOUGH_RESPONSES", undefined, null, 2),
      point(2, 2000, "NOT_ENOUGH_RESPONSES", undefined, null, 1),
    ],
  },
  "22:subtree": {
    teamId: 22,
    teamName: "BBB",
    mode: "subtree",
    points: [
      point(1, 1000, "NOT_ENOUGH_RESPONSES", undefined, null, 2),
      point(2, 2000, "NOT_ENOUGH_RESPONSES", undefined, null, 1),
    ],
  },
};

describe("PulseTrend", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    member = [] as { id: number; name: string }[],
    monitored = [
      { id: 21, name: "AAA" },
      { id: 22, name: "BBB" },
      { id: 11, name: "CCC" },
    ] as { id: number; name: string }[],
  } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/visible-teams")) {
        return Promise.resolve(
          jsonResponse(200, {
            resultsTeams: [...member, ...monitored],
            monitoredTeams: monitored,
            memberTeams: member,
          }),
        );
      }
      if (u.includes("/pulse-surveys/trend")) {
        const params = new URL(u, "http://x").searchParams;
        return Promise.resolve(
          jsonResponse(200, TRENDS[`${params.get("teamId")}:${params.get("mode")}`]),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  const presetManaged = () =>
    localStorage.setItem("lettuce.viewSettings.pulse.trend.view", JSON.stringify("managed"));

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("managed view: one pill per monitored team, all on, one direct line each, gaps for withheld cycles", async () => {
    presetManaged();
    setupMocks();
    renderWithProviders(<PulseTrend />);

    expect(await screen.findByRole("checkbox", { name: "AAA" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "BBB" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "CCC" })).toBeChecked();

    const chart = await screen.findByTestId("trend-chart");
    expect(JSON.parse(chart.getAttribute("data-domain")!)).toEqual([-100, 100]);
    const series = JSON.parse(chart.getAttribute("data-series")!) as { name: string; label: string }[];
    expect(series.map((s) => s.name).sort()).toEqual(["t11_direct", "t21_direct", "t22_direct"]);
    expect(series.map((s) => s.label).sort()).toEqual(["AAA", "BBB", "CCC"]);
    const rows = JSON.parse(chart.getAttribute("data-points")!);
    expect(rows).toHaveLength(2);
    expect(rows[0].t21_direct).toBe(-10);
    expect(rows[0].n_t21_direct).toBe(3);
    // AAA's withheld second cycle and BBB's both cycles are gaps (absent), never zeros.
    expect(rows[1].t21_direct).toBeUndefined();
    expect(rows[0].t22_direct).toBeUndefined();
    // Withheld points still carry their counts for the tooltip.
    expect(rows[0].n_t22_direct).toBe(2);
    // One /trend request per toggled-on team, all direct at the default calc.
    expect(
      mockFetch.mock.calls.filter(([u]) => String(u).includes("mode=direct")),
    ).toHaveLength(3);
  });

  test("the calc switch refetches every line with subtree numbers and persists", async () => {
    presetManaged();
    setupMocks();
    renderWithProviders(<PulseTrend />);
    await screen.findByTestId("trend-chart");

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Including everyone below" }));

    await waitFor(() => {
      const chart = screen.getByTestId("trend-chart");
      const series = JSON.parse(chart.getAttribute("data-series")!) as { name: string }[];
      expect(series.map((s) => s.name).sort()).toEqual(["t11_subtree", "t21_subtree", "t22_subtree"]);
      expect(JSON.parse(chart.getAttribute("data-points")!)[0].t11_subtree).toBe(20);
    });
    expect(
      mockFetch.mock.calls.some(([u]) => String(u).includes("/trend?teamId=11&mode=subtree")),
    ).toBe(true);
    expect(localStorage.getItem("lettuce.viewSettings.pulse.trend.calc")).toBe(
      JSON.stringify("indirect"),
    );
  });

  test("switching the metric to Q2 swaps values, flips the domain, and persists", async () => {
    presetManaged();
    setupMocks();
    renderWithProviders(<PulseTrend />);
    await screen.findByTestId("trend-chart");

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Q2" }));

    await waitFor(() => {
      const chart = screen.getByTestId("trend-chart");
      expect(JSON.parse(chart.getAttribute("data-domain")!)).toEqual([0, 100]);
      expect(JSON.parse(chart.getAttribute("data-points")!)[0].t11_direct).toBe(75);
    });
    expect(screen.getByText("I understand what is expected of me in my role.")).toBeInTheDocument();
    expect(localStorage.getItem("lettuce.viewSettings.pulse.trend.metric")).toBe(JSON.stringify("q2"));
  });

  test("toggling a pill off removes that team's line; all off shows the none-selected note", async () => {
    presetManaged();
    setupMocks();
    renderWithProviders(<PulseTrend />);
    await screen.findByTestId("trend-chart");

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "AAA" }));
    await waitFor(() => {
      const chart = screen.getByTestId("trend-chart");
      const series = JSON.parse(chart.getAttribute("data-series")!) as { name: string }[];
      expect(series.map((s) => s.name).sort()).toEqual(["t11_direct", "t22_direct"]);
    });

    await user.click(screen.getByRole("checkbox", { name: "BBB" }));
    await user.click(screen.getByRole("checkbox", { name: "CCC" }));
    expect(
      await screen.findByText("Toggle at least one team to draw the chart."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });

  test("the member view charts the member teams' direct lines with their own pills", async () => {
    setupMocks({ member: [{ id: 11, name: "CCC" }], monitored: [] });
    renderWithProviders(<PulseTrend />);

    expect(await screen.findByRole("checkbox", { name: "CCC" })).toBeChecked();
    const chart = await screen.findByTestId("trend-chart");
    const series = JSON.parse(chart.getAttribute("data-series")!) as { name: string; label: string }[];
    expect(series).toHaveLength(1);
    expect(series[0].name).toBe("t11_direct");
    expect(series[0].label).toBe("CCC");
    // The member view is always direct — no calc switch rendered.
    expect(screen.queryByRole("radio", { name: "Including everyone below" })).toBeNull();
    expect(
      mockFetch.mock.calls.some(([u]) => String(u).includes("/trend?teamId=11&mode=direct")),
    ).toBe(true);
  });

  test("switching the view persists and swaps the pill set", async () => {
    setupMocks({ member: [{ id: 21, name: "AAA" }] });
    renderWithProviders(<PulseTrend />);
    await screen.findByRole("checkbox", { name: "AAA" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Teams I manage" }));
    expect(await screen.findByRole("checkbox", { name: "CCC" })).toBeChecked();
    expect(localStorage.getItem("lettuce.viewSettings.pulse.trend.view")).toBe(
      JSON.stringify("managed"),
    );
  });

  test("a member of no team gets the member empty state but can still reach the managed view", async () => {
    setupMocks({ member: [] });
    renderWithProviders(<PulseTrend />);
    expect(await screen.findByText("You are not a member of any team.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Teams I manage" })).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });

  test("a non-manager gets the managed empty state", async () => {
    presetManaged();
    setupMocks({ member: [{ id: 21, name: "AAA" }], monitored: [] });
    renderWithProviders(<PulseTrend />);
    expect(await screen.findByText("You don't manage any teams.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });

  test("a single renderable point renders the pending note, not a one-point chart", async () => {
    setupMocks({
      member: [{ id: 21, name: "AAA" }],
      monitored: [],
    });
    // Override AAA's direct series to a single OK point.
    const single = {
      teamId: 21,
      teamName: "AAA",
      mode: "direct",
      points: [point(2, 2000, "OK", -10, 33.3, 3)],
    };
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/visible-teams")) {
        return Promise.resolve(
          jsonResponse(200, {
            resultsTeams: [{ id: 21, name: "AAA" }],
            monitoredTeams: [],
            memberTeams: [{ id: 21, name: "AAA" }],
          }),
        );
      }
      if (u.includes("/pulse-surveys/trend")) return Promise.resolve(jsonResponse(200, single));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
    renderWithProviders(<PulseTrend />);
    expect(await screen.findByText("The trend appears after two closed cycles.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });
});
