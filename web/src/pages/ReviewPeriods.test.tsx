import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReviewPeriods from "./ReviewPeriods";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLES_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;

const PERIODS = [
  { id: 4, startMonth: "2025-07", endMonth: "2025-12" },
  { id: 5, startMonth: "2026-01", endMonth: "2026-06" },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review-periods"]}>
          <Routes>
            <Route path="/review-periods" element={<ReviewPeriods />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ReviewPeriods page", () => {
  let mockFetch: FetchMock;

  function setupMocks(periods: unknown[] = PERIODS) {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(jsonResponse(201, { id: 6, startMonth: "2026-07", endMonth: "2026-12" }));
      }
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(200, { items: periods }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLES_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("non-admins are navigated away without firing the query", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify([]));
    setupMocks();
    renderPage();
    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("lists the timeline, locks the next start to the adjacent month, and appends", async () => {
    setupMocks();
    renderPage();

    expect(await screen.findByText("July 2025 – December 2025")).toBeInTheDocument();
    expect(screen.getByText("January 2026 – June 2026")).toBeInTheDocument();
    // The start input is locked to the month after the latest end.
    const start = screen.getByLabelText("First month");
    expect(start).toHaveValue("2026-07");
    expect(start).toBeDisabled();
    expect(screen.getByText("Fixed: the month after the latest period ends.")).toBeInTheDocument();
    // Only the LATEST row offers Delete.
    expect(screen.getAllByRole("button", { name: /^Delete the period/ })).toHaveLength(1);

    const add = screen.getByRole("button", { name: "Add period" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Last month"), { target: { value: "2026-12" } });
    await userEvent.click(add);

    await waitFor(() => {
      const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        startMonth: "2026-07",
        endMonth: "2026-12",
      });
    });
  });

  test("an empty timeline frees the start month and shows the empty state", async () => {
    setupMocks([]);
    renderPage();

    expect(
      await screen.findByText("No review periods yet — add the first one below."),
    ).toBeInTheDocument();
    const start = screen.getByLabelText("First month");
    expect(start).toBeEnabled();
    fireEvent.change(start, { target: { value: "2026-01" } });
    fireEvent.change(screen.getByLabelText("Last month"), { target: { value: "2025-12" } });
    // End before start keeps the append disabled.
    expect(screen.getByRole("button", { name: "Add period" })).toBeDisabled();
  });

  test("deleting the latest period confirms first; a 409 maps to the referenced message", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        return Promise.resolve(
          jsonResponse(409, { type: "about:blank", title: "Conflict", status: 409 }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: PERIODS }));
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /^Delete the period/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("Only the latest period without any reviews can be deleted."),
    ).toBeInTheDocument();
  });
});
