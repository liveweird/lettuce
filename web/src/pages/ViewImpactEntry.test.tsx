import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewImpactEntry from "./ViewImpactEntry";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const ENTRY = {
  id: 5,
  userId: 8,
  userName: "Olga Owner",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  whatHappened: "Shipped the **pipeline**",
  contribution: "Built it",
  whyItMattered: "Cut the turnaround",
  evidence: "Kudos thread",
  createdAt: Date.now(),
  lastModified: Date.now(),
};

const EVENTS = {
  items: [
    {
      id: 1,
      entryId: 5,
      userId: 8,
      userName: "Olga Owner",
      timestamp: Date.now(),
      type: "CREATED",
      params: { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    },
  ],
};

function renderScreen(route = "/impact-log/5/view", entryStatus = 200) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string) => {
    const u = String(url);
    if (u === "/api/v1/impact-log/5/events") {
      return Promise.resolve(jsonResponse(200, EVENTS));
    }
    if (u === "/api/v1/impact-log/5") {
      return Promise.resolve(jsonResponse(entryStatus, entryStatus === 200 ? ENTRY : { title: "x" }));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/impact-log/:id/view" element={<ViewImpactEntry />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("ViewImpactEntry page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the four labeled markdown sections, the owner, and the period", async () => {
    renderScreen();

    // The markdown renders (bold stripped to a strong element, so the text splits).
    expect(await screen.findByText("pipeline")).toBeInTheDocument();
    expect(screen.getByText("Built it")).toBeInTheDocument();
    expect(screen.getByText("Cut the turnaround")).toBeInTheDocument();
    expect(screen.getByText("Kudos thread")).toBeInTheDocument();
    expect(screen.getByText("What happened")).toBeInTheDocument();
    expect(screen.getByText("My contribution")).toBeInTheDocument();
    expect(screen.getByText("Why did it matter")).toBeInTheDocument();
    expect(screen.getByText("What evidence / feedback supports that")).toBeInTheDocument();
    expect(screen.getByText("Olga Owner")).toBeInTheDocument();
    expect(screen.getByText("Jul 1, 2026 – Jul 31, 2026")).toBeInTheDocument();
    // The viewer (id 7) is not the owner (id 8) → no Edit entry point.
    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
  });

  test("the owner gets the Edit entry point; History shows the event trail", async () => {
    localStorage.setItem(USER_ID_KEY, "8");
    const user = userEvent.setup();
    renderScreen();

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^edit$/i })).toHaveAttribute(
      "href",
      "/impact-log/5/edit",
    );

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(
      await screen.findByText("Entry created for the period Jul 1, 2026 – Jul 31, 2026."),
    ).toBeInTheDocument();
  });

  test("a 403 maps to the access wording, a 404 to not-found", async () => {
    renderScreen("/impact-log/5/view", 403);
    expect(await screen.findByText("You don't have access to this entry.")).toBeInTheDocument();
  });

  test("an invalid id redirects to the journal without fetching", () => {
    const mockFetch = renderScreen("/impact-log/abc/view");
    expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
