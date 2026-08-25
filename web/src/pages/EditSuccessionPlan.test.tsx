import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditSuccessionPlan from "./EditSuccessionPlan";
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
  lossImpact: ["Client trust"],
  targetBenchDepth: 2,
  status: "OPEN",
  benchCount: 0,
  nominations: [],
  createdAt: 1,
  lastReviewedAt: 1,
};

function renderScreen({ getStatus = 200 } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/v1/succession-plans/5" && init?.method === "PUT") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u === "/api/v1/succession-plans/5") {
      return Promise.resolve(
        getStatus === 200 ? jsonResponse(200, PLAN) : jsonResponse(getStatus, { status: getStatus }),
      );
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test" theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/succession/5/edit"]}>
          <Routes>
            <Route path="/succession/:id/edit" element={<EditSuccessionPlan />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("EditSuccessionPlan page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("seeds from the document and PUTs the edited definition (person immutable, shown read-only)", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen();

    expect(await screen.findByText("Sam Seat")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Client trust")).toBeInTheDocument();
    expect(screen.getByLabelText("Role criticality", { selector: "input" })).toHaveValue("Critical");

    await user.click(screen.getByLabelText("Retention risk", { selector: "input" }));
    await user.click(await screen.findByRole("option", { name: "Medium" }));
    const depth = screen.getByLabelText(/Target bench depth/);
    await user.clear(depth);
    await user.type(depth, "3");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        ([url, init]) =>
          String(url) === "/api/v1/succession-plans/5" &&
          (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
        roleCriticality: "CRITICAL",
        retentionRisk: "MEDIUM",
        lossImpact: ["Client trust"],
        targetBenchDepth: 3,
      });
    });
    expect(await screen.findByTestId("probe")).toHaveTextContent("/succession/5/view");
  });

  test("a 403 load renders the permission wording, never a fake form", async () => {
    renderScreen({ getStatus: 403 });
    expect(
      await screen.findByText("You are not allowed to view this succession plan."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
