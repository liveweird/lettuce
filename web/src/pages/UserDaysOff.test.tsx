import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { jsonResponse } from "../test/http";
import UserDaysOff from "./UserDaysOff";

type FetchMock = ReturnType<typeof vi.fn>;

const BUDGET = {
  userId: 9,
  userName: "Riley Report",
  userDeleted: false,
  year: new Date().getFullYear(),
  allowance: 20,
  carriedOver: 1,
  corrected: 2.5,
  reserved: 0.5,
  used: 3,
  remaining: 20,
  canCorrect: true,
};

const ROW = {
  id: 5,
  userId: 9,
  userName: "Riley Report",
  userDeleted: false,
  type: "PAID",
  status: "REQUESTED",
  startDate: "2099-03-02",
  endDate: "2099-03-04",
  startHalf: false,
  endHalf: false,
  days: 3,
  createdAt: 1_754_000_000_000,
  lastModified: 1_754_000_000_000,
};

function renderPage(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/users/:userId/days-off" element={<UserDaysOff />} />
            <Route path="/days-off" element={<div>DAYS_OFF_HOME</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserDaysOff", () => {
  let mockFetch: FetchMock;

  function setupMocks(budget: typeof BUDGET = BUDGET) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/api/v1/days-off/allowance")) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.includes("/api/v1/days-off/budgets")) {
        return Promise.resolve(jsonResponse(200, { items: [budget] }));
      }
      if (u.includes("/api/v1/days-off/corrections")) {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      if (u.includes("/api/v1/days-off")) {
        // The capability flags are the server's honest answer per caller: the manager view
        // may resolve/cancel; the HR auditor (view=user) may not.
        const managed = u.includes("view=managed");
        return Promise.resolve(
          jsonResponse(200, {
            items: [{ ...ROW, canResolve: managed, canCancel: managed }],
            page: 1,
            pageSize: 20,
            total: 1,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "5");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("manager mode (from=subordinates): budget strip, corrections button, managed table with actions", async () => {
    setupMocks();
    renderPage("/users/9/days-off?name=Riley%20Report&from=subordinates");

    expect(await screen.findByRole("heading", { name: "Days off of Riley Report" })).toBeInTheDocument();
    // The budget strip for this one report (corrected shown signed).
    expect(await screen.findByText(/Paid days off of Riley Report in \d{4}/)).toBeInTheDocument();
    expect(screen.getByText("+2.5")).toBeInTheDocument();
    expect(screen.getByLabelText("Budget corrections of Riley Report")).toBeInTheDocument();
    // The managed table pins the user (person column hidden) and offers the manager actions.
    expect(await screen.findByText("Requested")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Accept the days-off request of Riley Report starting 2099-03-02"),
    ).toBeInTheDocument();
    const listCall = mockFetch.mock.calls.find(
      ([u]) => String(u).includes("/api/v1/days-off?") && String(u).includes("view=managed"),
    );
    expect(String(listCall?.[0])).toContain("userId=9");
    // Both fetches run in chain mode (v2.32.0) so the page works for indirect reports too.
    expect(String(listCall?.[0])).toContain("includeIndirect=true");
    const budgetsCall = mockFetch.mock.calls.find(([u]) => String(u).includes("/api/v1/days-off/budgets"));
    expect(String(budgetsCall?.[0])).toContain("includeIndirect=true");
  });

  test("the allowance pencil opens the editor and PUTs the new value (v2.32.0)", async () => {
    setupMocks();
    renderPage("/users/9/days-off?name=Riley%20Report&from=subordinates");

    await userEvent.click(
      await screen.findByLabelText("Edit the paid days-off allowance of Riley Report"),
    );
    // withAsterisk joins the * into the accessible name — prefix-match (the house gotcha).
    const input = await screen.findByLabelText(/^Allowance \(days per year\)/);
    expect(input).toHaveValue("20");
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/v1/days-off/allowance",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ userId: 9, allowance: 30 }) }),
      );
    });
  });

  test("a chain-only manager keeps the allowance editor but gets read-only corrections", async () => {
    // canCorrect=false marks a row whose user the caller manages only transitively — the
    // corrections write stays a direct-manager right, the allowance is chain-wide.
    setupMocks({ ...BUDGET, canCorrect: false });
    renderPage("/users/9/days-off?name=Riley%20Report&from=subordinates");

    expect(
      await screen.findByLabelText("Edit the paid days-off allowance of Riley Report"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText("Budget corrections of Riley Report"));
    expect(await screen.findByText("No corrections yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add correction" })).toBeNull();
  });

  test("a caller with no manager origin and no audit mode redirects to /days-off", async () => {
    setupMocks();
    renderPage("/users/9/days-off?name=Riley%20Report&from=managers");
    expect(await screen.findByText("DAYS_OFF_HOME")).toBeInTheDocument();
  });

  test("audit mode for a non-auditor falls back to the redirect too", async () => {
    // canAudit() is false without the HR role, so mode=audit is ignored and — with no
    // manager origin — the page redirects.
    setupMocks();
    renderPage("/users/9/days-off?name=Riley%20Report&from=details&mode=audit");
    expect(await screen.findByText("DAYS_OFF_HOME")).toBeInTheDocument();
  });

  test("HR audit mode renders the read-only user view with the corrections section", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["HR"]));
    setupMocks();
    renderPage("/users/9/days-off?name=Riley%20Report&from=details&mode=audit");

    expect(await screen.findByRole("heading", { name: "Days off of Riley Report" })).toBeInTheDocument();
    expect(await screen.findByText("Requested")).toBeInTheDocument();
    // Read-only: no accept/reject, but the corrections list section is present.
    expect(screen.queryByLabelText(/Accept the days-off request/)).toBeNull();
    expect(await screen.findByText("No corrections yet.")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls.find(([u]) => String(u).includes("view=user"));
    expect(String(listCall?.[0])).toContain("userId=9");
  });
});
