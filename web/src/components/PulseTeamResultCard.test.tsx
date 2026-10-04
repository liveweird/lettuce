import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import PulseTeamResultCard from "./PulseTeamResultCard";
import { jsonResponse } from "../test/http";
import { fireIntersect, installIntersectionObserver } from "../test/intersection";
import { theme } from "../theme";

vi.mock("@mantine/charts", () => ({
  LineChart: (props: { data: unknown }) => <div data-testid="trend-chart" data-points={JSON.stringify(props.data)} />,
  ChartTooltip: () => null,
}));

const TREND = {
  teamId: 11,
  teamName: "AAA",
  mode: "direct",
  points: [
    { cycleId: 4, closedAt: 400, availability: "OK", enps: 21, responseCount: 3, responseRate: 75 },
    { cycleId: 5, closedAt: 500, availability: "OK", enps: 33, responseCount: 3, responseRate: 75 },
  ],
};

const RESULTS = {
  cycleId: 5,
  teamId: 11,
  teamName: "AAA",
  mode: "direct",
  responseCount: 3,
  participantCount: 4,
  responseRate: 75,
  insufficientResponses: false,
  canShare: false,
  canReadComments: false,
  enps: { score: 33, promoterPct: 66.7, passivePct: 0, detractorPct: 33.3 },
  drivers: [],
};

/** The card in isolation, on a caller-owned QueryClient (so a test can seed the cache). */
function renderCard(ui: ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("PulseTeamResultCard — lazy trend (v4.15.0)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  const calls = (needle: string) => mockFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes(needle));

  beforeEach(() => {
    mockFetch = vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/trend")) return Promise.resolve(jsonResponse(200, TREND));
      if (u.includes("/comments")) {
        return Promise.resolve(jsonResponse(200, { items: ["a comment"], responseCount: 3, insufficientResponses: false }));
      }
      if (u.includes("/results")) return Promise.resolve(jsonResponse(200, RESULTS));
      return Promise.resolve(jsonResponse(200, {}));
    });
    vi.stubGlobal("fetch", mockFetch);
    installIntersectionObserver();
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("not intersecting: no /trend request; scrolling in fetches once; scrolling back out keeps the chart", async () => {
    renderCard(<PulseTeamResultCard cycleId={5} teamId={11} teamName="AAA" mode="direct" canMonitor={false} />);
    await screen.findByText("+33");
    expect(calls("/trend")).toHaveLength(0);
    // An explicit "not intersecting" report changes nothing.
    fireIntersect(undefined, false);
    expect(calls("/trend")).toHaveLength(0);

    fireIntersect();
    expect(await screen.findByTestId("trend-chart")).toBeInTheDocument();
    expect(calls("/trend")).toHaveLength(1);

    // Scrolled back out: the latch holds, the chart stays, nothing is refetched.
    fireIntersect(undefined, false);
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    fireIntersect();
    expect(calls("/trend")).toHaveLength(1);
  });

  test("aria-busy is true only while the trend is actually fetching", async () => {
    renderCard(<PulseTeamResultCard cycleId={5} teamId={11} teamName="AAA" mode="direct" canMonitor={false} />);
    await screen.findByText("+33");
    const section = screen.getByText("eNPS trend").closest("[aria-busy]")!;
    // Off-screen card: the query is disabled (pending forever) — not busy.
    expect(section.getAttribute("aria-busy")).toBe("false");
    fireIntersect();
    await waitFor(() => expect(screen.getByTestId("trend-chart")).toBeInTheDocument());
    expect(section.getAttribute("aria-busy")).toBe("false");
  });

  test("a trend already cached under [pulseTrend, teamId, mode] renders with no intersection and no request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["pulseTrend", 11, "direct"], TREND);
    renderCard(
      <PulseTeamResultCard cycleId={5} teamId={11} teamName="AAA" mode="direct" canMonitor={false} />,
      client,
    );
    expect(await screen.findByTestId("trend-chart")).toBeInTheDocument();
    expect(calls("/trend")).toHaveLength(0);
  });

  test("a commentsOnly card never requests /trend (nor /results), intersecting or not", async () => {
    renderCard(<PulseTeamResultCard cycleId={5} teamId={11} teamName="AAA" mode="direct" canMonitor commentsOnly />);
    expect(await screen.findByText("a comment")).toBeInTheDocument();
    // There is no trend section to observe at all.
    expect(fireIntersect()).toBe(0);
    expect(calls("/trend")).toHaveLength(0);
    expect(calls("/results")).toHaveLength(0);
  });
});
