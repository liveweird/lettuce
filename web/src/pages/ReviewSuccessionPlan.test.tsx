import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReviewSuccessionPlan from "./ReviewSuccessionPlan";
import { theme } from "../theme";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

const PLAN = {
  id: 5,
  managerId: 7,
  managerName: "Me Manager",
  userId: 8,
  userName: "Sam Seat",
  roleCriticality: "CRITICAL",
  retentionRisk: "HIGH",
  lossImpact: ["Client trust", "Domain knowledge"],
  targetBenchDepth: 2,
  status: "OPEN",
  benchCount: 1,
  nominations: [
    {
      id: 31,
      planId: 5,
      candidateId: 9,
      candidateName: "Cleo Candidate",
      readiness: "READY_SOON",
      nominationType: "PRIMARY",
      competencyGaps: [
        { text: "Stakeholder management", filled: true },
        { text: "Budget ownership", filled: false },
      ],
      awareness: "CONFIDENTIAL",
      goals: [{ id: 11, title: "Lead the on-call rotation", status: "ACTIVE", type: "NUMBER" }],
      createdAt: 1,
      lastModified: 2,
    },
  ],
  createdAt: 1,
  lastReviewedAt: Date.now(),
};

function renderScreen(plan: Record<string, unknown> = PLAN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u === "/api/v1/succession-plans/5/close" && method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u === "/api/v1/succession-plans/5/complete-review" && method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u === "/api/v1/succession-plans/5" && method === "PUT") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u === "/api/v1/succession-plans/5/events") {
      return Promise.resolve(
        jsonResponse(200, {
          items: [
            {
              id: 1,
              planId: 5,
              userId: 7,
              userName: "Me Manager",
              timestamp: 1,
              type: "CREATED",
              params: { roleCriticality: "CRITICAL", retentionRisk: "HIGH", targetBenchDepth: "2" },
            },
          ],
        }),
      );
    }
    if (u === "/api/v1/succession-plans/5") {
      return Promise.resolve(jsonResponse(200, plan));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/succession/5/view"]}>
          <Routes>
            <Route path="/succession/:id/view" element={<ReviewSuccessionPlan />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

const callsOf = (mockFetch: ReturnType<typeof vi.fn>, method: string, url: string) =>
  mockFetch.mock.calls.filter(
    ([u, init]) =>
      String(u) === url && ((init as RequestInit | undefined)?.method ?? "GET") === method,
  );

describe("ReviewSuccessionPlan page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("the owner of an OPEN plan gets editable tabs and the Close / Complete review / Close plan footer", async () => {
    const user = userEvent.setup();
    renderScreen();

    // Basics tab: the definition is inline-editable — sliders, bench input, loss-impact rows.
    expect(await screen.findByRole("slider", { name: "Role criticality" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Retention risk" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target bench depth")).toHaveValue("2");
    expect(screen.getByDisplayValue("Client trust")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Domain knowledge")).toBeInTheDocument();
    expect(
      screen.getByText("The bench is below target: 1 of 2 successors nominated."),
    ).toBeInTheDocument();

    // The footer trio; Edit and Delete are gone from this screen.
    expect(screen.getByRole("button", { name: /^Close$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close plan" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    // Nominations tab: the card with its always-visible affordances and the goal chip.
    await user.click(screen.getByRole("tab", { name: "Nominations" }));
    expect(await screen.findByText("Cleo Candidate")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add nomination" })).toBeInTheDocument();
    expect(screen.getByLabelText("Edit the nomination of Cleo Candidate")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete the nomination of Cleo Candidate")).toBeInTheDocument();
    expect(screen.getByText("Ready soon (3–12 mo)")).toBeInTheDocument();
    // Filled gaps read as settled: struck through + dimmed; open ones stay plain (v2.45.0).
    expect(screen.getByText("Stakeholder management")).toHaveStyle({
      textDecoration: "line-through",
    });
    expect(screen.getByText("Budget ownership")).not.toHaveStyle({
      textDecoration: "line-through",
    });
    expect(
      screen.getByRole("link", { name: "Open the goal Lead the on-call rotation" }),
    ).toHaveAttribute("href", "/goals/11/view?back=%2Fsuccession%2F5%2Fview");
  });

  test("the History tab renders the plan's localized audit trail (v2.46.0)", async () => {
    const user = userEvent.setup();
    renderScreen();

    await screen.findByRole("slider", { name: "Role criticality" });
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(
      await screen.findByText("Plan created (Critical / High, bench target 2)."),
    ).toBeInTheDocument();
  });

  test("Complete review saves pending edits, stamps the review, and exits; clean forms skip the PUT", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen();

    // Dirty the definition: bench depth 2 → 3 (also promote criticality via the keyboard).
    const bench = await screen.findByLabelText("Target bench depth");
    await user.clear(bench);
    await user.type(bench, "3");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Retention risk" }), {
      key: "ArrowLeft",
    });

    await user.click(screen.getByRole("button", { name: "Complete review" }));
    await waitFor(() => {
      const puts = callsOf(mockFetch, "PUT", "/api/v1/succession-plans/5");
      expect(puts).toHaveLength(1);
      expect(JSON.parse(String((puts[0][1] as RequestInit).body))).toEqual({
        roleCriticality: "CRITICAL",
        retentionRisk: "MEDIUM",
        lossImpact: ["Client trust", "Domain knowledge"],
        targetBenchDepth: 3,
      });
      expect(callsOf(mockFetch, "POST", "/api/v1/succession-plans/5/complete-review")).toHaveLength(1);
    });
    expect(await screen.findByTestId("probe")).toHaveTextContent("/succession");
  });

  test("Complete review with no edits only stamps (no PUT)", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Complete review" }));
    await waitFor(() => {
      expect(callsOf(mockFetch, "POST", "/api/v1/succession-plans/5/complete-review")).toHaveLength(1);
    });
    expect(callsOf(mockFetch, "PUT", "/api/v1/succession-plans/5")).toHaveLength(0);
    expect(await screen.findByTestId("probe")).toHaveTextContent("/succession");
  });

  test("Close warns the visit won't count as a review — and about unsaved changes when dirty", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen();

    await user.click(await screen.findByRole("button", { name: /^Close$/ }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Closing this screen will not count as a review of the plan — the last-reviewed date stays unchanged.",
    );
    expect(dialog).not.toHaveTextContent("unsaved changes");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Dirty the form: the warning gains the discard sentence; confirming leaves without writes.
    const bench = screen.getByLabelText("Target bench depth");
    await user.clear(bench);
    await user.type(bench, "4");
    await user.click(screen.getByRole("button", { name: /^Close$/ }));
    dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Your unsaved changes will also be discarded.");
    await user.click(within(dialog).getByRole("button", { name: "Leave" }));
    expect(await screen.findByTestId("probe")).toHaveTextContent("/succession");
    expect(callsOf(mockFetch, "PUT", "/api/v1/succession-plans/5")).toHaveLength(0);
    expect(callsOf(mockFetch, "POST", "/api/v1/succession-plans/5/complete-review")).toHaveLength(0);
  });

  test("closing the plan confirms first, then POSTs the close action", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Close plan" }));
    expect(
      await screen.findByText("Close this plan? It stays browsable but can never be edited again."),
    ).toBeInTheDocument();
    // The modal's confirm reuses the same wording.
    const confirms = screen.getAllByRole("button", { name: "Close plan" });
    await user.click(confirms[confirms.length - 1]);
    await waitFor(() => {
      expect(callsOf(mockFetch, "POST", "/api/v1/succession-plans/5/close")).toHaveLength(1);
    });
  });

  test("a CLOSED plan is read-only: badges instead of fields, no footer actions but Close", async () => {
    const user = userEvent.setup();
    renderScreen({ ...PLAN, status: "CLOSED", benchCount: 2 });

    expect(
      await screen.findByText("This plan is closed — it stays browsable but can no longer be edited."),
    ).toBeInTheDocument();
    // Read-only basics: badges + plain lists, no sliders.
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Client trust")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Role criticality" })).toBeNull();
    expect(screen.queryByText(/The bench is below target/)).toBeNull();
    // Only the plain Close in the footer.
    expect(screen.getByRole("link", { name: /^Close$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    // The bench stays browsable, without edit affordances.
    await user.click(screen.getByRole("tab", { name: "Nominations" }));
    expect(await screen.findByText("Cleo Candidate")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add nomination" })).toBeNull();
    expect(screen.queryByLabelText("Edit the nomination of Cleo Candidate")).toBeNull();
  });

  test("a non-owner viewer (chain/HR) gets the read-only document", async () => {
    localStorage.setItem(USER_ID_KEY, "99");
    renderScreen();

    expect(await screen.findByText("Sam Seat")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Role criticality" })).toBeNull();
    expect(screen.getByRole("link", { name: /^Close$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close plan" })).toBeNull();
  });
});
