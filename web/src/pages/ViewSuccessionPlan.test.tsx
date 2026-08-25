import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewSuccessionPlan from "./ViewSuccessionPlan";
import { theme } from "../theme";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

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
      competencyGaps: ["Stakeholder management"],
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
    if (u === "/api/v1/succession-plans/5/close" && init?.method === "POST") {
      return Promise.resolve(new Response(null, { status: 204 }));
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
            <Route path="/succession/:id/view" element={<ViewSuccessionPlan />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("ViewSuccessionPlan page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the document: badges, under-bench cue, ordered lists, and the nomination with its goal", async () => {
    renderScreen();

    expect(await screen.findByText("Sam Seat")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // The under-bench warning (1 of 2).
    expect(
      screen.getByText("The bench is below target: 1 of 2 successors nominated."),
    ).toBeInTheDocument();
    // The ordered loss-impact list.
    expect(screen.getByText("Client trust")).toBeInTheDocument();
    expect(screen.getByText("Domain knowledge")).toBeInTheDocument();
    // The nomination card.
    expect(screen.getByText("Cleo Candidate")).toBeInTheDocument();
    expect(screen.getByText("Ready soon (3–12 mo)")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Confidential")).toBeInTheDocument();
    expect(screen.getByText("Stakeholder management")).toBeInTheDocument();
    // The linked development goal is a chip to the goal view.
    const goalLink = screen.getByRole("link", { name: "Open the goal Lead the on-call rotation" });
    expect(goalLink).toHaveAttribute(
      "href",
      "/goals/11/view?back=%2Fsuccession%2F5%2Fview",
    );
  });

  test("the owner of an OPEN plan gets Edit/Close/Delete and the nomination affordances", async () => {
    renderScreen();

    expect(await screen.findByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add nomination" })).toBeInTheDocument();
    expect(screen.getByLabelText("Edit the nomination of Cleo Candidate")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete the nomination of Cleo Candidate")).toBeInTheDocument();
  });

  test("closing confirms first, then POSTs the close action", async () => {
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
      expect(
        mockFetch.mock.calls.some(
          ([url, init]) =>
            String(url) === "/api/v1/succession-plans/5/close" &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  test("a CLOSED plan is read-only: the note shows, only Close-the-page and Delete remain", async () => {
    renderScreen({ ...PLAN, status: "CLOSED", benchCount: 2 });

    expect(
      await screen.findByText("This plan is closed — it stays browsable but can no longer be edited."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close plan" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add nomination" })).toBeNull();
    expect(screen.queryByLabelText("Edit the nomination of Cleo Candidate")).toBeNull();
    // Deleting a closed plan stays possible.
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    // No under-bench warning on a closed plan.
    expect(screen.queryByText(/The bench is below target/)).toBeNull();
  });

  test("a non-owner viewer (chain/HR) gets no mutating affordances at all", async () => {
    localStorage.setItem(USER_ID_KEY, "99");
    renderScreen();

    expect(await screen.findByText("Sam Seat")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add nomination" })).toBeNull();
  });
});
