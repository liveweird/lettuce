import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditPerformanceReview from "./EditPerformanceReview";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const DRAFT = {
  id: 5,
  managerId: 7,
  managerName: "Mona Manager",
  subordinateId: 8,
  subordinateName: "Sub Ordinate",
  periodId: 4,
  periodStartMonth: "2026-01",
  periodEndMonth: "2026-06",
  status: "DRAFT",
  attitude: { rating: 4, summary: "Positive influence." },
  delivery: { rating: 3, summary: "Delivers." },
  skills: { rating: 5, summary: "Deep knowledge." },
  overall: { rating: null, summary: null },
  createdAt: 1, lastModified: 1,
};

function renderScreen(path = "/performance-reviews/5/edit?back=%2Fperformance%3Ftab%3Dmanaged") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/performance-reviews/:id/edit" element={<EditPerformanceReview />} />
            <Route path="/performance-reviews/:id/view" element={<div>VIEW SCREEN</div>} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("EditPerformanceReview page", () => {
  let mockFetch: FetchMock;

  function setupMocks(review: unknown = DRAFT) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PUT" || method === "POST" || method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
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
    localStorage.setItem(USER_ID_KEY, "7"); // the manager
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("the DRAFT editor seeds the four categories and saves the full replace", async () => {
    setupMocks();
    renderScreen();

    // The heading renders before the document (v3.5.0 PageHeader) — wait for a seeded field.
    // Seeded values: the set rating shows number + wording, summaries land in the textareas.
    expect(await screen.findByDisplayValue("Positive influence.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("4 — Sometimes exceeds expectations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit performance review" })).toBeInTheDocument();

    // Change the overall rating and save.
    fireEvent.click(screen.getByLabelText("Overall", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "6 — Exceptional" }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("/performance?tab=managed"));
    const put = mockFetch.mock.calls.find((c) => c[1]?.method === "PUT");
    const body = JSON.parse(String(put![1]!.body));
    expect(body.overall).toEqual({ rating: 6, summary: null });
    expect(body.attitude).toEqual({ rating: 4, summary: "Positive influence." });
  });

  test("Save & submit refuses an incomplete draft client-side, then submits once complete", async () => {
    setupMocks();
    renderScreen();

    await screen.findByDisplayValue("Positive influence.");
    await userEvent.click(screen.getByRole("button", { name: "Save & submit" }));
    expect(
      await screen.findByText("All four ratings and summaries must be filled in first."),
    ).toBeInTheDocument();
    expect(mockFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);

    // Complete the overall category — the submit goes through: PUT then POST /submit.
    fireEvent.click(screen.getByLabelText("Overall", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "4 — Sometimes exceeds expectations" }));
    await userEvent.type(screen.getAllByLabelText("Summary")[3], "Rounded, reliable half-year.");
    await userEvent.click(screen.getByRole("button", { name: "Save & submit" }));

    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("/performance?tab=managed"));
    expect(mockFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(true);
    const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST");
    expect(String(post![0])).toContain("/api/v1/performance-reviews/5/submit");
  });

  test("the CALIBRATION editor blocks blanking a value and drops the submit/delete affordances", async () => {
    setupMocks({
      ...DRAFT,
      status: "CALIBRATION",
      overall: { rating: 4, summary: "Complete now." },
    });
    renderScreen();

    await screen.findByDisplayValue("Positive influence.");
    expect(
      screen.getByText("The review is in calibration — values may change but can no longer be emptied."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save & submit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    // Blank a summary → the client-side completeness rule blocks the save.
    await userEvent.clear(screen.getAllByLabelText("Summary")[0]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("All four ratings and summaries must be filled in first."),
    ).toBeInTheDocument();
    expect(mockFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
  });

  test("DRAFT delete confirms, deletes, and returns; non-managers and PUBLISHED redirect to the view", async () => {
    setupMocks();
    renderScreen();

    await screen.findByDisplayValue("Positive influence.");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    // The confirm modal's red Delete fires the DELETE and navigates back.
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(mockFetch.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true),
    );

    // A PUBLISHED review bounces to the read-only view.
    vi.clearAllMocks();
    setupMocks({ ...DRAFT, status: "PUBLISHED" });
    renderScreen();
    expect(await screen.findByText("VIEW SCREEN")).toBeInTheDocument();
  });

  test("a non-manager viewer is redirected to the view screen", async () => {
    localStorage.setItem(USER_ID_KEY, "8"); // the subordinate
    setupMocks();
    renderScreen();
    expect(await screen.findByText("VIEW SCREEN")).toBeInTheDocument();
  });
});
