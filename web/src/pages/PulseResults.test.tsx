import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    rotatingQuestionEn: "Good work is recognized here.",
    rotatingQuestionPl: "Dobra praca jest tu doceniana.",
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
    {
      question: "Q2",
      validCount: 3,
      mean: 4.3,
      favorablePct: 66.7,
      unfavorablePct: 0.0,
      meanDelta: 1.2,
      favorableDeltaPp: -16.7,
    },
    { question: "Q3", validCount: 3, mean: 4.0, favorablePct: 66.7, unfavorablePct: 0.0 },
    { question: "Q4", validCount: 3, mean: 4.0, favorablePct: 66.7, unfavorablePct: 0.0 },
    // All-NA row: everything null, n 0 — renders as em-dashes.
    { question: "Q5", validCount: 0 },
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

// A per-row results block for the comparison fixture — favorable% is what the packed table shows.
function comparisonRow(
  teamId: number,
  teamName: string,
  mode: "direct" | "subtree",
  overrides: Record<string, unknown> = {},
) {
  return {
    cycleId: 5,
    teamId,
    teamName,
    mode,
    participantCount: 4,
    responseCount: 3,
    responseRate: 75.0,
    insufficientResponses: false,
    enps: { score: 33, promoterPct: 66.7, passivePct: 0.0, detractorPct: 33.3 },
    drivers: [
      { question: "Q2", validCount: 3, favorablePct: 83.3, mean: 4.3, unfavorablePct: 0.0 },
      { question: "Q3", validCount: 3, favorablePct: 66.7, mean: 4.0, unfavorablePct: 0.0 },
      { question: "Q4", validCount: 3, favorablePct: 66.7, mean: 4.0, unfavorablePct: 0.0 },
      { question: "Q5", validCount: 0 },
      {
        question: "ROTATING",
        rotatingTextEn: "Good work is recognized here.",
        rotatingTextPl: "Dobra praca jest tu doceniana.",
        validCount: 3,
        favorablePct: 33.3,
        mean: 3.7,
        unfavorablePct: 33.3,
      },
    ],
    previous: { cycleId: 4, enpsDelta: 12 },
    ...overrides,
  };
}

const COMPARISON = {
  cycleId: 5,
  teamId: 11,
  teamName: "AAA",
  ownMembers: comparisonRow(11, "AAA", "direct", {
    enps: { score: 100, promoterPct: 100.0, passivePct: 0.0, detractorPct: 0.0 },
  }),
  subTeams: [
    comparisonRow(21, "Sub A", "subtree", { responseCount: 6, participantCount: 8 }),
    comparisonRow(22, "Sub B", "subtree", {
      responseCount: 2,
      responseRate: 50.0,
      insufficientResponses: true,
      enps: null,
      drivers: null,
      previous: null,
    }),
  ],
};

describe("PulseResults", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    resultsStatus = 200,
    results = RESULTS as unknown,
    comparisonStatus = 200,
    comparison = COMPARISON as unknown,
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
      if (u.includes("/team-comparison")) {
        return Promise.resolve(
          comparisonStatus === 200
            ? jsonResponse(200, comparison)
            : jsonResponse(comparisonStatus, { title: "no", status: comparisonStatus }),
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
    // The Q2 deltas render signed and 1dp — mean, and (v2.6.2) the favorable Δpp.
    expect(screen.getByText("+1.2")).toBeInTheDocument();
    expect(screen.getByText("-16.7 pp")).toBeInTheDocument();
    // v2.6.2 context: n=3 shows the volatility hint, and score 33 sits in the "good" band.
    expect(screen.getByText("Small group — individual answers can move these numbers a lot.")).toBeInTheDocument();
    expect(screen.getByText("good")).toBeInTheDocument();
    // The all-NA Q5 row ships nulls: mean/favorable/unfavorable/deltas all em-dash, n 0.
    const q5Row = screen
      .getByText("My current workload is manageable over the long term.")
      .closest("tr")!;
    expect(within(q5Row).getAllByText("—")).toHaveLength(5);
    expect(within(q5Row).getByText("0")).toBeInTheDocument();
    // The trend chart got exactly the two OK points.
    await waitFor(() => {
      const chart = screen.getByTestId("trend-chart");
      expect(JSON.parse(chart.getAttribute("data-points")!)).toHaveLength(2);
    });
    // Methodology hints (v2.6.4): the eNPS headline and every metric header carry an
    // info icon whose accessible name IS the tooltip explanation.
    expect(
      screen.getByRole("img", { name: /percentage of promoters minus the percentage of detractors/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /share of favorable answers/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /share of unfavorable answers/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /number of valid answers/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /average of this question/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /mean changed versus the previous/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /favorable share changed versus the previous/ })).toBeInTheDocument();
  });

  test("edge renderings: a zero score is unsigned and a zero delta stays gray", async () => {
    setupMocks({
      results: {
        ...RESULTS,
        enps: { score: 0, promoterPct: 33.3, passivePct: 33.3, detractorPct: 33.3 },
        previous: { cycleId: 4, enpsDelta: 0 },
      },
    });
    renderWithProviders(<PulseResults />);
    // The 0 delta renders (gray, unsigned) rather than disappearing like a missing previous.
    expect(await screen.findByText("0 vs previous cycle")).toBeInTheDocument();
    // No signed variant of the zero score anywhere.
    expect(screen.queryByText("+0")).toBeNull();
    expect(screen.getByText(/Promoters 33.3%/)).toBeInTheDocument();
  });

  test("a negative score renders with its minus sign", async () => {
    setupMocks({
      results: {
        ...RESULTS,
        enps: { score: -12, promoterPct: 22.2, passivePct: 33.3, detractorPct: 44.5 },
        previous: null,
      },
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("-12")).toBeInTheDocument();
    expect(screen.queryByText(/vs previous cycle/)).toBeNull();
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
    // The withheld state shows the k marker alone — never the small-sample hint on top.
    expect(screen.queryByText(/Small group/)).toBeNull();
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

  test("switching to the comparison mode renders the packed per-sub-team table", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    // Starts in direct mode (the full card), then the third segment flips the view.
    await screen.findByText("+33");
    await user.click(screen.getByRole("radio", { name: "Sub-team comparison" }));

    // One row per scope: the own-members baseline plus both sub-teams.
    expect(await screen.findByText("Own members")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Sub-team comparison for AAA" });
    expect(within(table).getByText("Sub A")).toBeInTheDocument();
    expect(within(table).getByText("Sub B")).toBeInTheDocument();
    // The comparison endpoint carried the cycle and parent team.
    expect(
      mockFetch.mock.calls.some(([url]) =>
        String(url).includes("/cycles/5/team-comparison?teamId=11"),
      ),
    ).toBe(true);
    // Packed metrics: the baseline's +100, Sub A's favorable shares, per-row responses.
    expect(within(table).getByText("+100")).toBeInTheDocument();
    expect(within(table).getAllByText("83.3%").length).toBeGreaterThan(0);
    expect(within(table).getByText("6 of 8 responded (75%)")).toBeInTheDocument();
    // The withheld Sub B row keeps its responses but hides the metrics.
    const subBRow = within(table).getByText("Sub B").closest("tr")!;
    expect(
      within(subBRow).getByText("Fewer than 3 responses — results are hidden to protect anonymity."),
    ).toBeInTheDocument();
    expect(within(subBRow).getByText("2 of 4 responded (50%)")).toBeInTheDocument();
    // Header hints: eNPS methodology, the fixed question texts, the cycle's rotating text.
    expect(
      within(table).getByRole("img", { name: "I understand what is expected of me in my role." }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("img", { name: "Good work is recognized here." }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Question columns show the favorable share/)).toBeInTheDocument();
    // Deliberately absent in this view: comments and the trend chart.
    expect(screen.queryByText("Comments")).toBeNull();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });

  test("comparison mode: a team without sub-teams shows the in-card note", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.mode", JSON.stringify("compare"));
    setupMocks({ comparison: { ...COMPARISON, subTeams: [] } });
    renderWithProviders(<PulseResults />);
    expect(
      await screen.findByText("This team has no sub-teams to compare."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("comparison mode: the fill gate renders the same informational empty state", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.mode", JSON.stringify("compare"));
    setupMocks({ comparisonStatus: 403 });
    renderWithProviders(<PulseResults />);
    expect(
      await screen.findByText("Results are available for closed cycles you took part in."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Own members")).toBeNull();
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
