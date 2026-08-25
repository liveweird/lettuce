import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditSuccessionNomination from "./EditSuccessionNomination";
import { theme } from "../theme";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

const NOMINATION = {
  id: 31,
  planId: 5,
  candidateId: 9,
  candidateName: "Cleo Candidate",
  readiness: "READY_SOON",
  nominationType: "PRIMARY",
  competencyGaps: ["Stakeholder management"],
  awareness: "IMPLICIT",
  goals: [{ id: 11, title: "Lead the on-call rotation", status: "ACTIVE", type: "NUMBER" }],
  createdAt: 1,
  lastModified: 2,
};

const PLAN = {
  id: 5,
  managerId: 7,
  managerName: "Me Manager",
  userId: 8,
  userName: "Sam Seat",
  roleCriticality: "CRITICAL",
  retentionRisk: "HIGH",
  lossImpact: [],
  targetBenchDepth: 2,
  status: "OPEN",
  benchCount: 1,
  nominations: [NOMINATION],
  createdAt: 1,
  lastReviewedAt: 1,
};

const USERS = {
  items: [
    { id: 7, name: "Me Manager", email: "me@x", roles: [], deactivated: false },
    { id: 8, name: "Sam Seat", email: "sam@x", roles: [], deactivated: false },
    { id: 9, name: "Cleo Candidate", email: "cleo@x", roles: [], deactivated: false },
    { id: 10, name: "Lena Lateral", email: "lena@x", roles: [], deactivated: false },
    { id: 12, name: "Dora Dormant", email: "dora@x", roles: [], deactivated: true },
  ],
  page: 1,
  pageSize: 100,
  total: 5,
};

// Cleo (9) is in the caller's chain; Lena (10) is the cross-team candidate outside it.
const REPORTS = {
  items: [
    { userId: 8, name: "Sam Seat", email: "sam@x", teamId: 1, teamName: "alpha" },
    { userId: 9, name: "Cleo Candidate", email: "cleo@x", teamId: 1, teamName: "alpha" },
  ],
  page: 1,
  pageSize: 100,
  total: 2,
};

const CANDIDATE_GOALS = {
  items: [
    { id: 11, managerId: 7, managerName: "Me Manager", subordinateId: 9, subordinateName: "Cleo Candidate", title: "Lead the on-call rotation", type: "NUMBER", status: "ACTIVE", targetValue: 4, targetDirection: "AT_LEAST", currentValue: null, milestonesDone: null, milestonesTotal: null, createdAt: 1, dueDate: "2027-12-31", lastModified: 1, managerDeleted: false, subordinateDeleted: false },
    { id: 12, managerId: 7, managerName: "Me Manager", subordinateId: 9, subordinateName: "Cleo Candidate", title: "Present to the board", type: "NUMBER", status: "DRAFT", targetValue: 1, targetDirection: "AT_LEAST", currentValue: null, milestonesDone: null, milestonesTotal: null, createdAt: 1, dueDate: "2027-12-31", lastModified: 1, managerDeleted: false, subordinateDeleted: false },
  ],
  page: 1,
  pageSize: 100,
  total: 2,
};

function renderScreen(route: string, plan: Record<string, unknown> = PLAN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u === "/api/v1/succession-plans/5/nominations" && method === "POST") {
      return Promise.resolve(jsonResponse(201, NOMINATION));
    }
    if (u === "/api/v1/succession-plans/5/nominations/31" && method === "PUT") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u === "/api/v1/succession-plans/5") {
      return Promise.resolve(jsonResponse(200, plan));
    }
    if (u.startsWith("/api/v1/users?")) {
      return Promise.resolve(jsonResponse(200, USERS));
    }
    if (u.includes("/api/v1/teams/members")) {
      return Promise.resolve(jsonResponse(200, REPORTS));
    }
    if (u.startsWith("/api/v1/goals?")) {
      return Promise.resolve(jsonResponse(200, CANDIDATE_GOALS));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/succession/:id/nominations/new" element={<EditSuccessionNomination />} />
            <Route
              path="/succession/:id/nominations/:nominationId/edit"
              element={<EditSuccessionNomination />}
            />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("EditSuccessionNomination page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("create: the candidate pool excludes the seat person, the deactivated, and the already-nominated", async () => {
    const user = userEvent.setup();
    renderScreen("/succession/5/nominations/new");

    expect(
      await screen.findByRole("heading", { name: "New successor nomination" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByLabelText("Candidate", { selector: "input" }));
    const options = await screen.findAllByRole("option");
    const names = options.map((o) => o.textContent);
    // Lena (outside the chain) and the caller themselves stay pickable; Sam (the seat),
    // Dora (deactivated), and Cleo (already nominated) drop out.
    expect(names).toContain("Lena Lateral");
    expect(names).toContain("Me Manager");
    expect(names).not.toContain("Sam Seat");
    expect(names).not.toContain("Dora Dormant");
    expect(names).not.toContain("Cleo Candidate");
  });

  test("create: an in-chain candidate unlocks the goal picker and the New-goal modal button; submit POSTs", async () => {
    const user = userEvent.setup();
    // Free Cleo's slot so she is pickable: a plan copy without her nomination.
    const mockFetch = renderScreen("/succession/5/nominations/new", { ...PLAN, nominations: [] });

    await user.click(await screen.findByLabelText("Candidate", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Cleo Candidate" }));

    // The goal picker fills from the candidate's linkable pool…
    await user.click(screen.getByLabelText("Development action items", { selector: "input" }));
    expect(await screen.findByRole("option", { name: "Lead the on-call rotation (Active)" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Present to the board (Draft)" }));
    await user.keyboard("{Escape}");
    // …and the in-chain candidate unlocks the goal-create modal entry.
    expect(screen.getByRole("button", { name: "New development goal" })).toBeInTheDocument();

    await user.click(screen.getByLabelText("Readiness window", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Ready now (0–3 mo)" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/v1/succession-plans/5/nominations" &&
          (init as RequestInit | undefined)?.method === "POST",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        candidateId: 9,
        readiness: "READY_NOW",
        nominationType: "PRIMARY",
        competencyGaps: [],
        awareness: "IMPLICIT",
        goalIds: [12],
      });
    });
    expect(await screen.findByTestId("probe")).toHaveTextContent("/succession/5/view");
  });

  test("create: an out-of-chain candidate gets no New-goal button (the server would 403 the create)", async () => {
    const user = userEvent.setup();
    renderScreen("/succession/5/nominations/new");

    await user.click(await screen.findByLabelText("Candidate", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Lena Lateral" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "New development goal" })).toBeNull();
    });
  });

  test("edit: seeds the whole document including the linked goals, saves via PUT", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen("/succession/5/nominations/31/edit");

    expect(
      await screen.findByRole("heading", { name: "Edit successor nomination" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Candidate", { selector: "input" })).toHaveValue(
      "Cleo Candidate",
    );
    expect(screen.getByLabelText("Readiness window", { selector: "input" })).toHaveValue(
      "Ready soon (3–12 mo)",
    );
    expect(screen.getByDisplayValue("Stakeholder management")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Candidate awareness", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Transparent" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/v1/succession-plans/5/nominations/31" &&
          (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        candidateId: 9,
        readiness: "READY_SOON",
        nominationType: "PRIMARY",
        competencyGaps: ["Stakeholder management"],
        awareness: "TRANSPARENT",
        goalIds: [11],
      });
    });
  });

  test("a closed plan blocks the editor with the read-only wording", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const u = String(url);
        if (u === "/api/v1/succession-plans/5") {
          return Promise.resolve(jsonResponse(200, { ...PLAN, status: "CLOSED" }));
        }
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
      }),
    );
    render(
      <MantineProvider env="test" theme={theme}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/succession/5/nominations/new"]}>
            <Routes>
              <Route path="/succession/:id/nominations/new" element={<EditSuccessionNomination />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    expect(
      await screen.findByText("This plan is closed — it stays browsable but can no longer be edited."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Candidate", { selector: "input" })).toBeNull();
  });
});
