import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TeamSubordinates from "./TeamSubordinates";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const TEAM = { id: 5, name: "Support", managerId: 7, managerName: "Me", managerDeleted: false };

const MEMBER = {
  userId: 11,
  name: "Bob Brown",
  email: "bob@x.test",
  teamId: 5,
  teamName: "Support",
};

function renderScreen(path = "/teams/5/subordinates") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/teams/:teamId/subordinates" element={<TeamSubordinates />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("TeamSubordinates page", () => {
  let mockFetch: FetchMock;

  function setupMocks({ teamStatus = 200 }: { teamStatus?: number } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const path = String(url);
      if (path.startsWith("/api/v1/teams/members")) {
        return Promise.resolve(jsonResponse(200, { items: [MEMBER], page: 1, pageSize: 20, total: 1 }));
      }
      if (path.startsWith("/api/v1/teams/5")) {
        return Promise.resolve(
          teamStatus === 200 ? jsonResponse(200, TEAM) : jsonResponse(teamStatus, { title: "nope" }),
        );
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("shows the team name, the back anchor, and the team-pinned subordinates grid", async () => {
    setupMocks();
    renderScreen();

    expect(await screen.findByRole("heading", { name: "Support" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to my teams/i })).toHaveAttribute(
      "href",
      "/?tab=myTeams",
    );

    // The embedded grid renders the member cards and queries with the pinned teamId.
    expect(await screen.findByText("Bob Brown")).toBeInTheDocument();
    await waitFor(() => {
      const memberCalls = mockFetch.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.startsWith("/api/v1/teams/members"));
      expect(memberCalls.some((u) => u.includes("view=managed") && u.includes("teamId=5"))).toBe(
        true,
      );
    });
  });

  test("an invalid team id redirects to the My teams tab without fetching", () => {
    setupMocks();
    renderScreen("/teams/abc/subordinates");

    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=myTeams");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a failing team lookup shows the fallback heading and an alert, but the grid still renders", async () => {
    setupMocks({ teamStatus: 404 });
    renderScreen();

    // The fallback heading shows immediately (also while loading); the alert lands once the
    // lookup settles.
    expect(await screen.findByRole("heading", { name: "Team #5" })).toBeInTheDocument();
    expect(await screen.findByText("Failed to load teams")).toBeInTheDocument();
    // The grid is independent of the heading lookup — the server scopes it safely anyway.
    expect(await screen.findByText("Bob Brown")).toBeInTheDocument();
  });
});
