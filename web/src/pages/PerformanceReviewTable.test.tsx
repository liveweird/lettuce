import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PerformanceReviewTable from "./PerformanceReviewTable";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

const PERIODS = [
  { id: 4, startMonth: "2025-07", endMonth: "2025-12" },
  { id: 5, startMonth: "2026-01", endMonth: "2026-06" },
];

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    managerId: 7,
    managerName: "Mona Manager",
    managerDeleted: false,
    subordinateId: 8,
    subordinateName: "Sub Ordinate",
    subordinateDeleted: false,
    periodId: 5,
    periodStartMonth: "2026-01",
    periodEndMonth: "2026-06",
    status: "DRAFT",
    attitudeRating: 3,
    deliveryRating: null,
    skillsRating: 5,
    overallRating: 4,
    createdAt: new Date(2026, 6, 1).getTime(),
    lastModified: new Date(2026, 6, 1).getTime(),
    ...overrides,
  };
}

function setupMocks(mockFetch: FetchMock, items: unknown[]) {
  mockFetch.mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes("/api/v1/review-periods")) {
      return Promise.resolve(jsonResponse(200, { items: PERIODS }));
    }
    return Promise.resolve(
      jsonResponse(200, { items, page: 1, pageSize: 20, total: items.length }),
    );
  });
}

function renderTable(props: Partial<Parameters<typeof PerformanceReviewTable>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PerformanceReviewTable view="own" {...props} />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("PerformanceReviewTable", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "8");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("own view shows the manager column, the formatted period, ratings, and a View action", async () => {
    setupMocks(mockFetch, [row({ status: "PUBLISHED" })]);
    renderTable();

    expect(await screen.findByText("Mona Manager")).toBeInTheDocument();
    expect(screen.getByText("January 2026 – June 2026")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    // Ratings as bare numbers; the unset one dims to a dash.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
    // The subordinate is the viewer, never the editor.
    expect(
      screen.getByRole("link", { name: "View the performance review of Sub Ordinate" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Edit/ })).toBeNull();
    // The list query carried the view.
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=own");
    expect(listCall).toContain("sort=-createdAt");
  });

  test("the manager's DRAFT rows offer Edit, CALIBRATION rows View; a drill-down pin hides its column", async () => {
    localStorage.setItem(USER_ID_KEY, "7"); // the manager views
    setupMocks(mockFetch, [row(), row({ id: 12, status: "CALIBRATION" })]);
    renderTable({ view: "managed", subordinateId: 8, includeIndirect: true, backTo: "/x" });

    const edits = await screen.findAllByRole("link", {
      name: "Edit the performance review of Sub Ordinate",
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]).toHaveAttribute(
      "href",
      "/performance-reviews/11/edit?from=managed&back=%2Fx",
    );
    // The CALIBRATION row goes to the view screen, which owns Publish/Return to draft.
    expect(
      screen.getByRole("link", { name: "View the performance review of Sub Ordinate" }),
    ).toHaveAttribute("href", "/performance-reviews/12/view?from=managed&back=%2Fx");
    // The pinned subordinate column is hidden — the page already names the person.
    expect(screen.queryByText("Sub Ordinate")).toBeNull();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("subordinateId=8");
    expect(listCall).toContain("includeIndirect=true");
  });

  test("the user (auditor) view shows both person columns and passes userId", async () => {
    setupMocks(mockFetch, [row()]);
    renderTable({ view: "user", userId: 8 });

    expect(await screen.findByText("Mona Manager")).toBeInTheDocument();
    // Both party columns render (the subordinate is the viewer → plain "You" text).
    expect(screen.getByText("You")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/performance-reviews?"));
    expect(listCall).toContain("view=user");
    expect(listCall).toContain("userId=8");
  });

  test("an empty list renders the empty state", async () => {
    setupMocks(mockFetch, []);
    renderTable();
    expect(await screen.findByText("No performance reviews")).toBeInTheDocument();
  });
});
