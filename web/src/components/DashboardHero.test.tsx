import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(reviewsTile).toHaveAttribute("href", "/?tab=reviews");
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

  test("renders nothing on error or malformed data — the hero never breaks the dashboard", async () => {
    setupMocks({ items: [] }); // a wrong-shaped 200 (e.g. a stale mock/proxy)
    const { container } = renderHero();
    // Wait past the loading skeletons, then nothing.
    await vi.waitFor(() => expect(container.querySelectorAll("a")).toHaveLength(0));
    expect(screen.queryByText("Your active goals")).toBeNull();
  });
});
