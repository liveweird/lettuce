import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewPerformanceReview from "./ViewPerformanceReview";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const REVIEW = {
  id: 5,
  managerId: 7,
  managerName: "Mona Manager",
  subordinateId: 8,
  subordinateName: "Sub Ordinate",
  periodId: 4,
  periodStartMonth: "2026-01",
  periodEndMonth: "2026-06",
  status: "CALIBRATION",
  attitude: { rating: 4, summary: "Positive influence on the team." },
  delivery: { rating: 3, summary: "Delivers what was agreed." },
  skills: { rating: 5, summary: "Deep platform knowledge." },
  overall: { rating: null, summary: null },
  createdAt: new Date(2026, 6, 1).getTime(),
  lastModified: new Date(2026, 6, 1).getTime(),
};

function renderScreen(path = "/performance-reviews/5/view") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/performance-reviews/:id/view" element={<ViewPerformanceReview />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ViewPerformanceReview page", () => {
  let mockFetch: FetchMock;

  function setupMocks(review: unknown = REVIEW) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") return Promise.resolve(new Response(null, { status: 204 }));
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (u.includes("/api/v1/performance-reviews/5")) {
        return Promise.resolve(jsonResponse(200, review));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "8"); // the subordinate by default
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the document: parties, period, ratings with their wording, summaries", async () => {
    setupMocks({ ...REVIEW, status: "PUBLISHED" });
    renderScreen();

    expect(await screen.findByText("Mona Manager")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument(); // the subordinate is the viewer
    expect(screen.getByText("January 2026 – June 2026")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    // Ratings render as the colored badge number + the wording beside it (v1.33.1).
    expect(screen.getByText("Sometimes exceeds expectations")).toBeInTheDocument();
    expect(screen.getByText("Exceeds expectations")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Positive influence on the team.")).toBeInTheDocument();
    // The unfilled category dims instead of breaking.
    expect(screen.getByText("Not rated yet")).toBeInTheDocument();
    expect(screen.getByText("No summary yet.")).toBeInTheDocument();
    // A non-manager gets no edit or lifecycle affordances.
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  test("the manager's CALIBRATION view offers Return to draft + Publish; publishing navigates back", async () => {
    localStorage.setItem(USER_ID_KEY, "7"); // the manager views
    setupMocks();
    renderScreen("/performance-reviews/5/view?back=%2F%3Ftab%3Dreviews");

    expect(await screen.findByRole("button", { name: "Return to draft" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("/?tab=reviews"));
    const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(String(post![0])).toContain("/api/v1/performance-reviews/5/publish");
  });

  test("per-status actions: DRAFT submits, PUBLISHED unpublishes (manager only)", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    setupMocks({ ...REVIEW, status: "DRAFT" });
    renderScreen();
    expect(await screen.findByRole("button", { name: "Submit for calibration" })).toBeInTheDocument();

    cleanup();
    setupMocks({ ...REVIEW, status: "PUBLISHED" });
    renderScreen();
    expect(await screen.findByRole("button", { name: "Unpublish" })).toBeInTheDocument();
    // A published review is read-only — no Edit link even for the manager.
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });

  test("an incomplete draft's submit maps the 400 to the completeness message", async () => {
    localStorage.setItem(USER_ID_KEY, "7");
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(
          jsonResponse(400, { type: "about:blank", title: "Bad Request", status: 400 }),
        );
      }
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, { ...REVIEW, status: "DRAFT" }));
    });
    renderScreen();

    await userEvent.click(await screen.findByRole("button", { name: "Submit for calibration" }));
    expect(
      await screen.findByText("All four ratings and summaries must be filled in first."),
    ).toBeInTheDocument();
  });
});
