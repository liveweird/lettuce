import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateOneOnOne from "./CreateOneOnOne";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

// view=managed rows arrive per (user, team); Sam appears twice via two teams.
const REPORTS = {
  items: [
    { userId: 8, name: "Sam Subordinate", email: "sam@x", teamId: 1, teamName: "AAA" },
    { userId: 8, name: "Sam Subordinate", email: "sam@x", teamId: 2, teamName: "BBB" },
    { userId: 9, name: "Zoe Zebra", email: "zoe@x", teamId: 1, teamName: "AAA" },
  ],
  page: 1,
  pageSize: 100,
  total: 3,
};

function renderCreate(route = "/one-on-ones/new") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/one-on-ones/new" element={<CreateOneOnOne />} />
            <Route path="/one-on-ones/:id/edit" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateOneOnOne page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.role", "USER");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("creates the meeting and lands on the edit screen", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/teams/members")) return Promise.resolve(jsonResponse(200, REPORTS));
      if (url.endsWith("/api/v1/one-on-ones") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(201, {
            id: 42,
            managerId: 7,
            managerName: "Me",
            subordinateId: 8,
            subordinateName: "Sam Subordinate",
            meetingDate: "2026-07-11",
            lastModified: 1,
            points: [],
            decisions: [],
            actionItems: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    renderCreate();

    // The picker offers one option per person (deduped across teams).
    const picker = await screen.findByRole("combobox", { name: "Team member" });
    await userEvent.click(picker);
    expect(await screen.findAllByRole("option", { name: "Sam Subordinate" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Zoe Zebra" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Sam Subordinate" }));

    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones/42/edit?from=managed");

    const [, init] = mockFetch.mock.calls.find(
      ([u, i]) => String(u).endsWith("/api/v1/one-on-ones") && (i as RequestInit)?.method === "POST",
    )!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.subordinateId).toBe(8);
    expect(body.meetingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // defaults to today
    expect(body.points).toEqual([]);
    expect(body.actionItems).toEqual([]);
  });

  test("a prefilled subordinate renders read-only, skips the picker fetch, and creates directly", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/v1/one-on-ones") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(201, {
            id: 43, managerId: 7, managerName: "Me", subordinateId: 8,
            subordinateName: "Sam Subordinate", meetingDate: "2026-07-12",
            lastModified: 1, points: [], decisions: [], actionItems: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    renderCreate(
      "/one-on-ones/new?subordinateId=8&subordinateName=Sam%20Subordinate&back=%2F%3Ftab%3Dsubordinates",
    );

    // The party is fixed: plain text instead of a picker, Create enabled immediately.
    expect(await screen.findByText("Sam Subordinate")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Team member" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    // No picker → no direct-reports fetch.
    expect(
      mockFetch.mock.calls.every(([u]) => !String(u).includes("/api/v1/teams/members")),
    ).toBe(true);
    // Cancel returns to the originating Dashboard tab.
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute(
      "href",
      "/?tab=subordinates",
    );

    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/one-on-ones/43/edit?from=managed");

    const [, init] = mockFetch.mock.calls.find(
      ([u, i]) => String(u).endsWith("/api/v1/one-on-ones") && (i as RequestInit)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string).subordinateId).toBe(8);
  });

  test("the create button stays disabled until a team member is picked", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, REPORTS));
    renderCreate();
    expect(await screen.findByRole("button", { name: "Create" })).toBeDisabled();
  });

  test("a back-dated create (409) surfaces the chronological-order message", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/teams/members")) return Promise.resolve(jsonResponse(200, REPORTS));
      if (init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(409, { title: "Conflict", status: 409, detail: "A later 1:1 …" }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    renderCreate();

    const picker = await screen.findByRole("combobox", { name: "Team member" });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "Zoe Zebra" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText(
        "This date is earlier than the last 1:1 with this person — meetings are recorded in chronological order.",
      ),
    ).toBeInTheDocument();
  });

  test("a save failure surfaces the error message", async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/teams/members")) return Promise.resolve(jsonResponse(200, REPORTS));
      if (init?.method === "POST") return Promise.resolve(jsonResponse(403, { title: "no" }));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    renderCreate();

    const picker = await screen.findByRole("combobox", { name: "Team member" });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "Zoe Zebra" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("You are not allowed to change this 1:1 meeting."),
    ).toBeInTheDocument();
  });
});
