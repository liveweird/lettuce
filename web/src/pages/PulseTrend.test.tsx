import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

const CCC_BUNDLE = {
  teamId: 11,
  teamName: "CCC",
  series: [
    {
      teamId: 11,
      teamName: "CCC",
      mode: "direct",
      points: [point(1, 1000, "OK", 40, 75.0, 4), point(2, 2000, "OK", 50, 80.0, 5)],
    },
    {
      teamId: 11,
      teamName: "CCC",
      mode: "subtree",
      points: [point(1, 1000, "OK", 20, 60.0, 9), point(2, 2000, "OK", 30, 65.0, 10)],
    },
    {
      teamId: 21,
      teamName: "AAA",
      mode: "subtree",
      // The second cycle is withheld — its cell must become a gap, not a zero.
      points: [point(1, 1000, "OK", -10, 33.3, 3), point(2, 2000, "NOT_ENOUGH_RESPONSES", undefined, null, 2)],
    },
    {
      teamId: 22,
      teamName: "BBB",
      mode: "subtree",
      points: [
        point(1, 1000, "NOT_ENOUGH_RESPONSES", undefined, null, 2),
        point(2, 2000, "NOT_ENOUGH_RESPONSES", undefined, null, 1),
      ],
    },
  ],
};

// A childless team: only the two own scopes, and just one OK point → the pending note.
const AAA_BUNDLE = {
  teamId: 21,
  teamName: "AAA",
  series: [
    { teamId: 21, teamName: "AAA", mode: "direct", points: [point(2, 2000, "OK", -10, 33.3, 3)] },
    { teamId: 21, teamName: "AAA", mode: "subtree", points: [point(2, 2000, "OK", -10, 33.3, 3)] },
  ],
};

describe("PulseTrend", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    bundles = { 11: CCC_BUNDLE, 21: AAA_BUNDLE } as Record<number, unknown>,
    teams = [
      { id: 11, name: "CCC" },
      { id: 21, name: "AAA" },
    ],
  } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/visible-teams")) {
        return Promise.resolve(jsonResponse(200, { resultsTeams: teams, monitoredTeams: [] }));
      }
      // NB: "/trend-comparison" must be matched before any bare "/trend" route.
      if (u.includes("/trend-comparison")) {
        const teamId = Number(new URL(u, "http://x").searchParams.get("teamId"));
        return Promise.resolve(jsonResponse(200, bundles[teamId]));
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("defaults to the first visible team; all series chip-toggled on; withheld cycles are gaps", async () => {
    setupMocks();
    renderWithProviders(<PulseTrend />);

    // The two own scopes reuse the established scope labels; children carry their names.
    expect(await screen.findByRole("checkbox", { name: "Own members" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "The team and everyone below" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "AAA" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "BBB" })).toBeChecked();
    expect(
      mockFetch.mock.calls.some((c) => String(c[0]).includes("/trend-comparison?teamId=11")),
    ).toBe(true);

    const chart = await screen.findByTestId("trend-chart");
    // Default metric: eNPS over the full -100..+100 domain.
    expect(JSON.parse(chart.getAttribute("data-domain")!)).toEqual([-100, 100]);
    const rows = JSON.parse(chart.getAttribute("data-points")!);
    expect(rows).toHaveLength(2);
    expect(rows[0].t11_direct).toBe(40);
    expect(rows[0].n_t11_direct).toBe(4);
    expect(rows[0].t21_subtree).toBe(-10);
    // AAA's withheld second cycle and BBB's both cycles are gaps (absent), never zeros.
    expect(rows[1].t21_subtree).toBeUndefined();
    expect(rows[0].t22_subtree).toBeUndefined();
    // BBB's withheld points still carry their counts for the tooltip.
    expect(rows[0].n_t22_subtree).toBe(2);
  });

  test("switching the metric to Q2 swaps values, flips the domain, and persists", async () => {
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
    // The full driver text appears as a caption; the pick persists device-level.
    expect(screen.getByText("I understand what is expected of me in my role.")).toBeInTheDocument();
    expect(localStorage.getItem("lettuce.viewSettings.pulse.trend.metric")).toBe(JSON.stringify("q2"));
  });

  test("toggling a chip off removes that series from the chart", async () => {
    setupMocks();
    renderWithProviders(<PulseTrend />);
    await screen.findByTestId("trend-chart");

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "AAA" }));

    await waitFor(() => {
      const chart = screen.getByTestId("trend-chart");
      const series = JSON.parse(chart.getAttribute("data-series")!) as { name: string }[];
      expect(series.map((s) => s.name)).toEqual(["t11_direct", "t11_subtree", "t22_subtree"]);
      expect(JSON.parse(chart.getAttribute("data-points")!)[0].t21_subtree).toBeUndefined();
    });
  });

  test("picking a childless team shows the no-sub-teams note and the pending text under two points", async () => {
    setupMocks();
    renderWithProviders(<PulseTrend />);
    await screen.findByTestId("trend-chart");

    fireEvent.click(screen.getByLabelText("Team", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "AAA" }));

    expect(
      await screen.findByText("This team has no sub-teams — both lines cover the same people."),
    ).toBeInTheDocument();
    // One OK point only → the trend-pending idiom, no chart.
    expect(screen.getByText("The trend appears after two closed cycles.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    expect(
      mockFetch.mock.calls.some((c) => String(c[0]).includes("/trend-comparison?teamId=21")),
    ).toBe(true);
  });

  test("no visible teams renders the empty state, never a broken chart", async () => {
    setupMocks({ teams: [] });
    renderWithProviders(<PulseTrend />);
    expect(await screen.findByText("No teams to show results for.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });
});
