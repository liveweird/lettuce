import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UserImpactLog from "./UserImpactLog";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";
const ROLES_KEY = "lettuce.auth.roles";

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/users/:userId/impact-log" element={<UserImpactLog />} />
            <Route path="/impact-log" element={<div>Impact log page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("UserImpactLog page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 })),
    );
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("manager drill-down (manages=1): the managed view pinned to the report, chain-wide", async () => {
    renderPage("/users/8/impact-log?name=Olga+Owner&from=details&manages=1");

    expect(await screen.findByText("Impact log — Olga Owner")).toBeInTheDocument();
    expect(screen.getByText("Olga Owner's journal of accomplishments, read-only.")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/impact-log?"));
    expect(listCall).toContain("view=managed");
    expect(listCall).toContain("userId=8");
    expect(listCall).toContain("includeIndirect=true");
  });

  test("the team-details drill-down (from=team&teamId): the manager branch renders, no bounce", async () => {
    renderPage("/users/8/impact-log?name=Olga+Owner&from=team&teamId=4");

    // The team origin (teamId present) implies the caller manages, so the pinned managed
    // view renders — the v2.40.1 fix: the card button now carries teamId like its siblings.
    expect(await screen.findByText("Impact log — Olga Owner")).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/impact-log?"));
    expect(listCall).toContain("view=managed");
    expect(listCall).toContain("userId=8");
  });

  test("audit mode (HR caller): the read-only user view, audit wording", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(["HR"]));
    renderPage("/users/8/impact-log?name=Olga+Owner&from=details&mode=audit");

    expect(
      await screen.findByText(/whole journal, read-only\. Access is recorded/),
    ).toBeInTheDocument();
    const listCall = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/v1/impact-log?"));
    expect(listCall).toContain("view=user");
    expect(listCall).toContain("userId=8");
    expect(listCall).not.toContain("includeIndirect");
  });

  test("neither auditor nor manager: bounces to the Impact log page", async () => {
    renderPage("/users/8/impact-log?name=Olga+Owner&from=details");

    expect(await screen.findByText("Impact log page")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/api/v1/impact-log?")),
    ).toBeUndefined();
  });
});
