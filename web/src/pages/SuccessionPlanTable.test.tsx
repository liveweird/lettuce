import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SuccessionPlanTable from "./SuccessionPlanTable";
import { theme } from "../theme";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

const NOW = Date.now();

const PLAN_ROWS = {
  items: [
    {
      id: 1,
      managerId: 7,
      managerName: "Me Manager",
      userId: 8,
      userName: "Sam Seat",
      userDeleted: false,
      roleCriticality: "CRITICAL",
      retentionRisk: "HIGH",
      targetBenchDepth: 2,
      benchCount: 1,
      status: "OPEN",
      createdAt: NOW - 86_400_000,
      lastReviewedAt: NOW - 86_400_000,
    },
    {
      id: 2,
      managerId: 7,
      managerName: "Me Manager",
      userId: 9,
      userName: "Cleo Candidate",
      userDeleted: false,
      roleCriticality: "STANDARD",
      retentionRisk: "LOW",
      targetBenchDepth: 2,
      benchCount: 2,
      status: "CLOSED",
      createdAt: NOW - 86_400_000,
      lastReviewedAt: NOW - 86_400_000,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
};

function renderTable(view: "own" | "team" | "user" = "own", userId?: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("/api/v1/succession-plans/") && init?.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u.startsWith("/api/v1/succession-plans?")) {
      return Promise.resolve(jsonResponse(200, PLAN_ROWS));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SuccessionPlanTable view={view} userId={userId} />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("SuccessionPlanTable", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("rows carry badges, the bench tally, and the relative reviewed time", async () => {
    renderTable();

    expect(await screen.findByText("Sam Seat")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // The under-target bench warns; the met bench doesn't.
    expect(
      screen.getByLabelText("Bench below target: 1 of 2 successors nominated"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Bench at target: 2 of 2 successors nominated"),
    ).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getAllByText("yesterday")).toHaveLength(2);
    // The own view has no Owner column.
    expect(screen.queryByRole("button", { name: "Owner" })).toBeNull();
  });

  test("rows offer Review for everyone and Delete for the owner only — Edit is gone (v2.44.0)", async () => {
    const user = userEvent.setup();
    renderTable();

    // Every row gets Review (the screen renders read-only where the caller can't write)…
    expect(
      await screen.findByLabelText("Review the succession plan for Sam Seat"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Review the succession plan for Cleo Candidate"),
    ).toBeInTheDocument();
    // …the owner keeps Delete at any status (behind each row's ⋯ menu since v3.4.0), and
    // the Edit action no longer exists.
    expect(screen.getAllByRole("button", { name: /^More actions for / })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "More actions for Sam Seat" }));
    expect(
      await screen.findByLabelText("Delete the succession plan for Sam Seat"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Edit the succession plan/)).toBeNull();
  });

  test("a non-owner viewer (team view) sees the Owner column and no mutating actions", async () => {
    localStorage.setItem(USER_ID_KEY, "99");
    renderTable("team");

    expect(await screen.findByText("Sam Seat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owner" })).toBeInTheDocument();
    expect(screen.getAllByText("Me Manager")).toHaveLength(2);
    expect(
      screen.getByLabelText("Review the succession plan for Sam Seat"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Delete the succession plan for Sam Seat")).toBeNull();
  });

  test("deleting a plan confirms first, then DELETEs and refetches", async () => {
    const user = userEvent.setup();
    const mockFetch = renderTable();

    await user.click(await screen.findByRole("button", { name: "More actions for Sam Seat" }));
    await user.click(await screen.findByLabelText("Delete the succession plan for Sam Seat"));
    expect(
      await screen.findByText(
        "Delete the succession plan for Sam Seat? Its nominations go with it. This cannot be undone.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/v1/succession-plans/1" &&
            (init as RequestInit | undefined)?.method === "DELETE",
        ),
      ).toBe(true);
    });
  });

  test("the status filter narrows the query", async () => {
    const user = userEvent.setup();
    const mockFetch = renderTable();
    await screen.findByText("Sam Seat");

    // The filters sit behind the collapsed FilterPanel.
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByLabelText("Status", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Open" }));
    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(([url]) => String(url).includes("status=OPEN")),
      ).toBe(true);
    });
  });
});
