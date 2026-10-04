import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PulseResults from "./PulseResults";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import { fireIntersect, installIntersectionObserver } from "../test/intersection";
import i18n from "../i18n";

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
    rotatingQuestion: { en: "Good work is recognized here.", pl: "Dobra praca jest tu doceniana." },
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
      rotatingText: { en: "Good work is recognized here.", pl: "Dobra praca jest tu doceniana." },
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
    member = [{ id: 11, name: "AAA" }] as { id: number; name: string }[],
    monitored = [] as { id: number; name: string }[],
    allTeams = undefined as { id: number; name: string }[] | undefined,
    comments = { items: [], responseCount: 3, insufficientResponses: false } as unknown,
  } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/visible-teams")) {
        return Promise.resolve(
          jsonResponse(200, {
            resultsTeams: [...member, ...monitored],
            monitoredTeams: monitored,
            memberTeams: member,
            // Omitted entirely for a non-auditor — the server contract (v3.24.0).
            ...(allTeams != null ? { allTeams } : {}),
          }),
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

  const trendCalls = () => mockFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/trend?"));

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    installIntersectionObserver();
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
    // The trend chart is lazy (v4.15.0): nothing was requested while the section is off-screen…
    expect(trendCalls()).toHaveLength(0);
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    // …and once it nears the viewport the chart gets exactly the two OK points.
    fireIntersect();
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

  test("the trend loads per card when its chart section nears the viewport, and keeps it once scrolled away (v4.15.0)", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.view", JSON.stringify("managed"));
    setupMocks({
      member: [],
      monitored: [
        { id: 11, name: "AAA" },
        { id: 31, name: "CCC" },
      ],
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findAllByText("eNPS trend")).toHaveLength(2);
    await screen.findAllByText("+33");
    // Both cards fetched their results eagerly, but no trend yet: no chart, no request, and an idle (not busy) section.
    expect(trendCalls()).toHaveLength(0);
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    const wrappers = screen.getAllByText("eNPS trend").map((label) => label.closest("[aria-busy]")!);
    expect(wrappers.map((w) => w.getAttribute("aria-busy"))).toEqual(["false", "false"]);

    // Only the first card's chart section scrolls into view: exactly one trend request, for that team.
    expect(fireIntersect((el) => el === wrappers[0])).toBe(1);
    await waitFor(() => expect(trendCalls()).toHaveLength(1));
    expect(trendCalls()[0]).toContain("teamId=11");
    await waitFor(() => expect(screen.getAllByTestId("trend-chart")).toHaveLength(1));
    expect(within(wrappers[0] as HTMLElement).getByTestId("trend-chart")).toBeInTheDocument();
    expect(within(wrappers[1] as HTMLElement).queryByTestId("trend-chart")).toBeNull();

    // Scrolling the first back out keeps its chart and refetches nothing (the latch).
    fireIntersect((el) => el === wrappers[0], false);
    expect(screen.getAllByTestId("trend-chart")).toHaveLength(1);
    expect(trendCalls()).toHaveLength(1);

    // Later the second one too; a re-fire for the first never refetches (cached + latched).
    fireIntersect();
    await waitFor(() => expect(screen.getAllByTestId("trend-chart")).toHaveLength(2));
    expect(trendCalls()).toHaveLength(2);
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

  test("the managed view lists the monitored teams and the calc toggle flips the wire mode", async () => {
    setupMocks({
      member: [{ id: 11, name: "AAA" }],
      monitored: [
        { id: 31, name: "CCC" },
        { id: 11, name: "AAA" },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    // The default member view shows only the membership card.
    await screen.findByRole("heading", { name: "AAA" });
    expect(screen.queryByRole("heading", { name: "CCC" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Teams I manage" }));
    expect(await screen.findByRole("heading", { name: "CCC" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AAA" })).toBeInTheDocument();
    // Managed cards start on the direct calculation and the pick persists.
    expect(
      mockFetch.mock.calls.some(([url]) => String(url).includes("/results?teamId=31&mode=direct")),
    ).toBe(true);
    expect(localStorage.getItem("lettuce.viewSettings.pulse.results.view")).toBe(
      JSON.stringify("managed"),
    );

    await user.click(screen.getByRole("radio", { name: "Including everyone below" }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([url]) =>
          String(url).includes("/results?teamId=31&mode=subtree"),
        ),
      ).toBe(true);
    });
    expect(localStorage.getItem("lettuce.viewSettings.pulse.results.calc")).toBe(
      JSON.stringify("indirect"),
    );
  });

  test("a member of no team gets the member empty state but can still reach the managed view", async () => {
    setupMocks({ member: [], monitored: [{ id: 31, name: "CCC" }] });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    // The empty state renders BELOW the selector — the view switch stays reachable.
    expect(await screen.findByText("You are not a member of any team.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Teams I manage" }));
    expect(await screen.findByRole("heading", { name: "CCC" })).toBeInTheDocument();
  });

  test("a non-manager gets the managed empty state", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.view", JSON.stringify("managed"));
    setupMocks({ member: [{ id: 11, name: "AAA" }], monitored: [] });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("You don't manage any teams.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AAA" })).toBeNull();
  });

  test("HR: the scope control gains an All-teams option, fed by the allTeams bucket (v3.24.0)", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["HR"]));
    setupMocks({
      member: [{ id: 11, name: "AAA" }],
      monitored: [],
      allTeams: [
        { id: 11, name: "AAA" },
        { id: 31, name: "CCC" },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);

    await screen.findByRole("heading", { name: "AAA" });
    expect(screen.getByRole("radio", { name: "All teams" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "All teams" }));
    expect(await screen.findByRole("heading", { name: "CCC" })).toBeInTheDocument();
    // The calc toggle applies to "all" exactly like it does to "managed".
    expect(screen.getByRole("radio", { name: "Direct members only" })).toBeInTheDocument();
  });

  test("a non-HR caller never sees the All-teams scope option", async () => {
    setupMocks();
    renderWithProviders(<PulseResults />);
    await screen.findByRole("heading", { name: "AAA" });
    expect(screen.queryByRole("radio", { name: "All teams" })).toBeNull();
  });

  test("HR with no own/managed teams defaults to the All-teams scope (v3.24.0)", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["HR"]));
    setupMocks({ member: [], monitored: [], allTeams: [{ id: 31, name: "CCC" }] });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByRole("heading", { name: "CCC" })).toBeInTheDocument();
  });

  test("a stale stored All-teams value never applies to a non-auditor", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.view", JSON.stringify("all"));
    setupMocks();
    renderWithProviders(<PulseResults />);
    // Falls back to the member view instead of a hidden/broken auditor scope.
    expect(await screen.findByRole("heading", { name: "AAA" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "All teams" })).toBeNull();
  });

  test("no closed cycles yet → the empty state", async () => {
    setupMocks();
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/visible-teams")) {
        return Promise.resolve(
          jsonResponse(200, { resultsTeams: [], monitoredTeams: [], memberTeams: [] }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("No closed pulse cycles yet.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------
// Sharing (v4.12.0): the "Shared with me" view, the deep link, the fill-gate probe that a
// share-granted read cannot fool, the card's Share button / "Shared by" / comments gating and
// the lapse copy.
// ---------------------------------------------------------------------------------------
const LAPSE = "The person who shared this no longer has access to it";

const pulseShare = (id: number, teamId: number, team: string, sharerName: string) => ({
  id,
  resourceType: "PULSE_TEAM_RESULTS",
  resourceId: teamId,
  sharerId: 40 + id,
  sharerName,
  shareeId: 7,
  shareeName: "Me Caller",
  expiresOn: null,
  createdAt: 1000 - id,
  status: "ACTIVE",
  withdrawnAt: null,
  withdrawnById: null,
  withdrawnByName: null,
  link: `/pulse?tab=results&view=shared&team=${teamId}`,
  details: { team },
});

describe("PulseResults — sharing (v4.12.0)", () => {
  let mockFetch: FetchMock;
  type TeamRef = { id: number; name: string };
  type ResultReply = { status: number; body?: unknown };

  function setup({
    member = [] as TeamRef[],
    monitored = [] as TeamRef[],
    shares = [] as unknown[],
    sharesStatus = 200,
    results = {} as Record<number, ResultReply>,
    comments = { items: ["shared comment"], responseCount: 3, insufficientResponses: false } as unknown,
  } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/shares")) {
        return Promise.resolve(
          sharesStatus === 200
            ? jsonResponse(200, { items: shares, page: 1, pageSize: 100, total: shares.length })
            : jsonResponse(sharesStatus, { title: "x", status: sharesStatus }),
        );
      }
      if (u.includes("/visible-teams")) {
        return Promise.resolve(
          jsonResponse(200, {
            resultsTeams: [...member, ...monitored],
            monitoredTeams: monitored,
            memberTeams: member,
          }),
        );
      }
      if (u.includes("/results")) {
        const teamId = Number(new URL(u, "http://x").searchParams.get("teamId"));
        const reply = results[teamId] ?? { status: 200 };
        return Promise.resolve(
          reply.status === 200
            ? jsonResponse(200, { ...RESULTS, teamId, teamName: `T${teamId}`, ...(reply.body as object) })
            : jsonResponse(reply.status, reply.body ?? { title: "no", status: reply.status }),
        );
      }
      if (u.includes("/trend")) return Promise.resolve(jsonResponse(200, TREND));
      if (u.includes("/comments")) return Promise.resolve(jsonResponse(200, comments));
      if (u.includes("/pulse-surveys/cycles")) return Promise.resolve(jsonResponse(200, { items: CYCLES }));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  const resultCalls = () =>
    mockFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/results?"));
  const commentCalls = () =>
    mockFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/comments?"));

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    installIntersectionObserver();
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    localStorage.clear();
    await i18n.changeLanguage("en");
  });

  test("the shared view lists the teams shared with the caller, deduped by team, each with its sharer", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      shares: [
        pulseShare(1, 21, "BBB", "Ann Sharer"),
        pulseShare(2, 22, "CCC", "Cy Sharer"),
        // A second share of BBB: one card, the newest sharer named.
        pulseShare(3, 21, "BBB", "Old Sharer"),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    await screen.findByRole("heading", { name: "AAA" });

    await user.click(screen.getByRole("radio", { name: "Shared with me" }));
    expect(await screen.findByRole("heading", { name: "BBB" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "CCC" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AAA" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(2);
    // The list is fed by the ACTIVE withMe shares of the pulse kind only.
    expect(
      mockFetch.mock.calls.some(([url]) =>
        String(url).includes("/api/v1/shares?view=withMe&resourceType=PULSE_TEAM_RESULTS&status=ACTIVE"),
      ),
    ).toBe(true);
    // The read names the sharer (the card falls back to the list's name until/unless the DTO carries one).
    expect(await screen.findByText("Shared by Ann Sharer")).toBeInTheDocument();
    expect(screen.queryByText("Shared by Old Sharer")).toBeNull();
    expect(localStorage.getItem("lettuce.viewSettings.pulse.results.view")).toBe(JSON.stringify("shared"));
    // The calc toggle is offered on the shared view (plan Q7).
    expect(screen.getByRole("radio", { name: "Including everyone below" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Including everyone below" }));
    await waitFor(() => {
      expect(resultCalls().some((u) => u.includes("teamId=21&mode=subtree"))).toBe(true);
    });
  });

  test("an empty shared view says nobody has shared results with the caller", async () => {
    setup({ member: [{ id: 11, name: "AAA" }] });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    await screen.findByRole("heading", { name: "AAA" });
    await user.click(screen.getByRole("radio", { name: "Shared with me" }));
    expect(await screen.findByText("Nobody has shared pulse results with you.")).toBeInTheDocument();
  });

  test("a failed shares list degrades the own views and alerts on the shared view only", async () => {
    setup({ member: [{ id: 11, name: "AAA" }], sharesStatus: 500 });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    expect(await screen.findByRole("heading", { name: "AAA" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Shared with me" }));
    expect(await screen.findByText("Loading failed. Refresh to retry.")).toBeInTheDocument();
  });

  test("?view=shared&team= opens the shared view with that card marked; an explicit view wins over the stored pick", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.view", JSON.stringify("managed"));
    setup({
      member: [{ id: 11, name: "AAA" }],
      monitored: [{ id: 31, name: "MON" }],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer"), pulseShare(2, 22, "CCC", "Cy Sharer")],
    });
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&view=shared&team=22" });

    const marked = await screen.findByRole("heading", { name: "CCC" });
    expect(marked).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { name: "BBB" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("radio", { name: "Shared with me" })).toBeChecked();
    expect(screen.queryByRole("heading", { name: "MON" })).toBeNull();
    // The URL never rewrites the stored pick.
    expect(localStorage.getItem("lettuce.viewSettings.pulse.results.view")).toBe(JSON.stringify("managed"));
  });

  test("picking a view in the control drops the deep link's view and team", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
    });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&view=shared&team=21" });
    expect(await screen.findByRole("heading", { name: "BBB" })).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByRole("radio", { name: "Teams I belong to" }));
    expect(await screen.findByRole("heading", { name: "AAA" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("heading", { name: "BBB" })).toBeNull();
  });

  test("a bare ?team= (the sharer/author link) picks the first of the caller's own views holding that team", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      monitored: [{ id: 31, name: "MON" }],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
    });
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&team=31" });
    const marked = await screen.findByRole("heading", { name: "MON" });
    expect(marked).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("radio", { name: "Teams I manage" })).toBeChecked();
  });

  test("a bare ?team= held by none of the own views falls back to the shared view; a stale view/team falls through to the stored pick", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
    });
    const first = renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&team=21" });
    expect(await screen.findByRole("heading", { name: "BBB" })).toHaveAttribute("aria-current", "true");
    first.unmount();

    // An unknown view value and a team nobody holds: the stored (member) pick shows, nothing marked.
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&view=bogus&team=999" });
    expect(await screen.findByRole("heading", { name: "AAA" })).not.toHaveAttribute("aria-current");
  });

  test("an explicit ?view=all is ignored for a non-auditor", async () => {
    setup({ member: [{ id: 11, name: "AAA" }] });
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&view=all" });
    expect(await screen.findByRole("heading", { name: "AAA" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "All teams" })).toBeNull();
  });

  test("a caller with no own or managed teams but a share lands on the shared view by default", async () => {
    setup({ shares: [pulseShare(1, 21, "BBB", "Ann Sharer")] });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByRole("heading", { name: "BBB" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Shared with me" })).toBeChecked();
  });

  test("the shared view runs no fill-gate probe: a 403 there is a lapse on the card, never the gated empty state", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
      results: { 21: { status: 403, body: { title: "no", status: 403, detail: LAPSE } } },
    });
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&view=shared" });
    expect(
      await screen.findByText("The person who shared these results no longer has access to this cycle's results."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Results are available for closed cycles you took part in.")).toBeNull();
    expect(screen.queryByText("Could not load the results.")).toBeNull();
    // The card still names the sharer from the list; the only results request is the card's own.
    expect(screen.getByText("Shared by Ann Sharer")).toBeInTheDocument();
    expect(resultCalls()).toHaveLength(1);
    expect(resultCalls()[0]).toContain("teamId=21");
  });

  test("the probe skips a team shared with the caller: a share-granted 200 cannot prove the caller took part", async () => {
    // Member of 11 (shared by Ann — readable through her share) and 12 (no share). The caller sat the
    // cycle out: team 12 answers the plain fill-gate 403, so the page shows the gated state — while
    // the share-granted team 11 is STILL readable, with its sharer named.
    setup({
      member: [
        { id: 11, name: "AAA" },
        { id: 12, name: "BBB" },
      ],
      shares: [pulseShare(1, 11, "AAA", "Ann Sharer")],
      results: {
        11: { status: 200, body: { sharedBy: "Ann Sharer", canShare: false, canReadComments: false } },
        12: { status: 403 },
      },
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("Results are available for closed cycles you took part in.")).toBeInTheDocument();
    // The probe went to the unshared team, never the shared one.
    await waitFor(() => expect(resultCalls().some((u) => u.includes("teamId=12"))).toBe(true));
    expect(await screen.findByRole("heading", { name: "AAA" })).toBeInTheDocument();
    expect(screen.getByText("Shared by Ann Sharer")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "BBB" })).toBeNull();
  });

  test("a share-granted 200 on an own view renders 'Shared by' there and no gated state when an own-right read passes", async () => {
    setup({
      member: [
        { id: 11, name: "AAA" },
        { id: 12, name: "BBB" },
      ],
      shares: [pulseShare(1, 11, "AAA", "Ann Sharer")],
      results: { 11: { status: 200, body: { sharedBy: "Ann Sharer" } } },
    });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("Shared by Ann Sharer")).toBeInTheDocument();
    expect(screen.queryByText("Results are available for closed cycles you took part in.")).toBeNull();
    expect(screen.getByRole("heading", { name: "BBB" })).toBeInTheDocument();
    // Exactly one "Shared by": the unshared team's card carries none.
    expect(screen.getAllByText(/^Shared by /)).toHaveLength(1);
  });

  test("every team of an own view shared with the caller: no probe, so a lapse stays on its card", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      shares: [pulseShare(1, 11, "AAA", "Ann Sharer")],
      results: { 11: { status: 403, body: { title: "no", status: 403, detail: LAPSE } } },
    });
    renderWithProviders(<PulseResults />);
    expect(
      await screen.findByText("The person who shared these results no longer has access to this cycle's results."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Results are available for closed cycles you took part in.")).toBeNull();
    expect(resultCalls()).toHaveLength(1);
  });

  test("a lapse card hides the trend section (its 403 would read as 'trend pending')", async () => {
    setup({
      member: [],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
      results: { 21: { status: 403, body: { title: "no", status: 403, detail: LAPSE } } },
    });
    renderWithProviders(<PulseResults />);
    await screen.findByText("The person who shared these results no longer has access to this cycle's results.");
    expect(screen.queryByText("eNPS trend")).toBeNull();
  });

  test("the Share button follows canShare only — never sharedBy", async () => {
    setup({
      member: [
        { id: 11, name: "AAA" },
        { id: 12, name: "BBB" },
        { id: 13, name: "CCC" },
      ],
      results: {
        11: { status: 200, body: { canShare: true, sharedBy: null } },
        // An upgraded read: share-granted AND own-right → the button stays.
        12: { status: 200, body: { canShare: true, sharedBy: "Ann Sharer" } },
        // Share-only reader: sharedBy without the right to re-share → no button.
        13: { status: 200, body: { canShare: false, sharedBy: "Cy Sharer" } },
      },
    });
    renderWithProviders(<PulseResults />);
    await screen.findByRole("heading", { name: "AAA" });
    await screen.findByText("Shared by Cy Sharer");
    const cardOf = (name: string) => screen.getByRole("heading", { name }).closest(".mantine-Paper-root") as HTMLElement;
    expect(within(cardOf("AAA")).getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(within(cardOf("BBB")).getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(within(cardOf("CCC")).queryByRole("button", { name: "Share" })).toBeNull();
  });

  test("the Share button opens the pulse-worded dialog for the team", async () => {
    setup({
      member: [{ id: 11, name: "AAA" }],
      results: { 11: { status: 200, body: { canShare: true } } },
    });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    await user.click(await screen.findByRole("button", { name: "Share" }));
    expect(await screen.findByRole("dialog", { name: "Share these pulse results" })).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(
        ([url]) => String(url).includes("view=document") && String(url).includes("resourceId=11"),
      ),
    ).toBe(true);
  });

  test("comments are fetched only for a monitor or when the server says canReadComments", async () => {
    setup({
      member: [
        { id: 11, name: "AAA" },
        { id: 12, name: "BBB" },
      ],
      results: {
        11: { status: 200, body: { canReadComments: true } },
        12: { status: 200, body: { canReadComments: false } },
      },
    });
    renderWithProviders(<PulseResults />);
    // The share-passed comments of team 11 render; team 12 never asks.
    expect(await screen.findByText("shared comment")).toBeInTheDocument();
    expect(screen.getAllByText("shared comment")).toHaveLength(1);
    await waitFor(() => expect(commentCalls()).toHaveLength(1));
    expect(commentCalls()[0]).toContain("teamId=11");
  });

  test("a member-sharer's share carries no comments: canReadComments=false means no request at all", async () => {
    setup({
      member: [],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
      results: { 21: { status: 200, body: { sharedBy: "Ann Sharer", canReadComments: false } } },
    });
    renderWithProviders(<PulseResults />);
    await screen.findByText("Shared by Ann Sharer");
    expect(commentCalls()).toHaveLength(0);
    expect(screen.queryByText("Comments")).toBeNull();
  });

  test("the shared view, the lapse copy and the Shared-by line speak Polish", async () => {
    await i18n.changeLanguage("pl");
    setup({
      member: [{ id: 11, name: "AAA" }],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
      results: { 21: { status: 403, body: { title: "no", status: 403, detail: LAPSE } } },
    });
    renderWithProviders(<PulseResults />, { route: "/pulse?tab=results&view=shared" });
    expect(await screen.findByRole("radio", { name: "Udostępnione mi" })).toBeInTheDocument();
    expect(await screen.findByText("Osoba, która udostępniła te wyniki, nie ma już dostępu do wyników tego cyklu.")).toBeInTheDocument();
    expect(screen.getByText("Udostępnił/a: Ann Sharer")).toBeInTheDocument();
  });

  test("an explicit pick of 'Teams I belong to' keeps its empty state; only the untouched default redirects to shared", async () => {
    setup({ shares: [pulseShare(1, 21, "BBB", "Ann Sharer")] });
    const user = userEvent.setup();
    renderWithProviders(<PulseResults />);
    // Untouched default: lands on the shared view.
    expect(await screen.findByRole("heading", { name: "BBB" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Teams I belong to" }));
    expect(await screen.findByText("You are not a member of any team.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "BBB" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Teams I belong to" })).toBeChecked();
  });

  test("a stored 'member' pick (an explicit choice made earlier) is not redirected to shared either", async () => {
    localStorage.setItem("lettuce.viewSettings.pulse.results.view", JSON.stringify("member"));
    setup({ shares: [pulseShare(1, 21, "BBB", "Ann Sharer")] });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("You are not a member of any team.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "BBB" })).toBeNull();
  });

  test("a failed shares list does not stall the page, and a sat-out caller still gets the gated state from the plain 403", async () => {
    setup({ member: [{ id: 11, name: "AAA" }], sharesStatus: 500, results: { 11: { status: 403 } } });
    renderWithProviders(<PulseResults />);
    expect(await screen.findByText("Results are available for closed cycles you took part in.")).toBeInTheDocument();
    // One shares request only — no retry backoff holding the skeleton.
    expect(mockFetch.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/shares"))).toHaveLength(1);
  });

  test("with the shares list failed, a readable team shows its numbers and a lapse 403 is not mistaken for the gate", async () => {
    setup({
      member: [
        { id: 11, name: "AAA" },
        { id: 12, name: "BBB" },
      ],
      sharesStatus: 500,
      results: { 11: { status: 403, body: { title: "no", status: 403, detail: LAPSE } } },
    });
    renderWithProviders(<PulseResults />);
    // The probe lands on team 11 (nothing known to be shared): its lapse never gates the page.
    expect(
      await screen.findByText("The person who shared these results no longer has access to this cycle's results."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Results are available for closed cycles you took part in.")).toBeNull();
    expect(await screen.findByRole("heading", { name: "BBB" })).toBeInTheDocument();
    expect(await screen.findAllByText("+33")).toHaveLength(1);
  });

  test("a failed trend says it is unavailable, not that it appears after two cycles", async () => {
    setup({ member: [{ id: 11, name: "AAA" }] });
    const base = mockFetch.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes("/trend")
        ? Promise.resolve(jsonResponse(500, { title: "x", status: 500 }))
        : base(url, init),
    );
    renderWithProviders(<PulseResults />);
    await screen.findByText("eNPS trend");
    fireIntersect();
    expect(await screen.findByText("The trend is unavailable right now.")).toBeInTheDocument();
    expect(screen.queryByText("The trend appears after two closed cycles.")).toBeNull();
  });

  test("a 403 from comments on a share-granted card renders nothing alarming", async () => {
    setup({
      member: [],
      shares: [pulseShare(1, 21, "BBB", "Ann Sharer")],
      results: { 21: { status: 200, body: { sharedBy: "Ann Sharer", canReadComments: true } } },
    });
    const base = mockFetch.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes("/comments?")
        ? Promise.resolve(jsonResponse(403, { title: "no", status: 403, detail: "Not available" }))
        : base(url, init),
    );
    renderWithProviders(<PulseResults />);
    await screen.findByText("Shared by Ann Sharer");
    await waitFor(() => expect(commentCalls()).toHaveLength(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Comments")).toBeNull();
  });
});
