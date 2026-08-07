import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardHero from "./DashboardHero";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

const MANAGER_SUMMARY = {
  pendingFeedbackRequests: 2,
  activeGoals: 3,
  feedbackReceived30d: 5,
  directReports: 7,
  currentPeriodId: 4,
  currentPeriodReviewsDone: 3,
};

function renderHero() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DashboardHero />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("DashboardHero", () => {
  let mockFetch: FetchMock;

  function setupMocks(summary: unknown, status = 200) {
    mockFetch = vi.fn(() => Promise.resolve(jsonResponse(status, summary)));
    vi.stubGlobal("fetch", mockFetch);
  }

  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a manager gets all five tiles, each linking to its screen", async () => {
    setupMocks(MANAGER_SUMMARY);
    renderHero();

    expect(await screen.findByText("Feedback requests for you")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Your active goals")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Feedback received · 30 days")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Direct reports")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // The reviews tile reads done/total (total = direct reports).
    expect(screen.getByText("Reviews · current period")).toBeInTheDocument();
    expect(screen.getByText("3/7")).toBeInTheDocument();

    const requestsTile = screen.getByText("Feedback requests for you").closest("a");
    expect(requestsTile).toHaveAttribute("href", "/feedback?tab=provided");
    const reviewsTile = screen.getByText("Reviews · current period").closest("a");
    expect(reviewsTile).toHaveAttribute("href", "/performance?tab=managed");
  });

  test("a non-manager sees only the three universal tiles", async () => {
    setupMocks({ ...MANAGER_SUMMARY, directReports: 0, currentPeriodId: null, currentPeriodReviewsDone: null });
    renderHero();

    expect(await screen.findByText("Your active goals")).toBeInTheDocument();
    expect(screen.queryByText("Direct reports")).toBeNull();
    expect(screen.queryByText("Reviews · current period")).toBeNull();
  });

  test("a manager without a current review period loses only the reviews tile", async () => {
    setupMocks({ ...MANAGER_SUMMARY, currentPeriodId: null, currentPeriodReviewsDone: null });
    renderHero();

    expect(await screen.findByText("Direct reports")).toBeInTheDocument();
    expect(screen.queryByText("Reviews · current period")).toBeNull();
  });

  test("the received tile shows the vs-previous-window trend when the field is present", async () => {
    setupMocks({ ...MANAGER_SUMMARY, feedbackReceivedPrev30d: 2 });
    renderHero();

    // 5 now vs 2 before → "+3", its own text node next to the caption.
    expect(await screen.findByText("+3")).toBeInTheDocument();
    expect(screen.getByText("vs previous 30 days")).toBeInTheDocument();
    // The bare value still renders separately (locator stability).
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  test("a negative delta renders signed; a missing field renders no trend (older server)", async () => {
    setupMocks({ ...MANAGER_SUMMARY, feedbackReceivedPrev30d: 9 });
    renderHero();
    expect(await screen.findByText("-4")).toBeInTheDocument();

    // Without the field (MANAGER_SUMMARY carries none) the tile shows no trend line at all.
    // within(container): the render-result queries bind to document.body, where the first
    // hero (with its trend) is still mounted.
    setupMocks(MANAGER_SUMMARY);
    const second = renderHero();
    await vi.waitFor(() =>
      expect(second.container.querySelectorAll("a").length).toBeGreaterThan(0),
    );
    expect(within(second.container as HTMLElement).queryByText("vs previous 30 days")).toBeNull();
  });

  test("disabled features drop their tiles; the remaining tiles stay (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["FEEDBACKS", "GOALS"]));
    try {
      setupMocks(MANAGER_SUMMARY);
      renderHero();

      // The directReports and reviews tiles survive…
      expect(await screen.findByText("Direct reports")).toBeInTheDocument();
      expect(screen.getByText("Reviews · current period")).toBeInTheDocument();
      // …while both feedback tiles and the goals tile are gone.
      expect(screen.queryByText("Feedback requests for you")).toBeNull();
      expect(screen.queryByText("Feedback received · 30 days")).toBeNull();
      expect(screen.queryByText("Your active goals")).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });

  test("renders nothing on error or malformed data — the hero never breaks the dashboard", async () => {
    setupMocks({ items: [] }); // a wrong-shaped 200 (e.g. a stale mock/proxy)
    const { container } = renderHero();
    // Wait past the loading skeletons, then nothing.
    await vi.waitFor(() => expect(container.querySelectorAll("a")).toHaveLength(0));
    expect(screen.queryByText("Your active goals")).toBeNull();
  });
});
