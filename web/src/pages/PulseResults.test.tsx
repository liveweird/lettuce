import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import PulseResults from "./PulseResults";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

vi.mock("@mantine/charts", () => ({
  LineChart: (props: { data: unknown }) => (
    <div data-testid="trend-chart" data-points={JSON.stringify(props.data)} />
  ),
  ChartTooltip: () => null,
}));

type FetchMock = ReturnType<typeof vi.fn>;

const CYCLES = [
  {
    id: 5,
    status: "CLOSED",
    plannedOpenDate: "2026-08-01",
    plannedCloseDate: "2026-08-08",
    closedAt: 500,
    createdAt: 0,
    lastModified: 0,
  },
  {
    id: 4,
    status: "CLOSED",
    plannedOpenDate: "2026-07-01",
    plannedCloseDate: "2026-07-08",
    closedAt: 400,
    createdAt: 0,
    lastModified: 0,
  },
];

const RESULTS = {
  cycleId: 5,
  teamId: 11,
  teamName: "AAA",
  mode: "direct",
  participantCount: 4,
  responseCount: 3,
  responseRate: 75.0,
  insufficientResponses: false,
  enps: { score: 33, promoterPct: 66.7, passivePct: 0.0, detractorPct: 33.3 },
  drivers: [
    { question: "Q2", validCount: 3, mean: 4.3, favorablePct: 66.7, unfavorablePct: 0.0, meanDelta: 1.2 },
    { question: "Q3", validCount: 3, mean: 4.0, favorablePct: 66.7, unfavorablePct: 0.0 },
    { question: "Q4", validCount: 3, mean: 4.0, favorablePct: 66.7, unfavorablePct: 0.0 },
    { question: "Q5", validCount: 2, mean: 3.5, favorablePct: 50.0, unfavorablePct: 0.0 },
    {
      question: "ROTATING",
      rotatingTextEn: "Good work is recognized here.",
      rotatingTextPl: "Dobra praca jest tu doceniana.",
      validCount: 3,
      mean: 3.7,
      favorablePct: 33.3,
      unfavorablePct: 33.3,
    },
  ],
  previous: { cycleId: 4, enpsDelta: 12 },
};

const TREND = {
  teamId: 11,
  teamName: "AAA",
  mode: "direct",
  points: [
    { cycleId: 4, closedAt: 400, availability: "OK", enps: 21, responseCount: 3, responseRate: 75 },
    { cycleId: 5, closedAt: 500, availability: "OK", enps: 33, responseCount: 3, responseRate: 75 },
  ],
};

describe("PulseResults", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    resultsStatus = 200,
    results = RESULTS as unknown,
    monitored = [] as unknown[],
    comments = { items: [], responseCount: 3, insufficientResponses: false } as unknown,
  } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/visible-teams")) {
        return Promise.resolve(
          jsonResponse(200, { resultsTeams: [{ id: 11, name: "AAA" }], monitoredTeams: monitored }),
        );
      }
      if (u.includes("/results")) {
        return Promise.resolve(
          resultsStatus === 200
            ? jsonResponse(200, results)
            : jsonResponse(resultsStatus, { title: "no", status: resultsStatus }),
        );
      }
      if (u.includes("/trend")) return Promise.resolve(jsonResponse(200, TREND));
      if (u.includes("/comments")) return Promise.resolve(jsonResponse(200, comments));
      if (u.includes("/pulse-surveys/cycles")) {
        return Promise.resolve(jsonResponse(200, { items: CYCLES }));
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

  test("renders the team card: eNPS with delta, split, drivers incl. the rotating text, n everywhere", async () => {
    setupMocks();
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("+33")).toBeInTheDocument();
    expect(screen.getByText("+12 vs previous cycle")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 responded (75%)")).toBeInTheDocument();
    expect(screen.getByText(/Promoters 66.7%/)).toBeInTheDocument();
    expect(screen.getByText("I understand what is expected of me in my role.")).toBeInTheDocument();
    expect(screen.getByText("Good work is recognized here.")).toBeInTheDocument();
    // The Q2 delta renders signed and 1dp.
    expect(screen.getByText("+1.2")).toBeInTheDocument();
    // The trend chart got exactly the two OK points.
    await waitFor(() => {
      const chart = screen.getByTestId("trend-chart");
      expect(JSON.parse(chart.getAttribute("data-points")!)).toHaveLength(2);
    });
  });

  test("defaults to the latest closed cycle; ?cycle= deep-link overrides", async () => {
    setupMocks();
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&cycle=4" });
    await screen.findByText("+33");
    // The picked cycle rides every per-team query.
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes("/cycles/4/results")),
    ).toBe(true);
  });

  test("a fill-gated caller gets one informational empty state, not a wall of errors", async () => {
    setupMocks({ resultsStatus: 403 });
    renderWithProviders(<PulseResults />);
    expect(
      await screen.findByText("Results are available for closed cycles you took part in."),
    ).toBeInTheDocument();
    expect(screen.queryByText("AAA")).toBeNull();
  });

  test("the k-anonymity marker renders the withheld body with the header intact", async () => {
    setupMocks({
      results: {
        ...RESULTS,
        insufficientResponses: true,
        responseCount: 2,
        responseRate: 50.0,
        enps: null,
        drivers: null,
        previous: null,
      },
    });
    renderWithProviders(<PulseResults />);
    expect(
      await screen.findByText("Fewer than 3 responses — results are hidden to protect anonymity."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 4 responded (50%)")).toBeInTheDocument();
  });

  test("comments render only for monitored teams", async () => {
    setupMocks({
      monitored: [{ id: 11, name: "AAA" }],
      comments: { items: ["anonymous alpha", "anonymous beta"], responseCount: 3, insufficientResponses: false },
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("anonymous alpha")).toBeInTheDocument();
    expect(screen.getByText("Shown anonymized and in random order.")).toBeInTheDocument();
  });

  test("no closed cycles yet → the empty state", async () => {
    setupMocks();
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/visible-teams")) {
        return Promise.resolve(jsonResponse(200, { resultsTeams: [], monitoredTeams: [] }));
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("No closed pulse cycles yet.")).toBeInTheDocument();
  });
});
